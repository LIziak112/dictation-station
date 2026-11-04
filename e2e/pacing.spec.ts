import { expect } from "@playwright/test";
import { defaultSettings } from "../packages/contract/src/index";
import { test } from "./fixtures";

test("手动推进五项后组间休息，可立即继续，并切换深色", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { requests: 0, releases: 0 };
    Object.assign(window, { wakeTestState: state });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          state.requests++;
          return {
            release: async () => {
              state.releases++;
            },
          };
        },
      },
    });
  });
  await page.addInitScript(() =>
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (utterance: SpeechSynthesisUtterance) =>
          setTimeout(
            () => utterance.onend?.call(utterance, new Event("end") as SpeechSynthesisEvent),
            0,
          ),
        cancel: () => {},
      },
    }),
  );
  const batch = (
    await (
      await page.request.post("api/batches", {
        data: {
          entries: Array.from({ length: 6 }, (_, index) => ({
            en: `word ${index + 1}`,
            zh: `词语${index + 1}`,
          })),
        },
      })
    ).json()
  ).batch;
  const task = (
    await (
      await page.request.post("api/tasks", {
        data: {
          title: "六项分组",
          date: "2026-11-03",
          mode: "en2en",
          settings: { ...defaultSettings, repeat: 1 },
          selections: [
            { batchId: batch.id, entryIds: batch.entries.map((entry: { id: string }) => entry.id) },
          ],
          reviewCount: 0,
        },
      })
    ).json()
  ).task;
  const { token } = await (await page.request.post("api/child-token")).json();
  await page.goto(`./?child=1&ct=${encodeURIComponent(token)}#task=${task.id}`);
  await page.getByRole("button", { name: "开始任务", exact: true }).click();
  for (let index = 0; index < 5; index++)
    await page.getByRole("button", { name: "我写好了，下一个", exact: true }).click();
  await expect(page.getByRole("heading", { name: "上一组写完了，歇一会儿" })).toBeVisible();
  await page.getByRole("button", { name: "准备好了，继续", exact: true }).click();
  await expect(page.getByText("第 6 / 6 项", { exact: true })).toBeVisible();
  await page.locator(".user-menu > summary").click();
  await page.getByRole("button", { name: "切换深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.locator(".task-session").getByRole("button", { name: "切换全屏" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { wakeTestState: { requests: number } }).wakeTestState.requests,
      ),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { wakeTestState: { releases: number } }).wakeTestState.releases,
      ),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { wakeTestState: { requests: number } }).wakeTestState.requests,
      ),
    )
    .toBeGreaterThan(1);
});
