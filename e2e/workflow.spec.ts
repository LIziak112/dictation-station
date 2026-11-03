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
  await page.goto("./#library");
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
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出词表 JSON" }).click();
  const exported = await downloaded;
  expect(exported.suggestedFilename()).toMatch(/\.json$/);
  const exportedPath = await exported.path();
  const content = exportSchema.parse(JSON.parse(await readFile(exportedPath ?? "", "utf8")));
  expect(content.title).toBe(`${title} 已修改`);
  expect(content.entries).toHaveLength(2);
  await page.getByRole("button", { name: /读英语写英语/ }).click();
  await page.getByRole("button", { name: "派发到孩子听写区", exact: true }).click();
  await expect(page.getByAltText("孩子区入口二维码")).toBeVisible();
  const childUrl = await page.getByLabel("孩子区独立链接").inputValue();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始任务", exact: true })).toHaveCount(0);
  await page.goto(childUrl);
  await page.getByRole("button", { name: "开始任务", exact: true }).click();
  await expect(page.getByText("第 1 / 2 项", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "我写好了，下一个", exact: true }).click();
  await expect(page.getByText("第 2 / 2 项", { exact: true })).toBeVisible();
  // 项号先在本机更新，等待同步完成再刷新，避免中断正在保存的请求。
  await expect(page.getByRole("button", { name: "写完了，交卷", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByText("第 2 / 2 项", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("player.png"), fullPage: true });
  await page.getByRole("button", { name: "写完了，交卷", exact: true }).click();
  await expect(page.getByRole("heading", { name: "写完了，已交卷给家长批改" })).toBeVisible();
  await page.getByRole("button", { name: "返回任务列表", exact: true }).click();
  await page.goto("./#today");
  await page.getByRole("button", { name: "立即批改" }).first().click();
  await page.getByRole("button", { name: "再练一次", exact: true }).first().click();
  await page.getByLabel("已全部核对，其余正确").check();
  await page.getByRole("button", { name: "保存核对并完成" }).click();
  await expect(page.getByRole("heading", { name: "本次核对记录" })).toBeVisible();
  await page.getByRole("button", { name: "错词再派发一次", exact: true }).click();
  await expect(page.getByAltText("孩子区入口二维码")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: "管理口令" })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("320px、桌面与键盘；坏本机稿不会被空稿覆盖", async ({ page }) => {
  await page.goto("./#library");
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
  await page.unroute("**/api/batches/*");
  await page.goto(`./#batch=${batch.id}`);
  await page.getByRole("button", { name: /看拼音写词语/ }).click();
  await page.getByRole("button", { name: "派发到孩子听写区", exact: true }).click();
  const childPinyinUrl = await page.getByLabel("孩子区独立链接").inputValue();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.goto(childPinyinUrl);
  await page.getByRole("button", { name: "开始任务", exact: true }).click();
  await expect(page.getByRole("heading", { name: "tài yáng", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "播放 / 再听一次" })).toBeDisabled();
  expect(
    await page.evaluate(() => (window as unknown as { spoken?: string[] }).spoken ?? []),
  ).toEqual([]);
});
