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
    await (
      await page.request.post(`api/tasks/${task.id}/start`, {
        data: { deviceId: "fixture-device" },
      })
    ).json()
  ).attempt;
  await page.request.put(`api/attempts/${attempt.id}`, {
    data: {
      deviceId: "fixture-device",
      revision: 1,
      index: 1,
      phase: "review",
      results: { [task.items[0].wordId]: "wrong" },
    },
  });
  await page.request.post(`api/attempts/${attempt.id}/complete`, {
    data: { revision: 2, confirmRemaining: true },
  });
  await page.goto(`./#task=${task.id}`);
  if (await page.getByLabel("四位数字口令").isVisible()) {
    await page.getByLabel("四位数字口令").fill("1234");
    await page.getByRole("button", { name: "确认", exact: true }).click();
  }
  await page.getByRole("button", { name: "查看核对记录" }).click();
  await expect(page.getByRole("img", { name: "听写打卡汇报卡预览" })).toBeVisible();
  await page.getByRole("button", { name: "未通过 1" }).click();
  await expect(page.locator(".review-row")).toHaveCount(1);
  await expect(page.locator(".review-row")).toContainText("太阳");
  await page.getByRole("button", { name: "待巩固 0" }).click();
  await expect(page.getByText("这里暂时没有词条")).toBeVisible();
  await expect(page.locator(".review-list")).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("review-empty.png") });
  await page.getByRole("button", { name: "查看全部 2 项" }).click();
  await expect(page.locator(".review-row")).toHaveCount(2);
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const answer = await page.locator(".review-word h2").first().boundingBox();
    const meaning = await page.locator(".review-meaning").first().boundingBox();
    expect(answer && meaning).toBeTruthy();
    if (width > 580) {
      expect(meaning?.x).toBeGreaterThan(answer?.x ?? 0);
      expect(Math.abs((answer?.y ?? 0) - (meaning?.y ?? 0))).toBeLessThan(8);
    } else {
      expect(meaning?.y).toBeGreaterThanOrEqual((answer?.y ?? 0) + (answer?.height ?? 0));
      expect(Math.abs((answer?.x ?? 0) - (meaning?.x ?? 0))).toBeLessThan(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: test.info().outputPath("review-rows.png") });
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存汇报卡 PNG" }).click();
  const download = await pendingDownload;
  const filename = test.info().outputPath("report-card.png");
  await download.saveAs(filename);
  const bytes = await readFile(filename);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(1080);
  await page.getByRole("button", { name: "打印练习纸", exact: true }).click();
  await expect(page.getByRole("img", { name: "扫码打开任务核对" })).toBeVisible();
  await expect(page.getByLabel("书写格线")).toHaveValue("tian");
  await expect(page.locator(".writing-squares svg")).toHaveCount(8);
  expect(
    await page
      .locator(".writing-squares svg")
      .first()
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeCloseTo((14 * 96) / 25.4, 0);
  await page.getByLabel("书写格线").selectOption("mi");
  await expect(page.locator(".writing-squares svg path")).toHaveCount(16);
  await expect(page.getByTestId("print-answers")).toHaveCount(0);
  await page.getByRole("combobox", { name: "纸张内容", exact: true }).selectOption("pinyin");
  await expect(page.locator(".print-sheet")).toContainText("tài yáng");
  await expect(page.locator(".print-sheet")).not.toContainText("太阳");
  await expect(page.getByText(/A4 共 1 页/)).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("img", { name: "听写打卡汇报卡预览" })).not.toBeVisible();
  // biome-ignore lint/performance/useDomNodeTextContent: 必须检查打印实际可见文字，textContent 会包含隐藏答案。
  expect(await page.locator("body").innerText()).not.toContain("太阳");
  await page.screenshot({ path: test.info().outputPath("print-pinyin.png"), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  await page.goto(`./#check=${task.id}`);
  await expect(page.getByRole("heading", { name: "本次核对记录" })).toBeVisible();
});

test("练习纸自动分页并保留编号", async ({ page, browserName }) => {
  const batch = (
    await (
      await page.request.post("api/batches", {
        data: {
          title: "分页词表",
          entries: Array.from({ length: 20 }, (_, i) => ({ en: `word${i}`, zh: `词语${i}` })),
        },
      })
    ).json()
  ).batch;
  const task = (
    await (
      await page.request.post("api/tasks", {
        data: {
          title: "分页听写",
          date: new Date().toLocaleDateString("en-CA"),
          mode: "en2en",
          selections: [
            { batchId: batch.id, entryIds: batch.entries.map((entry: { id: string }) => entry.id) },
          ],
          reviewCount: 0,
        },
      })
    ).json()
  ).task;
  await page.goto(`./#task=${task.id}`);
  if (await page.getByLabel("四位数字口令").isVisible()) {
    await page.getByLabel("四位数字口令").fill("1234");
    await page.getByRole("button", { name: "确认", exact: true }).click();
  }
  await page.goto("./");
  const card = page.locator(".task-card").filter({ hasText: "分页听写" });
  await expect(card.getByRole("button", { name: "孩子区链接" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "撤回任务" })).toBeVisible();
  await card.getByRole("button", { name: "打印纸" }).click();
  await expect(page.getByRole("heading", { name: "打印练习纸" })).toBeVisible();
  await expect(page.getByLabel("书写格线")).toHaveValue("english");
  await expect(page.locator(".writing-english").first().locator("line")).toHaveCount(4);
  await expect(page.locator(".print-sheet")).toHaveCount(2);
  await expect(page.locator(".print-sheet").first().locator(".worksheet-item")).toHaveCount(18);
  await expect(page.locator(".print-sheet").last().locator(".worksheet-item")).toHaveCount(2);
  await expect(page.locator(".print-sheet").last()).toContainText("19.");
  await expect(page.locator(".print-sheet").first()).toContainText("姓名");
  await expect(page.locator(".print-sheet").last()).not.toContainText("姓名");
  await expect(page.locator(".print-sheet").last()).toContainText("第 2 / 2 页");
  await page.emulateMedia({ media: "print" });
  if (browserName === "chromium") {
    const pdf = await page.pdf({
      path: test.info().outputPath("worksheet.pdf"),
      preferCSSPageSize: true,
    });
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(2);
  }
  await page.emulateMedia({ media: "screen" });
  await page.getByLabel("书写格线").selectOption("tian");
  await expect(page.locator(".worksheet-item").first().locator(".writing-squares")).toHaveCount(2);
  await expect(page.locator(".writing-squares").first().locator("svg")).toHaveCount(4);
  await page.emulateMedia({ media: "print" });
  const squarePages = await page.locator(".print-sheet").count();
  if (browserName === "chromium") {
    const squarePdf = await page.pdf({ preferCSSPageSize: true });
    expect(squarePdf.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(squarePages);
  }
});
