import { resolve } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  type Account,
  agentValidationInputSchema,
  attemptCompleteSchema,
  attemptReturnSchema,
  audioPreparationSchema,
  correctionSchema,
  credentialsSchema,
  entrySchema,
  examRequestSchema,
  exportSchema,
  idSchema,
  manualLearningSchema,
  ocrRequestSchema,
  passwordChangeSchema,
  passwordVerificationSchema,
  pronunciationInputSchema,
  startTaskSchema,
  taskInputSchema,
  taskWithdrawSchema,
  ttsRequestSchema,
} from "../../../packages/contract/src/index";
import { validateEntries } from "../../../packages/core/src/import";
import { projectTask } from "../../../packages/core/src/tasks";
import { createMcpServer } from "../../../packages/mcp/src/server";
import { Auth } from "./auth";
import { Drafts } from "./drafts";
import { Learning } from "./learning";
import { Pronunciation } from "./pronunciation";
import type { OcrInput, TtsInput } from "./providers";
import { words } from "./schema";
import { Conflict, type Store } from "./store";
import { Tasks } from "./tasks";
import { Tokens } from "./tokens";

interface Options {
  allowRegistration?: boolean;
  pronunciation?: Pronunciation;
  audioDir?: string;
  ocr?: (image: OcrInput) => Promise<string>;
  tts?: (item: TtsInput) => Promise<string>;
  trustProxy?: boolean;
  basePath?: string;
}

function isChildRouteAllowed(method: string, path: string) {
  if (
    method === "GET" &&
    (path === "/api/auth/me" || path === "/api/child/overview" || path === "/api/tasks")
  )
    return true;
  if (method === "GET" && /^\/api\/child\/batches\/[^/]+\/listen$/.test(path)) return true;
  if (method === "GET" && /^\/api\/tasks\/[^/]+\/play$/.test(path)) return true;
  if (method === "POST" && /^\/api\/tasks\/[^/]+\/audio$/.test(path)) return true;
  if (method === "POST" && /^\/api\/tasks\/[^/]+\/start$/.test(path)) return true;
  if (method === "PUT" && /^\/api\/attempts\/[^/]+$/.test(path)) return true;
  if (method === "GET" && /^\/api\/attempts\/[^/]+$/.test(path)) return true;
  if (method === "POST" && /^\/api\/attempts\/[^/]+\/complete$/.test(path)) return true;
  if (method === "POST" && /^\/api\/attempts\/[^/]+\/corrections$/.test(path)) return true;
  if (method === "POST" && path === "/api/pronunciation/preview") return true;
  if (method === "POST" && path === "/api/auth/verify-password") return true;
  if (method === "POST" && path === "/api/auth/unlock-pin") return true;
  if (method === "GET" && /^\/audio\/[^/]+$/.test(path)) return true;
  return false;
}

