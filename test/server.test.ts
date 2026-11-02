import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Store } from "../apps/server/src/store";

const stores: Store[] = [];
const open = (dir = mkdtempSync(join(tmpdir(), "dictation-unit-"))) => {
  const s = new Store(dir);
  stores.push(s);
  return s;
};
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});
const sample = { title: "合成词表", entries: [{ en: "sun", zh: "太阳" }] };
describe("存储与旧数据迁移", () => {
  it("导入与现存 SQLite ID 冲突时不静默跳过旧词表", () => {
    const s = open();
    const batch = s.create(sample);
    const dir = s.dir;
    s.close();
    writeFileSync(
      join(dir, "batches.json"),
      JSON.stringify({
        batches: { [batch.id]: { ...sample, title: "不能被忽略的旧内容", id: batch.id } },
      }),
    );
    expect(() => open(dir)).toThrow("旧词表");
  });
  it("保存后立即关闭仍持久化，revision 阻止陈旧覆盖", () => {
    const s = open();
    const b = s.create(sample);
    s.close();
    const next = open(s.dir);
    expect(next.get(b.id)?.title).toBe("合成词表");
    expect(next.update(b.id, { title: "新名称", revision: b.revision })?.revision).toBe(2);
    expect(() => next.update(b.id, { title: "覆盖", revision: b.revision })).toThrow("版本");
    expect(next.get(b.id)?.title).toBe("新名称");
  });
  it("旧 JSON 只导入一次，保留原文件，坏文件阻断启动", () => {
    const dir = mkdtempSync(join(tmpdir(), "dictation-legacy-"));
    const file = join(dir, "batches.json");
    const text = JSON.stringify({
      batches: {
        demo1: {
          ...sample,
          id: "demo1",
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      },
    });
    writeFileSync(file, text);
    const s = open(dir);
    expect(s.get("demo1")?.entries[0].id).toBeTruthy();
    expect(readFileSync(file, "utf8")).toBe(text);
    s.close();
    expect(open(dir).list()).toHaveLength(1);
    const broken = mkdtempSync(join(tmpdir(), "dictation-broken-"));
    writeFileSync(join(broken, "batches.json"), "{");
    expect(() => open(broken)).toThrow("旧词表");
  });
});
describe("接口契约与边界", () => {
  it("TLS 反代同主机来源可写，无效来源拒绝，转发头不能绕过限流", async () => {
    const app = createApp(open(), { writeToken: "" });
    const req = (origin: string) =>
      app.request("http://ownclass.test/api/batches", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(sample),
      });
    expect((await req("https://ownclass.test")).status).toBe(201);
    expect((await req("null")).status).toBe(403);
    const locked = createApp(open(), { writeToken: "synthetic-only", trustProxy: false });
    for (let i = 0; i < 120; i++)
      expect(
        (
          await locked.request("/api/batches", {
            method: "POST",
            headers: { "X-Real-IP": `192.0.2.${i}` },
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await locked.request("/api/batches", {
          method: "POST",
          headers: { "X-Real-IP": "198.51.100.1" },
        })
      ).status,
    ).toBe(429);
  });
  it("开放使用不索要口令，公开载荷不含 OCR 原文", async () => {
    const app = createApp(open(), { writeToken: "" });
    const r = await app.request("/api/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sample, sourceText: "合成识别原文" }),
    });
    expect(r.status).toBe(201);
    const { batch } = await r.json();
    expect(batch.sourceText).toBeUndefined();
    const read = await app.request(`/api/batches/${batch.id}`);
    expect(JSON.stringify(await read.json())).not.toContain("合成识别原文");
    expect((await app.request("/api/batches")).status).toBe(200);
  });
  it("所有写入口统一鉴权，错误输入不污染数据", async () => {
    const store = open();
    const app = createApp(store, { writeToken: "synthetic-only" });
    for (const path of ["/api/batches", "/api/tts", "/api/ocr", "/api/ocr/url"])
      expect((await app.request(path, { method: "POST" })).status).toBe(401);
    const req = (body: unknown) =>
      app.request("/api/batches", {
        method: "POST",
        headers: { Authorization: "Bearer synthetic-only", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    for (const body of [
      null,
      [],
      { entries: [null] },
      { entries: [{ en: "", zh: "" }] },
      { entries: [{ en: "sun", modes: ["zh2en"] }] },
    ])
      expect((await req(body)).status).toBe(400);
    expect(store.list()).toHaveLength(0);
    expect((await req(sample)).status).toBe(201);
  });
  it("跨源写请求拒绝；更新与删除检查 revision", async () => {
    const store = open();
    const b = store.create(sample);
    const app = createApp(store, { writeToken: "" });
    expect(
      (
        await app.request("/api/batches", {
          method: "POST",
          headers: { Origin: "https://other.invalid", "Content-Type": "application/json" },
          body: JSON.stringify(sample),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/api/batches/${b.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "更新", revision: 1 }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/batches/${b.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "旧覆盖", revision: 1 }),
        })
      ).status,
    ).toBe(409);
    expect(
      (await app.request(`/api/batches/${b.id}?revision=1`, { method: "DELETE" })).status,
    ).toBe(409);
  });
  it("合成 OCR/TTS 适配器验证请求和错误恢复，不真实外发", async () => {
    const app = createApp(open(), {
      writeToken: "",
      ocr: async () => "sun 太阳",
      tts: async () => "audio/test.mp3",
    });
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await post("/api/tts", { items: [{ text: "sun", lang: "en" }] })).status).toBe(200);
    expect(
      (await post("/api/tts", { items: [{ text: "x".repeat(301), lang: "en" }] })).status,
    ).toBe(400);
    expect(
      (await post("/api/ocr", { image: { name: "test.png", type: "image/png", data: "dGVzdA==" } }))
        .status,
    ).toBe(200);
    expect(
      (await post("/api/ocr", { image: { name: "test.txt", type: "text/html", data: "dGVzdA==" } }))
        .status,
    ).toBe(400);
  });
});
