import { expect } from "@playwright/test";
import { test } from "./fixtures";

for (const edit of ["title", "source"] as const) {
  test(`整理模块加载期间修改 ${edit}，保留新输入并正确处理解析结果`, async ({ page }) => {
    await page.goto("./#library");
    await page.getByRole("button", { name: "新建听写", exact: true }).click();
    const source = page.getByRole("textbox", { name: "作业原文", exact: true });
    await source.fill("apple  苹果\nmoon  月亮");
    let release = () => {};
    let observed = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      observed = resolve;
    });
    await page.route("**/assets/parse-list-*.js", async (route) => {
      observed();
      await gate;
      await route.continue();
    });
    try {
      await page.getByRole("button", { name: "整理并预览词表" }).click();
      await requested;
      if (edit === "title") await page.getByLabel("词表名称").fill("整理途中命名");
      else await source.fill("sun  太阳");
      release();
      if (edit === "title") {
        await expect(page.getByRole("heading", { name: "核对词表 2 词" })).toBeVisible();
        await expect(page.getByLabel("词表名称")).toHaveValue("整理途中命名");
      } else {
        await expect(page.getByText("内容已修改，请重新整理词条", { exact: true })).toBeVisible();
        await expect(source).toHaveValue("sun  太阳");
        await expect(page.getByRole("heading", { name: "核对词表 0 词" })).toBeVisible();
      }
    } finally {
      release();
    }
  });
}

test("本机落盘失败时保留编辑内容，不允许退出丢稿", async ({ page }) => {
  await page.goto("./#library");
  await page.getByRole("button", { name: "新建听写", exact: true }).click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("合成存储失败");
    };
  });
  await page.getByRole("textbox", { name: "作业原文", exact: true }).fill("sun 太阳");
  await page.getByLabel("账号", { exact: true }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("textbox", { name: "作业原文", exact: true })).toHaveValue(
    "sun 太阳",
  );
  await expect(page.getByText("有尚未保存或同步的内容，请先恢复保存或导出备份。")).toBeVisible();
  expect((await page.request.get("api/auth/me")).status()).toBe(200);
});

test("保存期间保留操作焦点并锁定输入，离开后的迟到回执不改变当前页", async ({ page }) => {
  await page.goto("./#library");
  await page.getByRole("button", { name: "新建听写", exact: true }).click();
  await page.getByRole("button", { name: "手动添加词条", exact: false }).click();
  await page.getByRole("textbox", { name: "中文", exact: true }).fill("太阳");
  await page.getByLabel("词表名称").fill("合成延迟保存");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/batches", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  const save = page.getByRole("button", { name: "保存词表", exact: true });
  await save.focus();
  await page.keyboard.press("Enter");
  const busy = page.getByRole("button", { name: /保存词表/ });
  await expect(busy).toHaveAttribute("aria-disabled", "true");
  await expect(busy).toBeFocused();
  await expect(page.getByRole("textbox", { name: "中文", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "OwnClass 听写小站" }).click();
  const response = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/batches"),
  );
  release();
  await response;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole("heading", { name: "今日任务", exact: true })).toBeVisible();
});

test("页面切换更新标题和焦点，空词条保存能定位错误，删除支持撤销", async ({ page }) => {
  await page.goto("./#library");
  await page.getByRole("button", { name: "新建听写", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle(/新建听写/);
  await expect(page.locator("main")).toBeFocused();
  await page.getByRole("button", { name: "手动添加词条", exact: false }).click();
  const save = page.getByRole("button", { name: "保存词表", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  const chinese = page.getByRole("textbox", { name: "中文", exact: true });
  await expect(chinese).toBeFocused();
  await expect(chinese).toHaveAttribute("aria-invalid", "true");
  await expect(chinese).toHaveAccessibleDescription(/中文|英文/);
  await chinese.fill("太阳");
  await expect(chinese).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "删除第 1 词", exact: true }).click();
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "中文", exact: true })).toHaveValue("太阳");
  await expect(page.getByRole("textbox", { name: "中文", exact: true })).toBeFocused();
});

test("筛选空态能清除搜索，输入字号随浏览器字体放大，切页回到正文", async ({ page }) => {
  await page.goto("./#library");
  await page.getByRole("textbox", { name: "搜索词表", exact: true }).fill("不会存在的合成搜索内容");
  await page.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "搜索词表", exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "新建听写", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page
      .getByLabel("选择作业图片")
      .evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(32);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("editor-320-large-text.png"),
    fullPage: true,
  });
});

test("AI 提示词与核对词表的名称、年级、单元和来源字段一致", async ({ page }) => {
  await page.goto("./#library");
  await page.getByRole("button", { name: "新建听写", exact: true }).click();
  await page.getByRole("tab", { name: "AI / JSON" }).click();
  await page.getByText("使用自己的 AI 整理", { exact: true }).click();
  const prompt = await page.getByRole("textbox", { name: "整理提示词", exact: true }).inputValue();
  for (const field of ["title", "grade", "unit", "textbook"])
    expect(prompt).toContain(`"${field}"`);
  expect(prompt).toContain("教材或来源");
  expect(prompt).toContain("原文没有的字段留空串");
});
