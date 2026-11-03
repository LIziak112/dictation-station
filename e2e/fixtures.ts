import { randomBytes } from "node:crypto";
import { test as base } from "@playwright/test";

// Windows WebKit 没有系统 TTS；合成事件只验证流程，真实发音另做真机验收。
export function mockMissingSpeech() {
  if (!("speechSynthesis" in window)) {
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: class {
        constructor(public text: string) {}
      },
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (utterance: SpeechSynthesisUtterance) =>
          setTimeout(
            () => utterance.onend?.call(utterance, new Event("end") as SpeechSynthesisEvent),
            0,
          ),
        cancel: () => {},
      },
    });
  }
}

export const test = base.extend<{ signedIn: undefined }>({
  extraHTTPHeaders: async ({ baseURL }, use) => {
    // 每个用例独立客户端地址，避免整套浏览器测试共享同一个限流桶。
    await use({
      "x-real-ip": `e2e-${new URL(baseURL ?? "http://localhost").port}-${randomBytes(8).toString("hex")}`,
    });
  },
  signedIn: [
    async ({ page }, use) => {
      await page.addInitScript(mockMissingSpeech);
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
