import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Auth } from "../apps/server/src/auth";
import { Store } from "../apps/server/src/store";
import { Tasks } from "../apps/server/src/tasks";
import { defaultSettings } from "../packages/contract/src/index";
import { selectRange } from "../packages/core/src/tasks";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
async function setup() {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-tasks-")));
  stores.push(store);
  const auth = new Auth(store);
  const account = await auth.register("parent", "synthetic-password");
  if (!account) throw new Error("测试账号创建失败");
  const tasks = new Tasks(store);
  const batch = store.create(account.id, {
    title: "单元一",
    entries: [
      { en: "apple", zh: "苹果" },
      { en: "moon", zh: "月亮" },
      { en: "bank", zh: "银行" },
    ],
  });
  const input = {
    title: "今天作业",
    date: "2026-11-03",
    mode: "en2en",
    settings: { ...defaultSettings, auto: false },
    selections: [{ batchId: batch.id, entryIds: batch.entries.slice(1).map((e) => e.id) }],
  };
  return { store, account, auth, tasks, batch, input };
}

it("范围按编号选择，错误范围明确拒绝，不静默截断", () => {
  expect(selectRange(["a", "b", "c", "d"], "2-3,1")).toEqual(["a", "b", "c"]);
  expect(() => selectRange(["a"], "1-5")).toThrow("范围");
});
it("词条跨词表稳定复用，异义和修改内容不继承身份", async () => {
  const { store, account, batch } = await setup();
  const same = store.create(account.id, {
    title: "复用",
    entries: [
      { en: "apple", zh: "苹果" },
      { en: "bank", zh: "河岸" },
    ],
  });
  expect(same.entries[0].wordId).toBe(batch.entries[0].wordId);
  expect(same.entries[1].wordId).not.toBe(batch.entries[2].wordId);
  const changed = store.update(account.id, batch.id, {
    revision: 1,
    entries: [{ ...batch.entries[0], zh: "苹果公司" }],
  });
  expect(changed?.entries[0].wordId).not.toBe(batch.entries[0].wordId);
});
it("发布固定范围与原顺序，编辑词表不改变快照，其他账号不可读", async () => {
  const { store, account, tasks, batch, input } = await setup();
  const task = tasks.create(account.id, input);
  expect(task.items.map((item) => item.entry.en)).toEqual(["moon", "bank"]);
  store.update(account.id, batch.id, { revision: 1, entries: [{ en: "sun", zh: "太阳" }] });
  expect(tasks.get(account.id, task.id)?.items[0].entry.en).toBe("moon");
  expect(tasks.get("other-account", task.id)).toBeUndefined();
});
it("同任务只创建一个进行中会话，接力使用 revision，不覆盖陈旧进度", async () => {
  const { account, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  const attempt = tasks.start(account.id, task.id, false);
  expect(tasks.start(account.id, task.id, false).id).toBe(attempt.id);
  const next = tasks.save(account.id, attempt.id, {
    revision: attempt.revision,
    index: 1,
    phase: "player",
    results: {},
  });
  expect(next.index).toBe(1);
  expect(() =>
    tasks.save(account.id, attempt.id, {
      revision: attempt.revision,
      index: 0,
      phase: "player",
      results: {},
    }),
  ).toThrow("版本");
  expect(() =>
    tasks.save(account.id, attempt.id, {
      revision: next.revision,
      index: 99,
      phase: "player",
      results: {},
    }),
  ).toThrow();
});
it("播放投影不包含答案字段、词义或完整条目，接口仍按账号隔离", async () => {
  const { store, account, auth, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  const app = createApp(store, {});
  const headers = { Cookie: `dictation_session=${auth.createSession(account.id)}` };
  const response = await app.request(`/api/tasks/${task.id}/play`, { headers });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.task.items[0].audioText).toBe("moon");
  const json = JSON.stringify(data);
  for (const secret of ["月亮", "银行", '"answer"', '"entry"', '"alt"'])
    expect(json).not.toContain(secret);
  expect((await app.request(`/api/tasks/${task.id}/play`)).status).toBe(401);
});
it("任务开始前可改范围，开始后复制新任务，不覆盖旧快照", async () => {
  const { account, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  const changed = tasks.update(account.id, task.id, 1, { ...input, title: "修改任务" });
  expect(changed.revision).toBe(2);
  tasks.start(account.id, task.id, false);
  expect(() => tasks.update(account.id, task.id, 3, input)).toThrow("复制");
  const copy = tasks.create(account.id, {
    ...input,
    selections: [],
    wordIds: changed.items.map((item) => item.wordId),
  });
  expect(copy.id).not.toBe(task.id);
  expect(copy.items.map((item) => item.entry.en)).toEqual(["moon", "bank"]);
});
it("完成请求重复执行不写第二次结果，核对后不能回到未揭示答案的练习阶段", async () => {
  const { account, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  const attempt = tasks.start(account.id, task.id, false);
  const reviewing = tasks.save(account.id, attempt.id, {
    revision: 1,
    index: 1,
    phase: "review",
    results: {},
  });
  expect(() =>
    tasks.save(account.id, attempt.id, {
      revision: reviewing.revision,
      index: 0,
      phase: "player",
      results: {},
    }),
  ).toThrow("新建");
  const completed = tasks.complete(account.id, attempt.id, reviewing.revision, false);
  expect(Object.values(completed.results)).toEqual(["unchecked", "unchecked"]);
  expect(tasks.complete(account.id, attempt.id, reviewing.revision, true)).toEqual(completed);
});
