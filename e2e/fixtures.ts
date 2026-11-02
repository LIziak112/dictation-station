import { randomBytes } from "node:crypto";
import { test as base } from "@playwright/test";

export const test = base.extend<{ signedIn: undefined }>({
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
