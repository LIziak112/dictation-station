import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Auth } from "../apps/server/src/auth";
import { Store } from "../apps/server/src/store";
import { Tasks } from "../apps/server/src/tasks";
import { Tokens } from "../apps/server/src/tokens";
import { defaultSettings } from "../packages/contract/src/index";

const stores: Store[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});
async function setup() {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-agent-")));
  stores.push(store);
  const auth = new Auth(store),
    tokens = new Tokens(store);
  const account = await auth.register("parent", "synthetic-password");
  if (!account) throw new Error("测试账号失败");
  const app = createApp(store, {});
  const cookie = `dictation_session=${auth.createSession(account.id)}`;
  return { store, auth, tokens, account, app, cookie };
}
const sample = { title: "AI 草稿", entries: [{ en: "sun", zh: "太阳" }] };
it("长期令牌可读取本账号已完成听写详情，权限及账号隔离生效", async () => {
  const { app, tokens, account, auth, store } = await setup();
  const other = await auth.register("other", "synthetic-password");
  if (!other) throw new Error("测试账号失败");
  const tasks = new Tasks(store);
  const batch = store.create(account.id, sample);
  const task = tasks.create(account.id, {
    title: "听写",
    date: "2026-11-03",
    mode: "en2en",
    settings: defaultSettings,
    selections: [{ batchId: batch.id, entryIds: [batch.entries[0].id] }],
  });
  const attempt = tasks.start(account.id, task.id, false);
  const reviewing = tasks.save(account.id, attempt.id, {
    revision: attempt.revision,
    index: 0,
    phase: "review",
    results: { [task.items[0].wordId]: "wrong" },
  });
  tasks.complete(account.id, attempt.id, reviewing.revision, true);
  const token = tokens.create(account.id, { name: "记录", scopes: ["history:read"] });
  expect(token.info.expiresAt).toBeNull();
  const headers = { Authorization: `Bearer ${token.token}` };
  expect((await (await app.request("/api/agent/history", { headers })).json()).items).toHaveLength(
    1,
  );
  const detail = await (await app.request(`/api/agent/history/${attempt.id}`, { headers })).json();
  expect(detail.task.items[0].entry.en).toBe("sun");
  expect(detail.attempt.results[task.items[0].wordId]).toBe("wrong");
  const foreign = tokens.create(other.id, { name: "其他", scopes: ["history:read"] });
  expect(
    (
      await app.request(`/api/agent/history/${attempt.id}`, {
        headers: { Authorization: `Bearer ${foreign.token}` },
      })
    ).status,
  ).toBe(404);
  const noHistory = tokens.create(account.id, { name: "词表", scopes: ["wordlists:read"] });
  expect(
    (
      await app.request("/api/agent/history", {
        headers: { Authorization: `Bearer ${noHistory.token}` },
      })
    ).status,
  ).toBe(403);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 400 * 86400000);
  expect((await app.request("/api/agent/history", { headers })).status).toBe(200);
  tokens.revoke(account.id, token.info.id);
  expect((await app.request("/api/agent/history", { headers })).status).toBe(401);
});
it("Agent 只能按令牌范围读词表、建草稿，不能直接发布或修改掌握状态", async () => {
  const { app, tokens, account, store, cookie } = await setup();
  store.create(account.id, { ...sample, sourceText: "不得外发的识别原文" });
  const { token } = tokens.create(account.id, {
    name: "我的 Agent",
    scopes: ["wordlists:read", "drafts:write"],
    expiresInDays: 30,
  });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  expect((await app.request("/api/agent/schema", { headers })).status).toBe(200);
  const listed = await (await app.request("/api/agent/wordlists", { headers })).json();
  expect(listed.batches).toHaveLength(1);
  const read = await app.request(`/api/agent/wordlists/${listed.batches[0].id}`, { headers });
  expect(JSON.stringify(await read.json())).not.toContain("不得外发");
  const draftResponse = await app.request("/api/agent/drafts", {
    method: "POST",
    headers,
    body: JSON.stringify({ wordlist: sample, notes: "请家长核对拼音" }),
  });
  expect(draftResponse.status).toBe(201);
  const { draft } = await draftResponse.json();
  expect(store.list(account.id)).toHaveLength(1);
  const invalidPublish = await app.request(`/api/drafts/${draft.id}/publish`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ entries: [] }),
  });
  expect(invalidPublish.status).toBe(400);
  expect(
    (await app.request(`/api/drafts/${draft.id}`, { headers: { Cookie: cookie } })).status,
  ).toBe(200);
  for (const path of ["/api/agent/learning", "/api/agent/drafts/x/publish"])
    expect((await app.request(path, { method: "POST", headers })).status).toBe(403);
  expect(
    (
      await app.request(`/api/drafts/${draft.id}/publish`, {
        method: "POST",
        headers,
        body: JSON.stringify(sample),
      })
    ).status,
  ).toBe(401);
  const confirmed = await app.request(`/api/drafts/${draft.id}/publish`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(sample),
  });
  expect(confirmed.status).toBe(201);
  expect(store.list(account.id)).toHaveLength(2);
  expect(
    (
      await app.request(`/api/drafts/${draft.id}/publish`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(sample),
      })
    ).status,
  ).toBe(404);
  expect(store.list(account.id)).toHaveLength(2);
  expect(
    (await app.request(`/api/drafts/${draft.id}`, { headers: { Cookie: cookie } })).status,
  ).toBe(404);
});
it("权限不足、其他账号数据、过期和撤销令牌均拒绝", async () => {
  const { app, account, auth, tokens, store } = await setup();
  const other = await auth.register("other", "synthetic-password");
  if (!other) throw new Error("测试账号失败");
  const foreign = store.create(other.id, sample);
  const onlyDraft = tokens.create(account.id, {
    name: "只建草稿",
    scopes: ["drafts:write"],
    expiresInDays: 1,
  });
  expect(
    (
      await app.request("/api/agent/wordlists", {
        headers: { Authorization: `Bearer ${onlyDraft.token}` },
      })
    ).status,
  ).toBe(403);
  const read = tokens.create(account.id, {
    name: "只读词表",
    scopes: ["wordlists:read"],
    expiresInDays: 1,
  });
  expect(
    (
      await app.request(`/api/agent/wordlists/${foreign.id}`, {
        headers: { Authorization: `Bearer ${read.token}` },
      })
    ).status,
  ).toBe(404);
  tokens.revoke(account.id, read.info.id);
  expect(
    (await app.request("/api/agent/schema", { headers: { Authorization: `Bearer ${read.token}` } }))
      .status,
  ).toBe(401);
  const future = Date.now() + 2 * 86400000;
  vi.spyOn(Date, "now").mockReturnValue(future);
  expect(
    (
      await app.request("/api/agent/schema", {
        headers: { Authorization: `Bearer ${onlyDraft.token}` },
      })
    ).status,
  ).toBe(401);
});
