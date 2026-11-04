import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const data = mkdtempSync(join(tmpdir(), "dictation-e2e-"));
const port = process.env.E2E_PORT ?? "8898";
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${port}/tingxie/`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: process.env.CI ? "github" : "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "webkit",
      // Windows WebKit 的多页面流程比 Chromium 慢；保留完整交互，给它单独的时间预算。
      timeout: 60000,
      expect: { timeout: 15000 },
      use: { ...devices["iPad (gen 7)"], browserName: "webkit" },
    },
  ],
  webServer: {
    command: "node server.js",
    url: `http://127.0.0.1:${port}/tingxie/api/health`,
    reuseExistingServer: false,
    timeout: 15000,
    env: {
      PORT: port,
      BASE_PATH: "/tingxie/",
      DATA_DIR: data,
      ALLOW_REGISTRATION: "true",
      PADDLEOCR_TOKEN: "",
      ENABLE_SERVER_TTS: "false",
      PUBLIC_DICTIONARY: "false",
      TRUST_PROXY: "true",
      HOST: "127.0.0.1",
    },
  },
});
