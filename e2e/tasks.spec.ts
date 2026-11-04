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
    await expect(childPage).toHaveURL(
      (url) => url.searchParams.get("child") === "1" && !url.searchParams.has("ct"),
    );
    await expect(childPage.getByRole("button", { name: "词库", exact: true })).toHaveCount(0);

    // 孩子区三大板块展示，且磨耳朵词表显示待考词盲听保护徽章
    await childPage.goto("./?child=1");
    await expect(childPage.getByText("今日听写任务", { exact: true })).toBeVisible();
    await expect(childPage.getByText("错词订正", { exact: true })).toBeVisible();
    await childPage.getByRole("tab", { name: "磨耳朵" }).click();
    await expect(childPage.getByText("自主磨耳朵", { exact: true })).toBeVisible();
    await expect(childPage.getByText("🔒 2 词盲听保护")).toBeVisible();
    await childPage.getByRole("tab", { name: "今天" }).click();

    await childPage.getByRole("button", { name: "准备开始" }).click();
    await childPage.getByRole("button", { name: "开始任务", exact: true }).click();
    await expect(childPage.getByText("第 1 / 2 项", { exact: true })).toBeVisible();
    childPage.once("dialog", (dialog) => void dialog.accept());
    await childPage.getByRole("button", { name: "提前交卷", exact: true }).click();
    await page.goto("./#today");
    await expect(page.getByText("提前交卷，停在第 1/2 项", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: "立即批改" }).first().click();
    await expect(page.getByText("提前交卷 · 交卷时停在第 1/2 项", { exact: false })).toBeVisible();
    await page.getByText("退回给孩子继续听写").click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "确认退回任务" }).click();
    await childPage.reload();
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
    await expect(childPage.getByText("写完啦，你真棒！")).toBeVisible();
    await expect(childPage.getByText("月亮", { exact: true })).toHaveCount(0);
    await childPage.getByRole("button", { name: "返回任务列表", exact: true }).click();
    await expect(childPage.getByText("待批改", { exact: true }).first()).toBeVisible();

    // 家长端看板收到已交卷待批改提醒并完成批改
    await page.goto("./#today");
    await page.reload();
    await expect(
      page.getByRole("region", { name: "待批改任务提醒" }).getByText("今天的听写"),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const banner = await page.locator(".review-alert-banner").boundingBox();
    const card = await page.locator(".task-timeline .task-card").first().boundingBox();
    expect(banner && card && Math.abs(banner.x - card.x)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "立即批改 今天的听写" })).toBeVisible();
    await page.getByRole("button", { name: "立即批改" }).first().click();
    await expect(page.getByRole("heading", { name: "moon", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "按序号批改" }).click();
    await page.getByRole("button", { name: "第 2 题，未选为错题" }).click();
    await page.getByRole("button", { name: "保存错题标记" }).click();
    await expect(page.getByRole("button", { name: "未通过", exact: true }).nth(1)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "按序号批改" }).click();
    await page.getByRole("button", { name: "第 2 题，未通过" }).click();
    await page.getByRole("button", { name: "保存错题标记" }).click();
    await expect(page.getByRole("button", { name: "未通过", exact: true }).nth(1)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.getByRole("button", { name: "未通过", exact: true }).first().click();
    await page.getByText("退回给孩子继续听写").click();
    await expect(
      page.getByText("退回的是整份任务，不是只重做错题；本次所有批改标记都会清除。"),
    ).toBeVisible();
    await expect(page.getByLabel("从交卷时的位置继续听写")).toBeChecked();
    await page.getByLabel("从第一题重新听写整份任务").check();
    await expect(page.getByLabel("从第一题重新听写整份任务")).toBeChecked();
    await page.setViewportSize({ width: 320, height: 844 });
    const completion = page.locator(".review-completion");
    for (const direction of ["ltr", "rtl"]) {
      await page.evaluate((dir) => {
        document.documentElement.dir = dir;
        document.body.style.zoom = "2";
      }, direction);
      await expect
        .poll(() => completion.evaluate((element) => element.scrollWidth <= element.clientWidth))
        .toBe(true);
      await expect(page.getByRole("button", { name: "确认退回任务" })).toBeVisible();
    }
    await page.evaluate(() => {
      document.documentElement.dir = "ltr";
      document.body.style.zoom = "";
    });
    await page.getByLabel("已全部核对，其余未标记的题目均正确").check();
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