export function createApp(store: Store, options: Options) {
  const app = new Hono<{ Variables: { account: Account; childMode: boolean } }>();
  const auth = new Auth(store);
  const tokens = new Tokens(store);
  const drafts = new Drafts(store);
  const tasks = new Tasks(store);
  const learning = new Learning(store);
  const pronunciation =
    options.pronunciation ??
    new Pronunciation({
      dir: options.audioDir ?? resolve(store.dir, "audio"),
      publicDictionary: false,
      tts: options.tts,
    });
  const buckets = new Map<string, { count: number; expires: number }>();
  function limited(key: string, limit: number, ms: number) {
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.expires <= now) {
      entry = { count: 0, expires: now + ms };
      buckets.set(key, entry);
    }
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.expires <= now) buckets.delete(k);
    return ++entry.count > limit;
  }
  app.use("*", async (c, next) => {
    try {
      decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.json({ error: "URL 编码无效，请检查链接" }, 400);
    }
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("Origin");
      if (origin) {
        let valid = false;
        try {
          const parsed = new URL(origin);
          valid =
            ["https:", "http:"].includes(parsed.protocol) &&
            parsed.host === new URL(c.req.url).host &&
            parsed.origin === origin;
        } catch {
          /* 无效来源按拒绝处理。 */
        }
        // TLS 可在反代终止，同源按主机端口核对，不依赖不可信的转发协议头。
        if (!valid) return c.json({ error: "请求来源无效，请从本站打开后重试" }, 403);
      }
      let remote = "local";
      try {
        remote = getConnInfo(c).remote.address ?? remote;
      } catch {
        /* 合成接口测试没有网络连接。 */
      }
      const ip = options.trustProxy ? (c.req.header("x-real-ip") ?? remote) : remote;
      if (c.req.path === "/api/auth/unlock-pin" && limited(`pin:${ip}`, 10, 60000))
        return c.json({ error: "尝试次数过多，请稍后重试" }, 429);
      if (limited(`write:${ip}`, 120, 60000))
        return c.json({ error: "操作太频繁，请稍后重试" }, 429);
      if (c.req.path.includes("/ocr") && limited(`ocr:${ip}`, 40, 3600000))
        return c.json({ error: "图片识别次数过多，请稍后重试" }, 429);
      if (c.req.path.includes("/tts") && limited(`tts:${ip}`, 120, 3600000))
        return c.json({ error: "语音准备次数过多，请稍后重试" }, 429);
    }
    await next();
  });
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 29_000_000,
      onError: (c) => c.json({ error: "内容过大，请缩小图片或分批导入" }, 413),
    }),
  );
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: "内容校验失败，请检查词条、模式和字段长度",
          issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        400,
      );
    if (error instanceof SyntaxError) return c.json({ error: "JSON 格式无效，请检查后重试" }, 400);
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    if (error instanceof Conflict) return c.json({ error: error.message }, 409);
    console.error("[dictation]", error instanceof Error ? error.message : "未知错误");
    return c.json({ error: "服务暂时不可用，请保留草稿后重试" }, 500);
  });
  const publicPaths = new Set(["/api/health", "/api/auth/register", "/api/auth/login"]);
  app.use("*", async (c, next) => {
    c.set("childMode", false);
    if (
      publicPaths.has(c.req.path) ||
      (!c.req.path.startsWith("/api/") && !c.req.path.startsWith("/audio/"))
    )
      return next();
    if (c.req.path.startsWith("/api/agent/")) {
      const actor = tokens.authenticate(
        (c.req.header("Authorization") ?? "").replace(/^Bearer /, ""),
      );
      if (!actor) return c.json({ error: "AI 令牌无效或已过期" }, 401);
      const path = c.req.path,
        method = c.req.method;
      const read = method === "GET" && /^\/api\/agent\/wordlists(?:\/[^/]+)?$/.test(path);
      const readHistory = method === "GET" && /^\/api\/agent\/history(?:\/[^/]+)?$/.test(path);
      const writeDraft =
        method === "POST" && ["/api/agent/validate", "/api/agent/drafts"].includes(path);
      const schema = method === "GET" && path === "/api/agent/schema";
      if (
        !(
          schema ||
          (read && actor.scopes.includes("wordlists:read")) ||
          (readHistory && actor.scopes.includes("history:read")) ||
          (writeDraft && actor.scopes.includes("drafts:write"))
        )
      )
        return c.json({ error: "这个 AI 令牌没有此项权限" }, 403);
      c.set("account", actor.account);
      return next();
    }
    const bearer = (c.req.header("Authorization") ?? "").replace(/^Bearer /, "");
    const headerChildToken =
      c.req.header("X-Child-Token") ?? (bearer.startsWith("ct_") ? bearer : "");
    const sessionAccount = auth.current(getCookie(c, "dictation_session") ?? "");
    const cookieChildToken =
      !sessionAccount && c.req.header("X-Parent-Mode") !== "1"
        ? (getCookie(c, "dictation_child") ?? "")
        : "";
    const activeChildToken = headerChildToken || cookieChildToken;
    if (activeChildToken) {
      const childActor = tokens.authenticateChild(
        activeChildToken,
        c.req.header("User-Agent") ?? "",
      );
      if (!childActor) {
        if (sessionAccount && !headerChildToken) {
          c.set("account", sessionAccount);
          return next();
        }
        return c.json({ error: "孩子区链接已失效或已重置，请找家长重新扫码" }, 401);
      }
      if (!isChildRouteAllowed(c.req.method, c.req.path)) {
        return c.json({ error: "孩子区无权执行此家长管理操作" }, 403);
      }
      if (headerChildToken && !cookieChildToken) {
        setCookie(c, "dictation_child", headerChildToken, {
          httpOnly: true,
          sameSite: "Lax",
          path: "/",
          maxAge: 30 * 86400,
          secure:
            c.req.url.startsWith("https:") || (c.req.header("Origin") ?? "").startsWith("https:"),
        });
      }
      c.set("account", childActor.account);
      c.set("childMode", true);
      return next();
    }
    if (!sessionAccount) return c.json({ error: "请先登录" }, 401);
    if (c.req.header("X-Child-Mode") === "1" && !isChildRouteAllowed(c.req.method, c.req.path)) {
      return c.json({ error: "孩子区无权执行此家长管理操作" }, 403);
    }
    if (c.req.header("X-Child-Mode") === "1") c.set("childMode", true);
    c.set("account", sessionAccount);
    await next();
  });
  app.post("/api/auth/register", async (c) => {
    if (options.allowRegistration === false)
      return c.json({ error: "本站已关闭注册，请联系部署者" }, 403);
    const input = credentialsSchema.parse(await c.req.json());
    const account = await auth.register(input.username, input.password);
    if (!account) return c.json({ error: "用户名已存在" }, 409);
    setCookie(c, "dictation_session", auth.createSession(account.id), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 86400,
      secure: c.req.url.startsWith("https:") || (c.req.header("Origin") ?? "").startsWith("https:"),
    });
    return c.json({ account }, 201);
  });
  app.post("/api/auth/login", async (c) => {
    const input = credentialsSchema.parse(await c.req.json());
    const account = await auth.login(input.username, input.password);
    if (!account) return c.json({ error: "用户名或密码不正确" }, 401);
    setCookie(c, "dictation_session", auth.createSession(account.id), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 86400,
      secure: c.req.url.startsWith("https:") || (c.req.header("Origin") ?? "").startsWith("https:"),
    });
    return c.json({ account });
  });
  app.get("/api/auth/me", (c) => c.json({ account: c.get("account") }));
  app.post("/api/auth/logout", (c) => {
    auth.logout(getCookie(c, "dictation_session") ?? "");
    deleteCookie(c, "dictation_session", { path: "/" });
    deleteCookie(c, "dictation_child", { path: "/" });
    return c.json({ ok: true });
  });
  app.post("/api/auth/verify-password", async (c) => {
    const input = passwordVerificationSchema.parse(await c.req.json());
    if (!(await auth.login(c.get("account").username, input.password)))
      return c.json({ error: "账号密码不正确" }, 400);
    if (c.get("childMode"))
      setCookie(c, "dictation_session", auth.createSession(c.get("account").id), {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 30 * 86400,
        secure:
          c.req.url.startsWith("https:") || (c.req.header("Origin") ?? "").startsWith("https:"),
      });
    return c.json({ ok: true });
  });
  const devicePinSchema = z.strictObject({
    deviceId: z.string().regex(/^[a-f0-9]{32}$/),
    pin: z.string().regex(/^[0-9]{4}$/),
  });
  app.post("/api/auth/device-pin", async (c) => {
    const { deviceId, pin } = devicePinSchema.parse(await c.req.json());
    await auth.setDevicePin(c.get("account").id, deviceId, pin);
    return c.json({ ok: true });
  });
  app.post("/api/auth/unlock-pin", async (c) => {
    const { deviceId, pin } = devicePinSchema.parse(await c.req.json());
    const valid = await auth.verifyDevicePin(c.get("account").id, deviceId, pin);
    if (valid === null) return c.json({ error: "请使用账号密码验证并重新设置本机口令" }, 409);
    if (!valid) return c.json({ error: "口令不正确，请重试" }, 400);
    setCookie(c, "dictation_session", auth.createSession(c.get("account").id), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 86400,
      secure: c.req.url.startsWith("https:") || (c.req.header("Origin") ?? "").startsWith("https:"),
    });
    return c.json({ ok: true });
  });
  app.post("/api/auth/password", async (c) => {
    const input = passwordChangeSchema.parse(await c.req.json());
    if (!(await auth.changePassword(c.get("account").id, input.currentPassword, input.newPassword)))
      return c.json({ error: "当前密码不正确" }, 400);
    deleteCookie(c, "dictation_session", { path: "/" });
    return c.json({ ok: true });
  });
  app.use("/audio/:file", async (c, next) => {
    const file = c.req.param("file");
    if (!/^[a-f0-9]{40}\.(?:mp3|ogg|wav)$/.test(file) || !store.hasAudio(c.get("account").id, file))
      return c.notFound();
    return serveStatic({
      root: options.audioDir ?? resolve(store.dir, "audio"),
      rewriteRequestPath: () => file,
    })(c, next);
  });
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      ocr: !!options.ocr,
      tts: !!options.tts,
      allowRegistration: options.allowRegistration !== false,
    }),
  );
  app.get("/api/child-token", (c) =>
    c.json({ active: tokens.listChildTokens(c.get("account").id) }),
  );
  app.post("/api/child-token", (c) => c.json(tokens.createChildToken(c.get("account").id), 201));
  app.post("/api/child-token/rotate", (c) => c.json(tokens.rotateChildToken(c.get("account").id)));
  app.get("/api/child/overview", (c) => c.json(tasks.childOverview(c.get("account").id)));
  app.get("/api/child/batches/:id/listen", (c) =>
    c.json(tasks.childListenBatch(c.get("account").id, idSchema.parse(c.req.param("id")))),
  );
  app.get("/api/audit-logs", (c) => c.json({ logs: store.listAudit(c.get("account").id) }));
  app.get("/api/batches", (c) =>
    c.json({
      batches: store
        .list(c.get("account").id)
        .map(({ entries, ...batch }) => ({ ...batch, count: entries.length })),
    }),
  );
  app.post("/api/batches", async (c) =>
    c.json({ batch: store.create(c.get("account").id, await c.req.json()) }, 201),
  );
  app.get("/api/batches/:id", (c) => {
    const b = store.get(c.get("account").id, idSchema.parse(c.req.param("id")));
    return b ? c.json({ batch: b }) : c.json({ error: "词表不存在，请检查本账号链接" }, 404);
  });
  app.put("/api/batches/:id", async (c) => {
    const b = store.update(
      c.get("account").id,
      idSchema.parse(c.req.param("id")),
      await c.req.json(),
    );
    return b ? c.json({ batch: b }) : c.json({ error: "词表不存在，草稿仍在本机" }, 404);
  });
  app.delete("/api/batches/:id", (c) => {
    const revision = z.coerce.number().int().positive().parse(c.req.query("revision"));
    return store.delete(c.get("account").id, idSchema.parse(c.req.param("id")), revision)
      ? c.json({ ok: true })
      : c.json({ error: "词表不存在" }, 404);
  });
  app.post("/api/ocr", async (c) => {
    const body = ocrRequestSchema.parse(await c.req.json());
    if (!options.ocr) return c.json({ error: "尚未启用图片识别，请粘贴文字" }, 503);
    try {
      return c.json({ text: await options.ocr(body.image) });
    } catch {
      return c.json({ error: "图片识别失败，请重试或直接粘贴文字" }, 502);
    }
  });
  app.post("/api/tts", async (c) => {
    const { items } = ttsRequestSchema.parse(await c.req.json());
    if (!options.tts) return c.json({ error: "服务器语音未启用，请使用设备朗读" }, 503);
    const tts = options.tts;
    const result = [];
    for (const item of items) {
      try {
        const url = await tts(item);
        store.grantAudio(c.get("account").id, url.slice("audio/".length));
        result.push({ text: item.text, lang: item.lang, url });
      } catch {
        result.push({
          text: item.text,
          lang: item.lang,
          url: null,
          error: "语音准备失败，请重试或使用设备朗读",
        });
      }
    }
    return c.json({ items: result });
  });
  app.post("/api/pronunciation/options", async (c) => {
    const input = pronunciationInputSchema.parse(await c.req.json());
    try {
      return c.json({ voices: await pronunciation.voices(input) });
    } catch {
      return c.json({ error: "词典暂不可用，请稍后重试" }, 502);
    }
  });
  app.post("/api/pronunciation/preview", async (c) => {
    const accountId = c.get("account").id;
    const input = pronunciationInputSchema.parse(await c.req.json());
    let resolvedInput = input;
    let maskOutput = false;
    if (input.wordId) {
      const row = store.db
        .select()
        .from(words)
        .where(and(eq(words.id, input.wordId), eq(words.accountId, accountId)))
        .get();
      if (row) {
        const realEntry = entrySchema.parse(JSON.parse(row.payload));
        const realText = realEntry[input.lang];
        if (realText) {
          resolvedInput = {
            ...input,
            text: realText,
            reading: realEntry.readings[input.lang] || realEntry.reading || input.reading,
            pinyin: input.lang === "zh" ? realEntry.pinyin : input.pinyin,
          };
        }
        if (c.get("childMode") && tasks.lockedWordIds(accountId).has(input.wordId)) {
          maskOutput = true;
        }
      }
    }
    const voice = await pronunciation.prepare(resolvedInput, resolvedInput.synthetic);
    if (voice.url) store.grantAudio(accountId, voice.url.slice("audio/".length));
    if (maskOutput) {
      return c.json({
        voice: {
          ...voice,
          title: "待考词盲听",
          reading: "",
        },
      });
    }
    return c.json({ voice });
  });
  app.post("/api/tasks/:id/audio", async (c) => {
    const input = audioPreparationSchema.parse(await c.req.json());
    const audio = await tasks.prepareAudio(
      c.get("account").id,
      c.req.param("id"),
      pronunciation,
      input.fallbackIds,
    );
    return c.json({ audio });
  });
  app.get("/api/tokens", (c) => c.json({ tokens: tokens.list(c.get("account").id) }));
  app.post("/api/tokens", async (c) =>
    c.json(tokens.create(c.get("account").id, await c.req.json()), 201),
  );
  app.delete("/api/tokens/:id", (c) => {
    tokens.revoke(c.get("account").id, c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/api/drafts", (c) => c.json({ drafts: drafts.list(c.get("account").id) }));
  app.get("/api/drafts/:id", (c) =>
    c.json({ draft: drafts.get(c.get("account").id, c.req.param("id")) }),
  );
  app.delete("/api/drafts/:id", (c) => {
    drafts.remove(c.get("account").id, c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/drafts/:id/publish", async (c) =>
    c.json(
      { batch: drafts.publish(c.get("account").id, c.req.param("id"), await c.req.json()) },
      201,
    ),
  );
  app.get("/api/agent/schema", (c) => c.json(z.toJSONSchema(exportSchema, { io: "input" })));
  app.post("/api/agent/validate", async (c) => {
    const input = agentValidationInputSchema.parse(await c.req.json());
    const result = exportSchema.safeParse(input.wordlist);
    return c.json(
      result.success
        ? {
            valid: true,
            issues: validateEntries(result.data.entries).map((issue) => ({
              level: issue.level,
              path: issue.id,
              message: issue.message,
            })),
          }
        : {
            valid: false,
            issues: result.error.issues.map((issue) => ({
              level: "error",
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
    );
  });
  app.get("/api/agent/wordlists", (c) =>
    c.json({
      batches: store
        .list(c.get("account").id)
        .map(({ entries, ...batch }) => ({ ...batch, count: entries.length })),
    }),
  );
  app.get("/api/agent/wordlists/:id", (c) => {
    const batch = store.get(c.get("account").id, c.req.param("id"));
    return batch ? c.json({ batch }) : c.json({ error: "词表不存在" }, 404);
  });
  app.get("/api/agent/history", (c) => c.json({ items: learning.history(c.get("account").id) }));
  app.get("/api/agent/history/:id", (c) => {
    const accountId = c.get("account").id;
    const item = learning
      .history(accountId)
      .find(({ attempt }) => attempt.id === c.req.param("id"));
    return item
      ? c.json({ attempt: item.attempt, task: tasks.require(accountId, item.attempt.taskId) })
      : c.json({ error: "听写记录不存在" }, 404);
  });
  app.post("/api/agent/drafts", async (c) =>
    c.json({ draft: drafts.create(c.get("account").id, await c.req.json()) }, 201),
  );
  app.all("/mcp", async (c) => {
    const token = (c.req.header("Authorization") ?? "").replace(/^Bearer /, "");
    if (!tokens.authenticate(token)) return c.json({ error: "AI 令牌无效或已过期" }, 401);
    const requestUrl = new URL(c.req.url);
    const origin =
      c.req.header("Origin") ??
      `${c.req.header("x-forwarded-proto") ?? requestUrl.protocol.slice(0, -1)}://${requestUrl.host}`;
    const linkBase = `${origin}${options.basePath ?? ""}/`;
    const server = createMcpServer(async (path, body) => {
      const headers = new Headers({ Authorization: `Bearer ${token}` });
      if (body !== undefined) headers.set("Content-Type", "application/json");
      const response = await app.fetch(
        new Request(new URL(`/api/agent/${path}`, "http://internal"), {
          method: body === undefined ? "GET" : "POST",
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      const result: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(result);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: failure.success ? failure.data.error : `请求失败（${response.status}）`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }, linkBase);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  app.get("/api/preferences", (c) =>
    c.json({ preferences: learning.preferences(c.get("account").id) }),
  );
  app.put("/api/preferences", async (c) =>
    c.json({ preferences: learning.setPreferences(c.get("account").id, await c.req.json()) }),
  );
  app.get("/api/learning", (c) => c.json({ items: learning.list(c.get("account").id) }));
  app.put("/api/learning/:wordId", async (c) => {
    const input = manualLearningSchema.parse(await c.req.json());
    return c.json({
      state: learning.manual(c.get("account").id, c.req.param("wordId"), input.mode, input.status),
    });
  });
  app.get("/api/history", (c) => c.json({ items: learning.history(c.get("account").id) }));
  app.get("/api/weekly", (c) => c.json(learning.weekly(c.get("account").id)));
  app.post("/api/learning/exam", async (c) => {
    const input = examRequestSchema.parse(await c.req.json());
    return c.json({ items: learning.exam(c.get("account").id, input.from, input.to, input.mode) });
  });
  app.post("/api/tasks/preview", async (c) =>
    c.json({ task: tasks.preview(c.get("account").id, await c.req.json()) }),
  );
  app.post("/api/attempts/:id/corrections", async (c) => {
    const input = correctionSchema.parse(await c.req.json());
    return c.json({
      attempt: tasks.correct(
        c.get("account").id,
        c.req.param("id"),
        input.revision,
        input.wordIds,
        c.get("childMode"),
      ),
    });
  });
  app.get("/api/tasks", (c) =>
    c.json({
      tasks: tasks.summarize(c.get("account").id),
    }),
  );
  app.post("/api/tasks", async (c) =>
    c.json({ task: tasks.create(c.get("account").id, await c.req.json()) }, 201),
  );
  app.get("/api/tasks/:id", (c) =>
    c.json({ task: tasks.require(c.get("account").id, c.req.param("id")) }),
  );
  app.put("/api/tasks/:id", async (c) => {
    const { revision, ...input } = taskInputSchema
      .extend({ revision: z.number().int().positive() })
      .parse(await c.req.json());
    return c.json({ task: tasks.update(c.get("account").id, c.req.param("id"), revision, input) });
  });
  app.post("/api/tasks/:id/withdraw", async (c) => {
    const input = taskWithdrawSchema.parse(await c.req.json().catch(() => ({})));
    return c.json({
      task: tasks.withdraw(c.get("account").id, c.req.param("id"), input.revision),
    });
  });
  app.post("/api/tasks/:id/reschedule", (c) =>
    c.json({
      task: tasks.reschedule(c.get("account").id, c.req.param("id")),
    }),
  );
  app.get("/api/tasks/:id/play", (c) => {
    const task = tasks.require(c.get("account").id, c.req.param("id"));
    const attempts = tasks.listAttempts(c.get("account").id, task.id);
    return c.json({
      task: projectTask(task),
      attempt:
        attempts.find((attempt) => !attempt.completedAt && !attempt.interruptedAt) ??
        attempts.filter((attempt) => attempt.completedAt).at(-1) ??
        attempts.at(-1) ??
        null,
    });
  });
  app.post("/api/tasks/:id/start", async (c) => {
    const input = startTaskSchema.parse(await c.req.json());
    return c.json({
      attempt: tasks.start(
        c.get("account").id,
        c.req.param("id"),
        input.onlyHomework,
        input.deviceId,
        input.forceTakeover,
        c.get("childMode"),
      ),
    });
  });
  app.put("/api/attempts/:id", async (c) =>
    c.json({
      attempt: tasks.save(
        c.get("account").id,
        c.req.param("id"),
        await c.req.json(),
        c.get("childMode"),
      ),
    }),
  );
  app.post("/api/attempts/:id/return", async (c) => {
    const input = attemptReturnSchema.parse(await c.req.json());
    return c.json({
      attempt: tasks.returnForRedo(
        c.get("account").id,
        c.req.param("id"),
        input.revision,
        input.resetIndex,
      ),
    });
  });
  app.post("/api/attempts/:id/redispatch", (c) =>
    c.json(
      {
        task: tasks.redispatchWrong(c.get("account").id, c.req.param("id")),
      },
      201,
    ),
  );
  app.get("/api/attempts/:id", (c) => {
    const accountId = c.get("account").id;
    const attempt = tasks.attempt(accountId, c.req.param("id"));
    const task = tasks.require(accountId, attempt.taskId);
    if (
      c.get("childMode") &&
      !attempt.completedAt &&
      !(task.allowSelfReview && attempt.phase === "review")
    ) {
      return c.json({ error: "请等待家长批改完成后再查看答案详情" }, 403);
    }
    return c.json({ attempt, task });
  });
  app.post("/api/attempts/:id/complete", async (c) => {
    const input = attemptCompleteSchema.parse(await c.req.json());
    return c.json({
      attempt: tasks.complete(
        c.get("account").id,
        c.req.param("id"),
        input.revision,
        input.confirmRemaining,
        c.get("childMode"),
      ),
    });
  });
  app.notFound((c) => c.json({ error: "入口不存在，请检查地址" }, 404));
  return app;
}
