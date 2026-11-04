import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Auth } from "../apps/server/src/auth";
import { Drafts } from "../apps/server/src/drafts";
import { Store } from "../apps/server/src/store";
import { Tokens } from "../apps/server/src/tokens";
import { serverDraftResponseSchema } from "../packages/contract/src/index";

it("任意独立域名、端口、客户端入口及可信反代域名/前缀均生成完整链接", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-site-url-")));
  try {
    const account = await new Auth(store).register("parent", "synthetic-password");
    if (!account) throw new Error("测试账号失败");
    const { token } = new Tokens(store).create(account.id, {
      name: "链接测试",
      scopes: ["drafts:write"],
    });
    const cases: {
      url: string;
      options?: Parameters<typeof createApp>[1];
      headers?: Record<string, string>;
      expected?: string;
    }[] = [
      {
        url: "https://dictation.example.org/api/agent/drafts",
        expected: "https://dictation.example.org/",
      },
      { url: "http://localhost:8083/api/agent/drafts", expected: "http://localhost:8083/" },
      { url: "http://[::1]:8083/api/agent/drafts", expected: "http://[::1]:8083/" },
      {
        url: "http://custom.test:8083/api/agent/drafts",
        headers: { "X-Dictation-Site-Url": "https://custom.test:8083/school/english" },
        expected: "https://custom.test:8083/school/english/",
      },
      {
        url: "http://internal:8083/api/agent/drafts",
        options: { trustProxy: true },
        headers: {
          "X-Forwarded-Host": "learn.example.org:8443",
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Prefix": "/school/practice/",
        },
        expected: "https://learn.example.org:8443/school/practice/",
      },
      {
        url: "http://internal:8083/api/agent/drafts",
        options: { trustProxy: true },
        headers: { "X-Forwarded-Host": "Learn.Example.Org:443", "X-Forwarded-Proto": "https" },
        expected: "https://learn.example.org/",
      },
      {
        url: "http://custom.test/api/agent/drafts",
        headers: {
          "X-Forwarded-Host": "evil.test",
          "X-Forwarded-Prefix": "/wrong/",
          "X-Forwarded-Proto": "https",
        },
        expected: "http://custom.test/",
      },
      {
        url: "http://custom.test/api/agent/drafts",
        options: { basePath: "/practice", trustProxy: true },
        headers: { "X-Forwarded-Prefix": "/practice/" },
        expected: "http://custom.test/practice/",
      },
      {
        url: "http://custom.test/api/agent/drafts",
        options: { publicUrl: "https://official.example.org/review/" },
        headers: { "X-Dictation-Site-Url": "https://custom.test/other/" },
        expected: "https://official.example.org/review/",
      },
      ...[
        "https://evil.test/",
        "https://user:password@custom.test/",
        "ftp://custom.test/",
        "https://custom.test/?secret=1",
        "https://custom.test/#draft=x",
        "not a URL",
      ].map((site) => ({
        url: "http://custom.test/api/agent/drafts",
        headers: { "X-Dictation-Site-Url": site },
      })),
      {
        url: "http://custom.test/api/agent/drafts",
        options: { trustProxy: true },
        headers: { "X-Forwarded-Host": "evil.test/path" },
      },
      {
        url: "http://custom.test/api/agent/drafts",
        options: { trustProxy: true },
        headers: { "X-Forwarded-Prefix": "//evil.test/" },
      },
    ];
    for (const item of cases) {
      const before = new Drafts(store).list(account.id).length;
      const app = createApp(store, item.options ?? {});
      const response = await app.request(item.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...item.headers,
        },
        body: JSON.stringify({
          wordlist: { title: "入口测试", entries: [{ en: "ruler", zh: "尺子" }] },
        }),
      });
      if (item.expected) {
        expect(response.status).toBe(201);
        const result = serverDraftResponseSchema.parse(await response.json());
        expect(result.confirmUrl).toBe(`${item.expected}#draft=${result.draft.id}`);
      } else {
        expect(response.status).toBe(400);
        expect(new Drafts(store).list(account.id)).toHaveLength(before);
      }
    }
  } finally {
    store.close();
  }
});
