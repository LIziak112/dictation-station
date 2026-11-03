import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("孩子入口生成失败时显示重试提示，不提供无凭证链接", async ({ page }) => {
  await page.route("**/api/child-token", (route) =>
    route.fulfill({ status: 503, json: { error: "连接中断" } }),
  );
  await page.goto("./");
  await page.getByRole("button", { name: "进入孩子区", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("重新打开孩子区链接重试");
  await expect(page.getByLabel("孩子区独立链接")).toHaveCount(0);
  await page.unroute("**/api/child-token");
  await page.getByRole("button", { name: "进入孩子区", exact: true }).click();
  await expect(page.getByLabel("孩子区独立链接")).toHaveValue(/ct=ct_/);
});

test("主流程在窄屏和双倍文字下完整显示，导航后焦点进入正文", async ({ page }) => {
  await page.goto("./");
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: test.info().outputPath(`today-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole("button", { name: "记录", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle(/记录/);
  await expect(page.locator("main")).toBeFocused();
  await page.reload();
  await expect(page.getByRole("heading", { name: "听写记录" })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("任务读取失败提供重试，浏览器返回不会丢失未落盘草稿", async ({ page }) => {
  await page.route("**/api/tasks", (route) =>
    route.fulfill({ status: 503, json: { error: "合成网络故障" } }),
  );
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText("重试");
  await expect(page.getByRole("heading", { name: "还没有安排任务" })).toHaveCount(0);
  await page.unroute("**/api/tasks");
  await page.getByRole("button", { name: "重新读取任务" }).click();
  await expect(page.getByRole("heading", { name: "还没有安排任务" })).toBeVisible();
  await page.getByRole("button", { name: "词库", exact: true }).click();
  await page.getByRole("button", { name: "新建听写", exact: true }).click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("合成存储失败");
    };
  });
  await page.getByRole("textbox", { name: "作业原文", exact: true }).fill("sun 太阳");
  await page.evaluate(() => {
    location.hash = "history";
  });
  await expect(page.getByRole("textbox", { name: "作业原文", exact: true })).toHaveValue(
    "sun 太阳",
  );
  await expect(page).toHaveURL(/#library$/);
});

test("深色控件的真实文字对比可读，主题切换不保留颜色过渡", async ({ page }) => {
  await page.goto("./");
  await page.locator(".user-menu > summary").click();
  await page.getByRole("button", { name: "切换深色" }).click();
  await page.screenshot({ path: test.info().outputPath("today-dark.png"), fullPage: true });
  const ratio = await page
    .getByRole("button", { name: "安排任务", exact: true })
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const rgb =
          color
            .match(/[\d.]+/g)
            ?.slice(0, 3)
            .map(Number) ?? [];
        const linear = rgb.map((value) => {
          const v = value / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      const first = luminance(style.color),
        second = luminance(style.backgroundColor);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
