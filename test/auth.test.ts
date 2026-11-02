import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Auth, digestToken } from "../apps/server/src/auth";
import { accounts, sessions } from "../apps/server/src/schema";
import { Store } from "../apps/server/src/store";

const stores: Store[] = [];
function setup(allowRegistration = true) {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-auth-")));
  stores.push(store);
  return { store, app: createApp(store, { allowRegistration }) };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});
it("密码和会话令牌只存摘要，30 天后会话不可用", async () => {
  const { store } = setup();
  const auth = new Auth(store);
  const account = await auth.register("expiry", "synthetic-password");
  if (!account) throw new Error("测试账号创建失败");
  const token = auth.createSession(account.id);
  expect(store.db.select().from(accounts).get()?.passwordHash).not.toContain("synthetic-password");
  expect(store.db.select().from(sessions).get()?.tokenHash).toBe(digestToken(token));
  expect(auth.current(token)?.id).toBe(account.id);
  const future = Date.now() + 31 * 86400000;
  vi.spyOn(Date, "now").mockReturnValue(future);
  expect(auth.current(token)).toBeUndefined();
});
const credentials = { username: "parent", password: "test-password-123" };
const sample = { title: "我的词表", entries: [{ en: "sun", zh: "太阳" }] };

it("未登录时词表、音频和服务调用均不可访问", async () => {
  const { app } = setup();
  for (const path of ["/api/batches", "/api/batches/missing", "/audio/test.mp3"])
    expect((await app.request(path)).status).toBe(401);
  expect((await app.request("/api/ocr", { method: "POST" })).status).toBe(401);
});

it("注册登录、跨账号隔离、修改密码及退出", async () => {
  const { app } = setup();
  const post = (path: string, body: unknown, cookie = "") =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
  const registered = await post("/api/auth/register", credentials);
  expect(registered.status).toBe(201);
  const cookie = registered.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect(cookie).toContain("dictation_session=");
  expect(registered.headers.get("set-cookie")).toContain("HttpOnly");
  expect(JSON.stringify(await registered.json())).not.toContain("password");
  const created = await post("/api/batches", sample, cookie);
  expect(created.status).toBe(201);
  const { batch } = await created.json();
  const other = await post("/api/auth/register", { ...credentials, username: "another" });
  const otherCookie = other.headers.get("set-cookie")?.split(";")[0] ?? "";
  const headers = { Cookie: otherCookie, "Content-Type": "application/json" };
  expect(await (await app.request("/api/batches", { headers })).json()).toEqual({ batches: [] });
  expect((await app.request(`/api/batches/${batch.id}`, { headers })).status).toBe(404);
  expect(
    (
      await app.request(`/api/batches/${batch.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ title: "覆盖", revision: 1 }),
      })
    ).status,
  ).toBe(404);
  expect(
    (await app.request(`/api/batches/${batch.id}?revision=1`, { method: "DELETE", headers }))
      .status,
  ).toBe(404);
  expect(
    (await post("/api/auth/login", { ...credentials, password: "wrong-password" })).status,
  ).toBe(401);
  const nextPassword = "new-test-password-123";
  expect(
    (
      await post(
        "/api/auth/password",
        { currentPassword: credentials.password, newPassword: nextPassword },
        cookie,
      )
    ).status,
  ).toBe(200);
  expect((await app.request("/api/auth/me", { headers: { Cookie: cookie } })).status).toBe(401);
  expect((await post("/api/auth/login", credentials)).status).toBe(401);
  const login = await post("/api/auth/login", { ...credentials, password: nextPassword });
  const nextCookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect(
    (await app.request(`/api/batches/${batch.id}`, { headers: { Cookie: nextCookie } })).status,
  ).toBe(200);
  expect((await post("/api/auth/logout", {}, nextCookie)).status).toBe(200);
  expect((await app.request("/api/auth/me", { headers: { Cookie: nextCookie } })).status).toBe(401);
});

it("可关闭注册，重复用户名拒绝，跨源注册拒绝", async () => {
  const { app } = setup(false);
  expect(
    (
      await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      })
    ).status,
  ).toBe(403);
  const opened = setup().app;
  for (const status of [201, 409])
    expect(
      (
        await opened.request("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials),
        })
      ).status,
    ).toBe(status);
  expect(
    (
      await opened.request("/api/auth/register", {
        method: "POST",
        headers: { Origin: "https://other.test" },
      })
    ).status,
  ).toBe(403);
});
