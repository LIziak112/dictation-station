import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { exportSchema } from "../packages/contract/src/index";
import { test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: (utterance: SpeechSynthesisUtterance) => {
          const state = window as unknown as {
            spoken: string[];
            utterance: SpeechSynthesisUtterance | null;
          };
          state.spoken ??= [];
          state.spoken.push(utterance.text);
          state.utterance = utterance;
        },
        cancel: () => {},
      },
      configurable: true,
    });
    if (!window.SpeechSynthesisUtterance)
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: class {
          constructor(public text: string) {}
        },
        configurable: true,
      });
  });
});

test("子路径完整流程：导入、草稿恢复、编辑、分享、播放、核对、重练与导出", async ({ page }) => {
  // 完整流程包含多次导航、滚动和下载，WebKit 触屏模拟需要独立的流程预算。
  test.slow();
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:8898")) external.push(r.url());
  });
  await page.goto("./");
  await page.getByRole("button", { name: "新建听写", exact: true }).click();
  await page
    .getByRole("textbox", { name: "作业原文", exact: true })
    .fill("apple  苹果\nmoon  月亮");
  await page.reload();
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "作业原文", exact: true })).toHaveValue(
    "apple  苹果\nmoon  月亮",
  );
  await page.getByRole("button", { name: "整理并预览词表" }).click();
  const title = `浏览器回归 ${test.info().project.name}`;
  await page.getByLabel("词表名称").fill(title);
  await page.screenshot({ path: test.info().outputPath("editor.png"), fullPage: true });
  await page.getByRole("button", { name: "保存词表", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑词表", exact: true }).click();
  await page.getByLabel("词表名称").fill(`${title} 已修改`);
  await page.getByRole("button", { name: "保存词表", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${title} 已修改`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "本账号链接 / 二维码" }).click();
  await expect(page.getByAltText("本账号听写二维码")).toBeVisible();
  const link = await page.getByLabel("本账号链接", { exact: true }).inputValue();
  expect(link).toContain("/tingxie/#batch=");
  expect(link).not.toContain("token");
  await page.getByRole("button", { name: "关闭链接" }).click();
  await page.getByRole("button", { name: /读英语写英语/ }).click();
  await page.getByRole("button", { name: "开始听写", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止播放" })).toBeVisible();
  await page.getByRole("button", { name: "停止播放" }).click();
  await page.getByRole("button", { name: "下一词", exact: true }).click();
  await expect(page.getByText("第 2 / 2 词", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "继续上次听写" }).click();
  await expect(page.getByText("第 2 / 2 词", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("player.png"), fullPage: true });
  await page.getByRole("button", { name: "结束并核对答案" }).click();
  await page.getByRole("button", { name: "第 1 词错误", exact: true }).click();
  await page.getByRole("button", { name: "第 2 词正确", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已核对 2/2" })).toBeVisible();
  const spoken = await page.evaluate(
    () => (window as unknown as { spoken?: string[] }).spoken?.length ?? 0,
  );
  await page.locator("main").focus();
  await page.keyboard.press("Space");
  expect(
    await page.evaluate(() => (window as unknown as { spoken?: string[] }).spoken?.length ?? 0),
  ).toBe(spoken);
  await page.getByRole("button", { name: "只练错词（1）", exact: true }).click();
  await expect(page.getByText("第 1 / 1 词", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "暂存并返回" }).click();
  await page.getByText("02 / 词表预览与导出", { exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出词表 JSON" }).click();
  const exported = await downloaded;
  expect(exported.suggestedFilename()).toMatch(/\.json$/);
  const exportedPath = await exported.path();
  const content = exportSchema.parse(JSON.parse(await readFile(exportedPath ?? "", "utf8")));
  expect(content.title).toBe(`${title} 已修改`);
  expect(content.entries).toHaveLength(2);
  await expect(page.getByRole("button", { name: "管理口令" })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("320px、桌面与键盘；坏本机稿不会被空稿覆盖", async ({ page }) => {
  await page.goto("./");
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: test.info().outputPath(`home-${width}.png`), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  const { account } = await (await page.request.get("api/auth/me")).json();
  await page.evaluate(
    (accountId) =>
      localStorage.setItem(
        `ownclass:dictation:${location.pathname}:${accountId}:draft`,
        '{"version":999,"words":"keep me"}',
      ),
    account.id,
  );
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "本机记录格式无法读取" })).toBeVisible();
  await page.getByRole("button", { name: "新建听写", exact: true }).click();
  expect(
    await page.evaluate(
      (accountId) =>
        localStorage.getItem(`ownclass:dictation:${location.pathname}:${accountId}:draft`),
      account.id,
    ),
  ).toContain("keep me");
  const backup = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出本机稿", exact: true }).click();
  const file = await (await backup).path();
  expect(file).toBeTruthy();
  expect(await readFile(file ?? "", "utf8")).toBe('{"version":999,"words":"keep me"}');
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
});

test("网络失败保留编辑草稿，错误可重试；拼音模式不朗读", async ({ page }) => {
  const r = await page.request.post("api/batches", {
    data: { title: "拼音测试", entries: [{ zh: "太阳", pinyin: "tài yáng" }] },
  });
  const { batch } = await r.json();
  await page.goto(`./#batch=${batch.id}`);
  await page.getByRole("button", { name: /看拼音写词语/ }).click();
  await page.getByRole("button", { name: "开始听写", exact: true }).click();
  await expect(page.getByRole("heading", { name: "tài yáng", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "播放 / 重播" })).toBeDisabled();
  expect(
    await page.evaluate(() => (window as unknown as { spoken?: string[] }).spoken ?? []),
  ).toEqual([]);
  await page.getByRole("button", { name: "暂存并返回" }).click();
  await page.getByRole("button", { name: "编辑词表", exact: true }).click();
  await page.getByLabel("词表名称").fill("网络失败的草稿");
  await page.route("**/api/batches/*", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "保存词表", exact: true }).click();
  await expect(page.getByLabel("词表名称")).toHaveValue("网络失败的草稿");
  await page.reload();
  await page.getByRole("button", { name: "全部词表", exact: true }).click();
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(page.getByLabel("词表名称")).toHaveValue("网络失败的草稿");
});
