import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("另一个标签页进入孩子区后，家长页要求登录而不是误用孩子权限", async ({ page, context }) => {
  await page.goto("./");
  const { account } = await (await page.request.get("api/auth/me")).json();
  const { token } = await (await page.request.post("api/child-token")).json();
  const childPage = await context.newPage();
  await childPage.goto(`./?child=1&ct=${encodeURIComponent(token)}`);
  await expect(childPage.getByRole("button", { name: "返回家长端" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await page.getByLabel("用户名").fill(account.username);
  await page.getByLabel("密码", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今日任务" })).toBeVisible();
  await expect(childPage.getByRole("button", { name: "返回家长端" })).toBeVisible();
  const blocked = await childPage.evaluate(() =>
    fetch("api/batches", {
      headers: { "X-Child-Token": localStorage.getItem("ownclass:dictation:child-token") || "" },
    }).then((r) => r.status),
  );
  expect(blocked).toBe(403);
});

test("只在学生端返回时显示本机 PIN，学生端没有家长会话", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "今日任务" })).toBeVisible();
  await page.getByLabel("账号", { exact: true }).click();
  await page.getByText("家长 PIN 设置").click();
  await page.getByLabel("新 PIN").fill("2468");
  await page.getByLabel("确认 PIN").fill("1357");
  await page.getByRole("button", { name: "保存 PIN" }).click();
  await expect(page.getByText("两次输入的 PIN 不一致")).toBeVisible();
  await page.getByLabel("确认 PIN").fill("2468");
  await page.getByRole("button", { name: "保存 PIN" }).click();
  await expect(page.getByText("本机家长 PIN 已保存")).toBeVisible();
  const token = await (await page.request.post("api/child-token")).json();
  await page.goto(`./?child=1&ct=${encodeURIComponent(token.token)}`);
  await expect(page.getByRole("button", { name: "返回家长端" })).toBeVisible();
  expect((await page.request.get("api/batches")).status()).toBe(403);
  const wrongPin = await page.evaluate(async () => {
    const token = localStorage.getItem("ownclass:dictation:child-token") || "";
    const deviceId = localStorage.getItem("ownclass:dictation:parent-device");
    return fetch("api/auth/unlock-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Child-Token": token },
      body: JSON.stringify({ deviceId, pin: "1111" }),
    }).then((r) => r.status);
  });
  expect(wrongPin).toBe(400);
  expect((await page.request.get("api/batches")).status()).toBe(403);
  await page.getByRole("button", { name: "返回家长端" }).click();
  await expect(page.getByRole("heading", { name: "请家长确认" })).toBeVisible();
  await page.getByLabel("四位数字口令").fill("2468");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今日任务" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "今日任务" })).toBeVisible();
  await page.goto(`./?child=1&ct=${encodeURIComponent(token.token)}`);
  await page.getByRole("button", { name: "返回家长端" }).click();
  await expect(page.getByRole("heading", { name: "请家长确认" })).toBeVisible();
  await page.getByLabel("四位数字口令").fill("1111");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("口令不正确，请重试");
  await page.getByRole("button", { name: "忘记本机口令" }).click();
  await page.getByLabel("账号密码").fill("incorrect-password");
  await page.getByRole("button", { name: "验证并重设" }).click();
  await expect(page.getByRole("alert")).toHaveText("账号密码不正确");
  await page.getByLabel("账号密码").fill("synthetic-password");
  await page.getByRole("button", { name: "验证并重设" }).click();
  await expect(page.getByRole("heading", { name: "设置本机家长口令" })).toBeVisible();
  await expect(page.getByLabel("四位数字口令")).toHaveValue("");
  await page.getByLabel("四位数字口令").fill("1357");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今日任务" })).toBeVisible();
});
