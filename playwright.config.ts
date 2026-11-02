import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const data = mkdtempSync(join(tmpdir(), "dictation-e2e-"));
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8898/tingxie/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: process.env.CI ? "github" : "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["iPad (gen 7)"], browserName: "webkit" } },
  ],
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:8898/tingxie/api/health",
    reuseExistingServer: false,
    timeout: 15000,
    env: {
      PORT: "8898",
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
