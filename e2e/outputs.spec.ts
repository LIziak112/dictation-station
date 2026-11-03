import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("自动生成可下载汇报卡，打印拼音纸默认不包含答案", async ({ page }) => {
  const batch = (
    await (
      await page.request.post("api/batches", {
        data: {
          title: "语文作业",
          entries: [
            { zh: "太阳", pinyin: "tài yáng" },
            { zh: "月亮", pinyin: "yuè liang" },
          ],
        },
      })
    ).json()
  ).batch;
  const task = (
    await (
      await page.request.post("api/tasks", {
        data: {
          title: "语文打卡",
          date: "2026-11-03",
          mode: "zh_dictation",
          selections: [
            { batchId: batch.id, entryIds: batch.entries.map((entry: { id: string }) => entry.id) },
          ],
          reviewCount: 0,
        },
      })
    ).json()
  ).task;
  const attempt = (
    await (await page.request.post(`api/tasks/${task.id}/start`, { data: {} })).json()
  ).attempt;
  await page.request.put(`api/attempts/${attempt.id}`, {
    data: { revision: 1, index: 1, phase: "review", results: { [task.items[0].wordId]: "wrong" } },
  });
  await page.request.post(`api/attempts/${attempt.id}/complete`, {
    data: { revision: 2, confirmRemaining: true },
  });
  await page.goto(`./#task=${task.id}`);
  await page.getByRole("button", { name: "查看核对记录" }).click();
  await expect(page.getByRole("img", { name: "听写打卡汇报卡预览" })).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存汇报卡 PNG" }).click();
  const download = await pendingDownload;
  const filename = test.info().outputPath("report-card.png");
  await download.saveAs(filename);
  const bytes = await readFile(filename);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(1080);
  await page.getByRole("button", { name: "打印练习纸", exact: true }).click();
  await expect(page.getByTestId("print-answers")).toHaveCount(0);
  await page.getByRole("combobox", { name: "纸张内容", exact: true }).selectOption("pinyin");
  await expect(page.locator(".print-sheet")).toContainText("tài yáng");
  await expect(page.locator(".print-sheet")).not.toContainText("太阳");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("img", { name: "听写打卡汇报卡预览" })).not.toBeVisible();
  // biome-ignore lint/performance/useDomNodeTextContent: 必须检查打印实际可见文字，textContent 会包含隐藏答案。
  expect(await page.locator("body").innerText()).not.toContain("太阳");
  await page.screenshot({ path: test.info().outputPath("print-pinyin.png"), fullPage: true });
});
