import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

test("注册、同账号跨设备读取、不同账号隔离及本机草稿隔离", async ({ page, browser, baseURL }) => {
  const username = `parent_${randomBytes(8).toString("hex")}`;
  const password = "synthetic-password";
  await page.goto("./");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByRole("button", { name: "词库", exact: true }).click();
  await expect(page.getByRole("button", { name: "新建听写", exact: true })).toBeVisible();
  const created = await page.request.post("api/batches", {
    data: {
      title: "仅本账号的词表",
      entries: [{ en: "sun", zh: "太阳" }],
    },
  });
  expect(created.status()).toBe(201);
  const { batch } = await created.json();
  const second = await browser.newContext({ baseURL });
  try {
    expect((await second.request.get(`api/batches/${batch.id}`)).status()).toBe(401);
    expect(
      (await second.request.post("api/auth/login", { data: { username, password } })).status(),
    ).toBe(200);
    expect((await second.request.get(`api/batches/${batch.id}`)).status()).toBe(200);
    await second.request.post("api/auth/logout");
    await second.request.post("api/auth/register", {
      data: { username: `${username}_other`, password },
    });
    expect((await second.request.get(`api/batches/${batch.id}`)).status()).toBe(404);
    expect(await (await second.request.get("api/batches")).json()).toEqual({ batches: [] });
  } finally {
    await second.close();
  }
  await page.getByRole("button", { name: "新建听写", exact: true }).click();
  await page.getByRole("textbox", { name: "作业原文", exact: true }).fill("sun 太阳");
  await page.getByText("账号", { exact: true }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(`${username}_third`);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByRole("button", { name: "词库", exact: true }).click();
  await expect(page.getByRole("button", { name: "新建听写", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复草稿", exact: true })).toHaveCount(0);
  await page.getByText("账号", { exact: true }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "词库", exact: true }).click();
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "作业原文", exact: true })).toHaveValue(
    "sun 太阳",
  );
});
