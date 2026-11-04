import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Store } from "../apps/server/src/store";

it("only successful hashed assets are cached and security headers cover API responses", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-headers-")));
  try {
    const app = createApp(store, { trustProxy: true });
    app.get("/assets/index-abcdefgh.js", (c) => c.text("asset"));
    const asset = await app.request("/assets/index-abcdefgh.js");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const missing = await app.request("/assets/missing-abcdefgh.js");
    expect(missing.headers.get("cache-control")).toBe("no-store");
    const api = await app.request("/api/health", { headers: { "x-forwarded-proto": "https" } });
    expect(api.headers.get("cache-control")).toBe("no-store");
    expect(api.headers.get("strict-transport-security")).toBe("max-age=86400");
    expect(api.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: "dictation_child=example" },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).not.toContain("dictation_child=");
  } finally {
    store.close();
  }
});

it("limits failed password checks by IP and account and clears failures on success", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-limits-")));
  try {
    const app = createApp(store, { trustProxy: true });
    const post = (path: string, data: unknown, ip = "one") =>
      app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": ip },
        body: JSON.stringify(data),
      });
    const credentials = { username: "parent", password: "synthetic-password" };
    expect((await post("/api/auth/register", credentials)).status).toBe(201);
    for (let i = 0; i < 4; i++)
      expect(
        (await post("/api/auth/login", { ...credentials, password: "wrong-password" })).status,
      ).toBe(401);
    expect((await post("/api/auth/login", credentials)).status).toBe(200);
    for (let i = 0; i < 4; i++)
      expect(
        (await post("/api/auth/login", { ...credentials, password: "wrong-password" })).status,
      ).toBe(401);
    expect((await post("/api/auth/login", credentials)).status).toBe(200);
    for (let i = 0; i < 5; i++)
      expect(
        (await post("/api/auth/login", { ...credentials, password: "wrong-password" }, "two"))
          .status,
      ).toBe(401);
    const blocked = await post("/api/auth/login", credentials, "two");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await post("/api/auth/login", credentials, "three")).status).toBe(200);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 900001);
    expect((await post("/api/auth/login", credentials, "two")).status).toBe(200);
  } finally {
    vi.restoreAllMocks();
    store.close();
  }
});
