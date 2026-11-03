import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("真人文件无法解码时重新请求合成兜底，覆盖数字反映实际发音", async ({ page }) => {
  const batch = (
    await (
      await page.request.post("api/batches", { data: { entries: [{ en: "sun", zh: "太阳" }] } })
    ).json()
  ).batch;
  const task = (
    await (
      await page.request.post("api/tasks", {
        data: {
          title: "检查声音",
          date: "2026-11-03",
          mode: "en2en",
          selections: [{ batchId: batch.id, entryIds: [batch.entries[0].id] }],
          reviewCount: 0,
        },
      })
    ).json()
  ).task;
  let downgraded = false;
  await page.route(`**/api/tasks/${task.id}/audio`, async (route) => {
    const fallback = route.request().postDataJSON().fallbackIds?.length > 0;
    downgraded ||= fallback;
    await route.fulfill({
      json: {
        audio: [
          {
            wordId: task.items[0].wordId,
            text: "sun",
            lang: "en",
            id: "test-source",
            kind: fallback ? "device" : "human",
            url: fallback ? null : "audio/unplayable.ogg",
            source: fallback ? "设备合成语音" : "合成测试来源",
            sourceUrl: "https://example.org/source",
            author: "测试作者",
            licenseName: "测试许可",
            licenseUrl: "https://example.org/license",
            title: "测试声音",
            reading: "",
            accent: "us",
            warning: "",
          },
        ],
      },
    });
  });
  await page.route("**/audio/unplayable.ogg", (route) =>
    route.fulfill({ status: 200, contentType: "audio/ogg", body: "synthetic broken file" }),
  );
  await page.goto(`./?child=1#task=${task.id}`);
  await expect(page.getByText("真人 0 · 合成 1 · 不可用 0", { exact: true })).toBeVisible();
  expect(downgraded).toBe(true);
  await expect(page.getByRole("button", { name: "开始任务", exact: true })).toBeEnabled();
});
