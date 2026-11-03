import { expect } from "@playwright/test";
import { mockMissingSpeech, test } from "./fixtures";

test("选择今日范围、孩子区独立入口与听写、跨设备接力与家长核对", async ({
  page,
  browser,
  baseURL,
}) => {
  // 两个独立上下文往返扫码、刷新和批改，Windows WebKit 需要完整流程预算。
  test.slow();
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
  await expect(
    page.getByRole("heading", { name: "已派发到孩子听写区，等待孩子开始" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "开始任务", exact: true })).toHaveCount(0);
  const taskId = new URL(page.url()).hash.split("task=")[1];
  await page.getByRole("button", { name: "进入孩子区" }).click();
  await expect(page.getByAltText("孩子区入口二维码")).toBeVisible();
  const childLink = await page.getByLabel("孩子区独立链接").inputValue();
  expect(childLink).toContain("child=1&ct=ct_");
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  // 使用无家长登录态的全新浏览器上下文模拟孩子独立平板免密扫码访问
  const childContext = await browser.newContext({ baseURL });
  await childContext.addInitScript(mockMissingSpeech);
  const childPage = await childContext.newPage();
  try {
    await childPage.goto(childLink);
    // ct 参数在加载后立即通过 replaceState 从地址栏抹除
    await expect(childPage).toHaveURL(/\?child=1/);
    expect(childPage.url()).not.toContain("ct=");
    await expect(childPage.getByRole("button", { name: "词库", exact: true })).toHaveCount(0);

    // 孩子区三大板块展示，且磨耳朵词表显示待考词盲听保护徽章
    await childPage.goto("./?child=1");
    await expect(childPage.getByText("01 / 今日听写任务")).toBeVisible();
    await expect(childPage.getByText("02 / 批改结果与错词订正")).toBeVisible();
    await expect(childPage.getByText("03 / 自主磨耳朵（纯听与跟读）")).toBeVisible();
    await expect(childPage.getByText("🔒 2 词盲听保护")).toBeVisible();

    await childPage.getByRole("button", { name: "准备开始" }).click();
    await childPage.getByRole("button", { name: "开始任务", exact: true }).click();
    await expect(childPage.getByText("第 1 / 2 项", { exact: true })).toBeVisible();
    await expect(childPage.getByText("月亮", { exact: true })).toHaveCount(0);
    await childPage.getByRole("button", { name: "我写好了，下一个", exact: true }).click();
    await expect(
      childPage.getByRole("button", { name: "写完了，交卷", exact: true }),
    ).toBeEnabled();

    const data = await (await page.request.get(`api/tasks/${taskId}/play`)).json();
    expect(data.attempt.index).toBe(1);
    expect(data.task.items).toHaveLength(2);
    expect(JSON.stringify(data.task)).not.toContain("月亮");
    const stale = await page.request.put(`api/attempts/${data.attempt.id}`, {
      data: { revision: 1, index: 0, phase: "player", results: {} },
    });
    expect(stale.status()).toBe(409);

    await childPage.reload();
    await expect(childPage.getByText("第 2 / 2 项", { exact: true })).toBeVisible();
    await childPage.getByRole("button", { name: "写完了，交卷", exact: true }).click();
    await expect(childPage.getByText("月亮", { exact: true })).toHaveCount(0);
    await childPage.getByRole("button", { name: "返回任务列表", exact: true }).click();
    await expect(childPage.getByText("待批改", { exact: true })).toBeVisible();

    // 家长端看板收到已交卷待批改提醒并完成批改
    await page.goto("./#today");
    await expect(page.getByText("有 1 份听写已写完交卷，请对照纸面批改")).toBeVisible();
    await page.getByRole("button", { name: "立即批改" }).first().click();
    await expect(page.getByRole("heading", { name: "moon", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "再练一次", exact: true }).first().click();
    await page.getByLabel("已全部核对，其余正确").check();
    await expect(page.getByRole("button", { name: "保存核对并完成" })).toBeEnabled();
    await page.getByRole("button", { name: "保存核对并完成" }).click();
    await expect(page.getByRole("heading", { name: "本次核对记录" })).toBeVisible();

    // 孩子端刷新后在「批改结果与错词订正」板块看到错词并完成订正打卡
    await childPage.reload();
    await expect(childPage.getByText("moon", { exact: true })).toBeVisible();
    await childPage.getByRole("button", { name: "我已订正" }).click();
    await expect(childPage.getByRole("button", { name: "已订正", exact: true })).toBeDisabled();
  } finally {
    await childContext.close();
  }
});
