import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("网页创建令牌、Agent 建草稿、网页核对后才生成正式词表", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "AI 连接", exact: true }).click();
  await page.getByRole("button", { name: "创建令牌", exact: true }).click();
  const token = await page.getByLabel("新令牌", { exact: true }).inputValue();
  const config = await page.locator(".code-block pre").textContent();
  expect(config).not.toBeNull();
  expect(config).toContain('"mcpServers"');
  expect(config).toContain('"type": "http"');
  expect(config).toContain("/tingxie/mcp");
  expect(config).toContain(`Bearer ${token}`);
  const unauthorizedMcp = await page.request.post("mcp", { data: {} });
  expect(unauthorizedMcp.status()).toBe(401);
  const authorizedMcp = await page.request.post("mcp", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  expect(authorizedMcp.status()).not.toBe(404);
  expect(authorizedMcp.status()).not.toBe(401);
  const response = await page.request.post("api/agent/drafts", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      wordlist: { title: "AI 待核对词表", entries: [{ en: "apple", zh: "苹果" }] },
      notes: "请确认老师要求的词义",
    },
  });
  expect(response.status()).toBe(201);
  expect((await (await page.request.get("api/batches")).json()).batches).toHaveLength(0);
  await page.getByRole("button", { name: "刷新草稿与令牌" }).click();
  await page.getByRole("button", { name: "核对并编辑" }).click();
  await expect(page.getByLabel("词表名称", { exact: true })).toHaveValue("AI 待核对词表");
  await expect(page.getByText("请确认老师要求的词义", { exact: true })).toBeVisible();
  await page.getByLabel("词表名称", { exact: true }).fill("已确认的作业词表");
  await page.getByRole("button", { name: "保存词表", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已确认的作业词表", exact: true })).toBeVisible();
  expect((await (await page.request.get("api/drafts")).json()).drafts).toHaveLength(0);
  await page.getByRole("button", { name: "AI 连接", exact: true }).click();
  await page.getByRole("button", { name: "撤销令牌", exact: true }).click();
  expect(
    (
      await page.request.get("api/agent/schema", { headers: { Authorization: `Bearer ${token}` } })
    ).status(),
  ).toBe(401);
});
