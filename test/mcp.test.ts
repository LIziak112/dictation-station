import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { Auth } from "../apps/server/src/auth";
import { Store } from "../apps/server/src/store";
import { Tokens } from "../apps/server/src/tokens";
import { serverDraftResponseSchema } from "../packages/contract/src/index";

it("官方 MCP 客户端通过真实 stdio 建草稿、校验和读取，撤销后立即失效", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-mcp-")));
  const auth = new Auth(store),
    tokens = new Tokens(store);
  const account = await auth.register("parent", "synthetic-password");
  if (!account) throw new Error("测试账号失败");
  const credentials = tokens.create(account.id, {
    name: "测试桥接",
    scopes: ["wordlists:read", "drafts:write"],
    expiresInDays: 1,
  });
  const app = createApp(store, {});
  let port = 0;
  const http = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
    port = info.port;
  });
  if (!http.listening)
    await new Promise<void>((resolveReady) => http.once("listening", resolveReady));
  const address = http.address();
  if (address && typeof address !== "string") port = address.port;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", resolve("packages/mcp/src/index.ts")],
    cwd: process.cwd(),
    env: { DICTATION_URL: `http://127.0.0.1:${port}/`, DICTATION_TOKEN: credentials.token },
    stderr: "pipe",
  });
  const client = new Client({ name: "ownclass-integration-client", version: "0.1.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "create_wordlist_draft",
      "get_wordlist_schema",
      "list_wordlists",
      "validate_wordlist",
    ]);
    const schema = await client.callTool({ name: "get_wordlist_schema", arguments: {} });
    expect(schema.isError).not.toBe(true);
    const invalid = await client.callTool({
      name: "validate_wordlist",
      arguments: { wordlist: { entries: [{ en: "" }] } },
    });
    expect(z.object({ valid: z.boolean() }).parse(invalid.structuredContent).valid).toBe(false);
    const created = await client.callTool({
      name: "create_wordlist_draft",
      arguments: {
        wordlist: { title: "真实 stdio 草稿", entries: [{ en: "apple", zh: "苹果" }] },
        notes: "家长核对后发布",
      },
    });
    expect(created.isError).not.toBe(true);
    expect(serverDraftResponseSchema.parse(created.structuredContent).draft.wordlist.title).toBe(
      "真实 stdio 草稿",
    );
    expect(JSON.stringify(created.content)).toContain("#draft=");
    expect(store.list(account.id)).toHaveLength(0);
    tokens.revoke(account.id, credentials.info.id);
    expect((await client.callTool({ name: "list_wordlists", arguments: {} })).isError).toBe(true);
  } finally {
    await client.close();
    await new Promise<void>((done) => http.close(() => done()));
    store.close();
  }
}, 15000);
