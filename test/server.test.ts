import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Auth } from "../apps/server/src/auth";
import { Store } from "../apps/server/src/store";

const stores: Store[] = [];
const open = (dir = mkdtempSync(join(tmpdir(), "dictation-unit-"))) => {
  const store = new Store(dir);
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const sample = { title: "合成词表", entries: [{ en: "sun", zh: "太阳" }] };
async function setup(options: Parameters<typeof createApp>[1] = {}) {
  const store = open();
  const auth = new Auth(store);
  const account = await auth.register("parent", "synthetic-password");
  if (!account) throw new Error("测试账号创建失败");
  const cookie = `dictation_session=${auth.createSession(account.id)}`;
  const app = createApp(store, options);
  const req = (path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json", ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { store, account, app, req, cookie };
}

describe("账号内持久化", () => {
  it("关闭再打开保留词表和会话，revision 阻止陈旧覆盖", async () => {
    const { store, account, cookie } = await setup();
    const batch = store.create(account.id, sample);
    store.close();
    const next = open(store.dir);
    expect(next.get(account.id, batch.id)?.title).toBe(sample.title);
    expect(new Auth(next).current(cookie.split("=")[1])?.id).toBe(account.id);
    expect(next.update(account.id, batch.id, { title: "新名称", revision: 1 })?.revision).toBe(2);
    expect(() => next.update(account.id, batch.id, { title: "覆盖", revision: 1 })).toThrow("版本");
    expect(next.get(account.id, batch.id)?.title).toBe("新名称");
  });
  it("部署者重设密码使全部会话失效", async () => {
    const { store, account } = await setup();
    const auth = new Auth(store);
    const tokens = [auth.createSession(account.id), auth.createSession(account.id)];
    expect(await auth.resetPassword("parent", "replacement-password")).toBe(true);
    for (const token of tokens) expect(auth.current(token)).toBeUndefined();
    expect(await auth.login("parent", "synthetic-password")).toBeUndefined();
    expect((await auth.login("parent", "replacement-password"))?.id).toBe(account.id);
  });
});

describe("接口契约与边界", () => {
  it("TLS 反代同主机来源可写，无效来源拒绝", async () => {
    const { req } = await setup();
    expect(
      (
        await req("http://ownclass.test/api/batches", "POST", sample, {
          Origin: "https://ownclass.test",
        })
      ).status,
    ).toBe(201);
    expect((await req("/api/batches", "POST", sample, { Origin: "null" })).status).toBe(403);
    expect(
      (await req("/api/batches", "POST", sample, { Origin: "https://other.invalid" })).status,
    ).toBe(403);
  });
  it("未登录的请求不能用转发头绕过现有频率限制", async () => {
    const { app } = await setup();
    for (let i = 0; i < 120; i++)
      expect(
        (
          await app.request("/api/batches", {
            method: "POST",
            headers: { "X-Real-IP": `192.0.2.${i}` },
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await app.request("/api/batches", {
          method: "POST",
          headers: { "X-Real-IP": "198.51.100.1" },
        })
      ).status,
    ).toBe(429);
  });
  it("账号内词表载荷不含 OCR 原文，无效输入不污染数据", async () => {
    const { req, store, account } = await setup();
    for (const body of [
      null,
      [],
      { entries: [null] },
      { entries: [{ en: "", zh: "" }] },
      { entries: [{ en: "sun", modes: ["zh2en"] }] },
    ])
      expect((await req("/api/batches", "POST", body)).status).toBe(400);
    expect(store.list(account.id)).toHaveLength(0);
    const response = await req("/api/batches", "POST", { ...sample, sourceText: "合成识别原文" });
    expect(response.status).toBe(201);
    const { batch } = await response.json();
    expect(batch.sourceText).toBeUndefined();
    expect(JSON.stringify(await (await req(`/api/batches/${batch.id}`)).json())).not.toContain(
      "合成识别原文",
    );
  });
  it("更新与删除仍检查 revision", async () => {
    const { req, store, account } = await setup();
    const batch = store.create(account.id, sample);
    expect(
      (await req(`/api/batches/${batch.id}`, "PUT", { title: "更新", revision: 1 })).status,
    ).toBe(200);
    expect(
      (await req(`/api/batches/${batch.id}`, "PUT", { title: "覆盖", revision: 1 })).status,
    ).toBe(409);
    expect((await req(`/api/batches/${batch.id}?revision=1`, "DELETE")).status).toBe(409);
    expect((await req(`/api/batches/${batch.id}?revision=2`, "DELETE")).status).toBe(200);
  });
  it("合成 OCR/TTS 验证契约，音频仅准备过的账号可读取", async () => {
    const file = `${"a".repeat(40)}.mp3`;
    const { req, store, app } = await setup({
      ocr: async () => "sun 太阳",
      tts: async () => `audio/${file}`,
    });
    mkdirSync(join(store.dir, "audio"));
    writeFileSync(join(store.dir, "audio", file), "synthetic audio");
    expect((await req(`/audio/${file}`)).status).toBe(404);
    expect((await req("/api/tts", "POST", { items: [{ text: "sun", lang: "en" }] })).status).toBe(
      200,
    );
    expect(await (await req(`/audio/${file}`)).text()).toBe("synthetic audio");
    const auth = new Auth(store);
    const other = await auth.register("another", "synthetic-password");
    if (!other) throw new Error("测试账号创建失败");
    expect(
      (
        await app.request(`/audio/${file}`, {
          headers: { Cookie: `dictation_session=${auth.createSession(other.id)}` },
        })
      ).status,
    ).toBe(404);
    expect(
      (await req("/api/tts", "POST", { items: [{ text: "x".repeat(301), lang: "en" }] })).status,
    ).toBe(400);
    expect(
      (
        await req("/api/ocr", "POST", {
          image: { name: "test.png", type: "image/png", data: "dGVzdA==" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req("/api/ocr", "POST", {
          image: { name: "test.txt", type: "text/html", data: "dGVzdA==" },
        })
      ).status,
    ).toBe(400);
  });
});
