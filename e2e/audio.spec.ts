import { expect } from "@playwright/test";
import { defaultSettings } from "../packages/contract/src/index";
import { test } from "./fixtures";

test("真人文件无法解码时重新请求合成兜底，覆盖数字反映实际发音", async ({ page }) => {
  const batch = (
    await (
      await page.request.post("api/batches", { data: { entries: [{ en: "sun", zh: "太阳" }] } })
    ).json()
  ).batch;
  const task = (
    await (
      await page.request.post("api/tasks", {
        data: {
          title: "检查声音",
          date: "2026-11-03",
          mode: "en2en",
          selections: [{ batchId: batch.id, entryIds: [batch.entries[0].id] }],
          reviewCount: 0,
        },
      })
    ).json()
  ).task;
  let downgraded = false;
  await page.route(`**/api/tasks/${task.id}/audio`, async (route) => {
    const fallback = route.request().postDataJSON().fallbackIds?.length > 0;
    downgraded ||= fallback;
    await route.fulfill({
      json: {
        audio: [
          {
            wordId: task.items[0].wordId,
            text: "sun",
            lang: "en",
            id: "test-source",
            kind: fallback ? "device" : "human",
            url: fallback ? null : "audio/unplayable.ogg",
            source: fallback ? "设备合成语音" : "合成测试来源",
            sourceUrl: "https://example.org/source",
            author: "测试作者",
            licenseName: "测试许可",
            licenseUrl: "https://example.org/license",
            title: "测试声音",
            reading: "",
            accent: "us",
            warning: "",
          },
        ],
      },
    });
  });
  await page.route("**/audio/unplayable.ogg", (route) =>
    route.fulfill({ status: 200, contentType: "audio/ogg", body: "synthetic broken file" }),
  );
  await page.goto(`./#task=${task.id}`);
  await expect(page.getByText("真人 0 · 合成 1 · 不可用 0", { exact: true })).toBeVisible();
  expect(downgraded).toBe(true);
  await expect(page.getByRole("button", { name: "开始任务", exact: true })).toHaveCount(0);
});

for (const source of ["missing", "ready", "broken", "slow"] as const) {
  test(`孩子直接开始：${source} 音频不阻塞，未准备或故障时机器朗读`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      const state = window as unknown as { spoken: string[]; filesPlayed: number };
      state.spoken = [];
      state.filesPlayed = 0;
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          cancel() {},
          speak(utterance: SpeechSynthesisUtterance) {
            state.spoken.push(utterance.text);
            setTimeout(
              () => utterance.onend?.call(utterance, new Event("end") as SpeechSynthesisEvent),
              0,
            );
          },
        },
      });
    });
    if (source === "ready")
      await page.addInitScript(() => {
        HTMLMediaElement.prototype.play = function () {
          (window as unknown as { filesPlayed: number }).filesPlayed++;
          setTimeout(() => this.dispatchEvent(new Event("ended")), 0);
          return Promise.resolve();
        };
      });
    const { batch } = await (
      await page.request.post("api/batches", {
        data: {
          entries: Array.from({ length: source === "missing" ? 110 : 1 }, (_, i) => ({
            en: i ? `word ${i}` : "sun",
            zh: "太阳",
          })),
        },
      })
    ).json();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const { task } = await (
      await page.request.post("api/tasks", {
        data: {
          title: "直接开始听写",
          date,
          mode: "en2en",
          reviewCount: 0,
          settings: { ...defaultSettings, repeat: 1, guidance: false },
          selections: [
            { batchId: batch.id, entryIds: batch.entries.map((e: { id: string }) => e.id) },
          ],
        },
      })
    ).json();
    let preparationRequests = 0;
    let fileRequests = 0;
    await page.route(`**/api/tasks/${task.id}/audio`, (route) => {
      preparationRequests++;
      return route.fulfill({ status: 503 });
    });
    if (source !== "missing") {
      await page.route(`**/api/tasks/${task.id}/play`, async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        data.task.audio = [
          {
            wordId: task.items[0].wordId,
            text: "sun",
            lang: "en",
            id: "prepared",
            kind: "human",
            url: "audio/prepared.wav",
            source: "家长已准备",
            sourceUrl: "",
            author: "",
            licenseName: "",
            licenseUrl: "",
            title: "",
            reading: "",
            accent: "us",
            warning: "",
          },
        ];
        await route.fulfill({ response, json: data });
      });
      await page.route("**/audio/prepared.wav", async (route) => {
        fileRequests++;
        if (source === "slow") await new Promise((resolve) => setTimeout(resolve, 4000));
        await route.fulfill({ contentType: "audio/wav", body: "synthetic audio" });
      });
    }
    await page.goto(`./?child=1#task=${task.id}`);
    await expect(page.getByRole("button", { name: "开始任务", exact: true })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "准备声音", exact: true })).toHaveCount(0);
    expect(fileRequests).toBe(0);
    await page.screenshot({
      path: test.info().outputPath(`child-start-${source}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "开始任务", exact: true }).click();
    await expect(
      page.getByText(`第 1 / ${source === "missing" ? 110 : 1} 项`, { exact: true }),
    ).toBeVisible();
    if (source === "ready") {
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { filesPlayed: number }).filesPlayed))
        .toBeGreaterThan(0);
      expect(
        await page.evaluate(() => (window as unknown as { spoken: string[] }).spoken),
      ).not.toContain("sun");
    } else {
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken))
        .toContain("sun");
    }
    expect(preparationRequests).toBe(0);
    if (source !== "missing") expect(fileRequests).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
