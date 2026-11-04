import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("核对进入待巩固，生成阶段复习与记录周报，订正不增加通过次数", async ({ page }) => {
  const batch = (
    await (
      await page.request.post("api/batches", {
        data: { title: "旧作业", entries: [{ en: "sun", zh: "太阳" }] },
      })
    ).json()
  ).batch;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const task = (
    await (
      await page.request.post("api/tasks", {
        data: {
          title: "已完成的作业",
          date: today,
          mode: "en2en",
          selections: [{ batchId: batch.id, entryIds: [batch.entries[0].id] }],
          reviewCount: 0,
        },
      })
    ).json()
  ).task;
  const attempt = (
    await (
      await page.request.post(`api/tasks/${task.id}/start`, {
        data: { deviceId: "fixture-device" },
      })
    ).json()
  ).attempt;
  const reviewing = await page.request.put(`api/attempts/${attempt.id}`, {
    data: {
      deviceId: "fixture-device",
      revision: 1,
      index: 0,
      phase: "review",
      results: { [task.items[0].wordId]: "wrong" },
    },
  });
  expect(reviewing.status()).toBe(200);
  expect(
    (
      await page.request.post(`api/attempts/${attempt.id}/complete`, {
        data: { revision: 2, confirmRemaining: false },
      })
    ).status(),
  ).toBe(200);
  await page.goto("./");
  await page.getByRole("button", { name: "待巩固", exact: true }).click();
  await expect(page.getByText("sun", { exact: true })).toBeVisible();
  await expect(page.getByText("独立通过 0/3", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "汇总这个阶段" }).click();
  await expect(page.getByRole("button", { name: "生成阶段复习任务" })).toBeEnabled();
  await page.getByRole("button", { name: "生成阶段复习任务" }).click();
  await expect(
    page.getByRole("heading", { name: "已派发到孩子听写区，等待孩子开始" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "开始任务", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "这周的三件事" })).toBeVisible();
  await page.getByRole("button", { name: "查看核对与订正" }).click();
  await page.getByRole("button", { name: "记为已订正", exact: true }).click();
  await expect(page.getByRole("button", { name: "已订正", exact: true })).toBeDisabled();
  const items = (await (await page.request.get("api/learning")).json()).items;
  expect(items[0].state.streak).toBe(0);
});
