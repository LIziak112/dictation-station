import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { Auth } from "../apps/server/src/auth";
import { Store } from "../apps/server/src/store";
import { Tokens } from "../apps/server/src/tokens";
import { serverDraftResponseSchema } from "../packages/contract/src/index";

it("草稿链接区分公网入口、内部前缀与可信反代协议", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-draft-links-")));
  try {
    const account = await new Auth(store).register("parent", "synthetic-password");
    if (!account) throw new Error("测试账号失败");
    const { token } = new Tokens(store).create(account.id, {
      name: "确认链接测试",
      scopes: ["drafts:write"],
    });
    const cases: {
      options: Parameters<typeof createApp>[1];
      protocol: string;
      expected: string;
    }[] = [
      { options: {}, protocol: "https", expected: "http://dictation.test/" },
      { options: { trustProxy: true }, protocol: "https", expected: "https://dictation.test/" },
      { options: { trustProxy: true }, protocol: "invalid", expected: "http://dictation.test/" },
      {
        options: { basePath: "/tingxie" },
        protocol: "https",
        expected: "http://dictation.test/tingxie/",
      },
      {
        options: { basePath: "/internal", publicUrl: "https://review.example.org/practice" },
        protocol: "http",
        expected: "https://review.example.org/practice/",
      },
    ];
    for (const { options, protocol, expected } of cases) {
      const app = createApp(store, options);
      const response = await app.request("http://dictation.test/api/agent/drafts?ignored=1", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Forwarded-Proto": protocol,
        },
        body: JSON.stringify({
          wordlist: { title: "确认链接", entries: [{ en: "ruler", zh: "尺子" }] },
        }),
      });
      expect(response.status).toBe(201);
      const result = serverDraftResponseSchema.parse(await response.json());
      expect(result.confirmUrl).toBe(`${expected}#draft=${result.draft.id}`);
    }
    for (const publicUrl of [
      "not a URL",
      "ftp://example.org/",
      "https://user:password@example.org/",
      "https://example.org/?query=1",
      "https://example.org/#draft=wrong",
    ]) {
      expect(() => createApp(store, { publicUrl })).toThrow();
    }
  } finally {
    store.close();
  }
});

it.each([
  { publicUrl: "https://review.example.org/practice/", clientPath: "/" },
  { publicUrl: undefined, clientPath: "/lessons/dictation/" },
])(
  "stdio 传递完整入口（$clientPath），支持反代剥离前缀与公网覆盖",
  async ({ publicUrl, clientPath }) => {
    const store = new Store(mkdtempSync(join(tmpdir(), "dictation-mcp-")));
    const auth = new Auth(store),
      tokens = new Tokens(store);
    const account = await auth.register("parent", "synthetic-password");
    if (!account) throw new Error("测试账号失败");
    const credentials = tokens.create(account.id, {
      name: "测试桥接",
      scopes: ["wordlists:read", "drafts:write", "history:read"],
      expiresInDays: 1,
    });
    const app = createApp(store, { publicUrl });
    let port = 0;
    const http = serve(
      {
        fetch: (request) => {
          const url = new URL(request.url);
          url.pathname = `/${url.pathname.slice(clientPath.length)}`;
          return app.fetch(new Request(url, request));
        },
        port: 0,
        hostname: "127.0.0.1",
      },
      (info) => {
        port = info.port;
      },
    );
    if (!http.listening)
      await new Promise<void>((resolveReady) => http.once("listening", resolveReady));
    const address = http.address();
    if (address && typeof address !== "string") port = address.port;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", resolve("packages/mcp/src/index.ts")],
      cwd: process.cwd(),
      env: {
        DICTATION_URL: `http://127.0.0.1:${port}${clientPath}`,
        DICTATION_TOKEN: credentials.token,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "ownclass-integration-client", version: "0.1.0" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "create_wordlist_draft",
        "get_wordlist_schema",
        "list_dictation_history",
        "list_wordlists",
        "validate_wordlist",
      ]);
      const schema = await client.callTool({ name: "get_wordlist_schema", arguments: {} });
      expect(schema.isError).not.toBe(true);
      expect(
        (await client.callTool({ name: "list_dictation_history", arguments: {} }))
          .structuredContent,
      ).toEqual({ items: [] });
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
      const draft = serverDraftResponseSchema.parse(created.structuredContent).draft;
      expect(JSON.stringify(created.content)).toContain(
        `${publicUrl ?? `http://127.0.0.1:${port}${clientPath}`}#draft=${draft.id}`,
      );
      expect(store.list(account.id)).toHaveLength(0);
      tokens.revoke(account.id, credentials.info.id);
      expect((await client.callTool({ name: "list_wordlists", arguments: {} })).isError).toBe(true);
    } finally {
      await client.close();
      await new Promise<void>((done) => http.close(() => done()));
      store.close();
    }
  },
  15000,
);

