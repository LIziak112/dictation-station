import { randomBytes } from "node:crypto";
import { test as base } from "@playwright/test";

export const test = base.extend<{ signedIn: undefined }>({
  extraHTTPHeaders: async ({ baseURL }, use) => {
    // 每个用例独立客户端地址，避免整套浏览器测试共享同一个限流桶。
    await use({
      "x-real-ip": `e2e-${new URL(baseURL ?? "http://localhost").port}-${randomBytes(8).toString("hex")}`,
    });
  },
  signedIn: [
    async ({ page }, use) => {
      const response = await page.request.post("api/auth/register", {
        data: {
          username: `test_${randomBytes(8).toString("hex")}`,
          password: "synthetic-password",
        },
      });
      if (response.status() !== 201) throw new Error(`测试账号注册失败：${response.status()}`);
      await use(undefined);
    },
    { auto: true },
  ],
});
