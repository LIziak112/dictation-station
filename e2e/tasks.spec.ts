import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("选择今日范围、孩子区听写、跨设备接力与家长核对", async ({ page, browser, baseURL }) => {
  const created = await page.request.post("api/batches", {
    data: {
      title: "今日英语范围",
      entries: [
        { en: "apple", zh: "苹果" },
        { en: "moon", zh: "月亮" },
        { en: "bank", zh: "银行" },
      ],
    },
  });
  const { batch } = await created.json();
  await page.goto("./");
  await page.getByRole("button", { name: "安排任务", exact: true }).click();
  await page.getByRole("combobox", { name: "练法", exact: true }).selectOption("en2en");
  await page.getByRole("combobox", { name: "添加词表", exact: true }).selectOption(batch.id);
  await page.getByLabel("编号范围").fill("2-3");
  await page.getByRole("button", { name: "应用范围到此词表" }).click();
  await expect(page.getByText("2 项作业", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "发布任务", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始任务", exact: true })).toBeVisible();
  const taskId = new URL(page.url()).hash.split("task=")[1];
  await page.getByRole("button", { name: "进入孩子区" }).click();
  await page.getByLabel("四位数字口令").fill("1234");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("button", { name: "词库", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "准备开始" }).click();
  await page.getByRole("button", { name: "开始任务", exact: true }).click();
  await expect(page.getByText("第 1 / 2 项", { exact: true })).toBeVisible();
  await expect(page.getByText("月亮", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "我写好了，下一个", exact: true }).click();
  await expect(page.getByRole("button", { name: "写完了，去核对", exact: true })).toBeEnabled();
  const second = await browser.newContext({
    baseURL,
    storageState: { cookies: await page.context().cookies(), origins: [] },
  });
  try {
    const data = await (await second.request.get(`api/tasks/${taskId}/play`)).json();
    expect(data.attempt.index).toBe(1);
    expect(data.task.items).toHaveLength(2);
    expect(JSON.stringify(data.task)).not.toContain("月亮");
    const stale = await second.request.put(`api/attempts/${data.attempt.id}`, {
      data: { revision: 1, index: 0, phase: "player", results: {} },
    });
    expect(stale.status()).toBe(409);
  } finally {
    await second.close();
  }
  await page.reload();
  await expect(page.getByText("第 2 / 2 项", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "写完了，去核对", exact: true }).click();
  await page.getByRole("button", { name: "请家长核对", exact: true }).click();
  await expect(page.getByText("月亮", { exact: true })).toHaveCount(0);
  await page.getByLabel("四位数字口令").fill("1234");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("heading", { name: "moon", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "再练一次", exact: true }).first().click();
  await page.getByLabel("已全部核对，其余正确").check();
  await expect(page.getByRole("button", { name: "保存核对并完成" })).toBeEnabled();
  await page.getByRole("button", { name: "保存核对并完成" }).click();
  await expect(page.getByRole("heading", { name: "本次核对记录" })).toBeVisible();
});