it.each([
  { deployment: "根路径", options: {}, publicBase: "", clientPath: "" },
  { deployment: "保留子路径", options: { basePath: "/tingxie" }, publicBase: "", clientPath: "" },
  {
    deployment: "反代剥离子路径",
    options: { publicUrl: "https://review.example.org/practice/" },
    publicBase: "https://review.example.org/practice/",
    clientPath: "",
  },
  {
    deployment: "自动携带多层子路径且不配置 PUBLIC_URL",
    options: {},
    publicBase: "",
    clientPath: "/lessons/dictation/",
  },
])(
  "$deployment：远程 MCP 返回完整确认链接，令牌失效后拒绝调用",
  async ({ options, publicBase, clientPath }) => {
    const store = new Store(mkdtempSync(join(tmpdir(), "dictation-mcp-http-")));
    const auth = new Auth(store),
      tokens = new Tokens(store);
    const account = await auth.register("parent", "synthetic-password");
    if (!account) throw new Error("测试账号失败");
    const credentials = tokens.create(account.id, {
      name: "远程 MCP",
      scopes: ["wordlists:read", "drafts:write"],
      expiresInDays: 1,
    });
    const app = createApp(store, options);
    let port = 0;
    const http = serve(
      {
        fetch: (request) => {
          if (!clientPath) return app.fetch(request);
          const url = new URL(request.url);
          url.pathname = `/${url.pathname.slice(clientPath.length)}`;
          return app.fetch(new Request(url, request));
        },
        port: 0,
        hostname: "127.0.0.1",
      },
      (info) => {
        port = info.port;
      },
    );
    if (!http.listening)
      await new Promise<void>((resolveReady) => http.once("listening", resolveReady));
    const address = http.address();
    if (address && typeof address !== "string") port = address.port;
    const mcpUrl = new URL(`http://127.0.0.1:${port}${clientPath || "/"}mcp`);
    const headers: Record<string, string> = { Authorization: `Bearer ${credentials.token}` };
    if (clientPath) headers["X-Dictation-Site-Url"] = `http://127.0.0.1:${port}${clientPath}`;
    const transport = new StreamableHTTPClientTransport(mcpUrl, {
      requestInit: { headers },
    });
    const client = new Client({ name: "ownclass-http-client", version: "0.1.0" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "create_wordlist_draft",
        "get_wordlist_schema",
        "list_dictation_history",
        "list_wordlists",
        "validate_wordlist",
      ]);
      expect(
        (await client.callTool({ name: "list_dictation_history", arguments: {} })).isError,
      ).toBe(true);
      const created = await client.callTool({
        name: "create_wordlist_draft",
        arguments: {
          wordlist: { title: "远程 MCP 草稿", entries: [{ en: "apple", zh: "苹果" }] },
          notes: "家长核对后发布",
        },
      });
      expect(created.isError).not.toBe(true);
      const result = serverDraftResponseSchema.parse(created.structuredContent);
      expect(result.draft.wordlist.title).toBe("远程 MCP 草稿");
      const expectedBase =
        publicBase || `http://127.0.0.1:${port}${clientPath || `${options.basePath ?? ""}/`}`;
      expect(result.confirmUrl).toBe(`${expectedBase}#draft=${result.draft.id}`);
      const text = JSON.stringify(created.content);
      expect(text).toContain(`${expectedBase}#draft=${result.draft.id}`);
      const apiResponse = await fetch(
        `http://127.0.0.1:${port}${clientPath || "/"}api/agent/drafts`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            wordlist: { title: "API 草稿", entries: [{ en: "ruler", zh: "尺子" }] },
          }),
        },
      );
      expect(apiResponse.status).toBe(201);
      const apiResult = serverDraftResponseSchema.parse(await apiResponse.json());
      expect(apiResult.confirmUrl).toBe(`${expectedBase}#draft=${apiResult.draft.id}`);
      expect(store.list(account.id)).toHaveLength(0);
      const unauthorized = await fetch(mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "x", version: "0" },
          },
        }),
      });
      expect(unauthorized.status).toBe(401);
      tokens.revoke(account.id, credentials.info.id);
      await expect(client.callTool({ name: "list_wordlists", arguments: {} })).rejects.toThrow();
    } finally {
      await client.close();
      await new Promise<void>((done) => http.close(() => done()));
      store.close();
    }
  },
  15000,
);
