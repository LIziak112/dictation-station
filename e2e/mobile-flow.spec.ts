import { expect } from "@playwright/test";
import { test } from "./fixtures";

for (const width of [320, 390]) {
  test(`${width}px 手机：听写暂停继续、交卷失败重试、批改订正和打印`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      const state = window as unknown as { spoken: string[] };
      state.spoken = [];
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          speak: (utterance: SpeechSynthesisUtterance) => {
            state.spoken.push(utterance.text);
            setTimeout(
              () => utterance.onend?.call(utterance, new Event("end") as SpeechSynthesisEvent),
              0,
            );
          },
          cancel: () => {},
        },
      });
      if (!window.SpeechSynthesisUtterance)
        Object.defineProperty(window, "SpeechSynthesisUtterance", {
          value: class {
            constructor(public text: string) {}
          },
        });
    });
    const { batch } = await (
      await page.request.post("api/batches", {
        data: {
          title: "第三单元 · 今天的英语听写与复习",
          entries: [
            { en: "moon", zh: "月亮" },
            { en: "bank", zh: "银行" },
          ],
        },
      })
    ).json();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const { task } = await (
      await page.request.post("api/tasks", {
        data: {
          title: batch.title,
          date,
          mode: "en2en",
          reviewCount: 0,
          selections: [
            { batchId: batch.id, entryIds: batch.entries.map((e: { id: string }) => e.id) },
          ],
        },
      })
    ).json();
    async function inspect(screen: string) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: test.info().outputPath(`${screen}-${width}.png`),
        fullPage: true,
      });
    }
    await page.goto("./");
    await expect(page.getByRole("heading", { name: task.title })).toBeVisible();
    await inspect("parent");
    await page.getByRole("button", { name: "安排任务", exact: true }).click();
    await page.getByRole("combobox", { name: "练法", exact: true }).selectOption("en2en");
    await page.getByRole("combobox", { name: "添加词表", exact: true }).selectOption(batch.id);
    await expect(page.getByText("2 项作业", { exact: false })).toBeVisible();
    await inspect("compose");
    await page.goto(`./#batch=${batch.id}`);
    await page.getByRole("button", { name: "编辑词表", exact: true }).click();
    await expect(page.locator(".entry-cell input").first()).toBeVisible();
    expect(
      await page
        .locator(".entry-cell input")
        .first()
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    await inspect("editor");
    const { token } = await (await page.request.post("api/child-token")).json();
    await page.goto(`./?child=1&ct=${token}`);
    await expect(page.getByRole("button", { name: "准备开始" })).toBeVisible();
    await inspect("child");
    await page.getByRole("button", { name: "纯听磨耳朵" }).click();
    await page.getByRole("button", { name: "开始播放" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { spoken: string[] }).spoken.includes("moon")),
      )
      .toBe(true);
    expect(
      await page.evaluate(() =>
        (window as unknown as { spoken: string[] }).spoken.some((text) => text.includes("待考词")),
      ),
    ).toBe(false);
    await inspect("listen");
    await page.goto(`./?child=1#task=${task.id}`);
    await page.getByRole("button", { name: "开始任务", exact: true }).click();
    await page.getByRole("button", { name: "我写好了，下一个" }).click();
    await page.getByRole("button", { name: "暂停练习", exact: true }).click();
    await page.getByRole("button", { name: "暂存并返回" }).click();
    await page.getByRole("button", { name: "继续任务" }).click();
    await expect(page.getByText("第 2 / 2 项", { exact: true })).toBeVisible();
    await inspect("player");
    await page.route("**/api/attempts/*", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 503, json: { error: "连接中断，请重试" } })
        : route.continue(),
    );
    await page.getByRole("button", { name: "写完了，交卷" }).click();
    await expect(page.getByRole("heading", { name: "尚未交卷，请重试同步" })).toBeVisible();
    await expect(page.getByText("已交卷。请把听写纸交给家长，批改后可以订正错词。")).toHaveCount(0);
    await inspect("submit-error");
    await page.unroute("**/api/attempts/*");
    await page.getByRole("button", { name: "重试同步", exact: true }).click();
    await expect(page.getByRole("heading", { name: "写完了，已交卷给家长批改" })).toBeVisible();
    const { attempt } = await (await page.request.get(`api/tasks/${task.id}/play`)).json();
    await page.goto(`./#review=${attempt.id}`);
    await page.getByRole("button", { name: "未通过", exact: true }).first().click();
    await inspect("review");
    await page.getByLabel("已全部核对，其余未标记的题目均正确").check();
    await page.getByRole("button", { name: "保存核对并完成" }).click();
    await expect(page.getByRole("heading", { name: "本次核对记录" })).toBeVisible();
    await page.getByRole("button", { name: "打印练习纸", exact: true }).click();
    await inspect("print");
    await expect(page.getByTestId("print-answers")).toHaveCount(0);
    await page.goto("./?child=1");
    await page.getByRole("button", { name: "我已订正" }).click();
    await expect(page.getByRole("button", { name: "已订正", exact: true })).toBeDisabled();
    await inspect("correction");
  });
}
