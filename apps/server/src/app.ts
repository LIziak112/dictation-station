import { resolve } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  type Account,
  attemptCompleteSchema,
  audioPreparationSchema,
  correctionSchema,
  credentialsSchema,
  examRequestSchema,
  idSchema,
  manualLearningSchema,
  ocrRequestSchema,
  passwordChangeSchema,
  passwordVerificationSchema,
  pronunciationInputSchema,
  startTaskSchema,
  taskInputSchema,
  ttsRequestSchema,
} from "../../../packages/contract/src/index";
import { projectTask } from "../../../packages/core/src/tasks";
import { Auth } from "./auth";
import { Learning } from "./learning";
import { Pronunciation } from "./pronunciation";
import type { OcrInput, TtsInput } from "./providers";
import { Conflict, type Store } from "./store";
import { Tasks } from "./tasks";

interface Options {
  allowRegistration?: boolean;
  pronunciation?: Pronunciation;
  audioDir?: string;
  ocr?: (image: OcrInput) => Promise<string>;
  tts?: (item: TtsInput) => Promise<string>;
  trustProxy?: boolean;
}
export function createApp(store: Store, options: Options) {
  const app = new Hono<{ Variables: { account: Account } }>();
  const auth = new Auth(store);
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
    if (
      publicPaths.has(c.req.path) ||
      (!c.req.path.startsWith("/api/") && !c.req.path.startsWith("/audio/"))
    )
      return next();
    const account = auth.current(getCookie(c, "dictation_session") ?? "");
    if (!account) return c.json({ error: "请先登录" }, 401);
    c.set("account", account);
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
    return c.json({ ok: true });
  });
  app.post("/api/auth/verify-password", async (c) => {
    const input = passwordVerificationSchema.parse(await c.req.json());
    if (!(await auth.login(c.get("account").username, input.password)))
      return c.json({ error: "账号密码不正确" }, 400);
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
    const input = pronunciationInputSchema.parse(await c.req.json());
    const voice = await pronunciation.prepare(input);
    if (voice.url) store.grantAudio(c.get("account").id, voice.url.slice("audio/".length));
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
      attempt: tasks.correct(c.get("account").id, c.req.param("id"), input.revision, input.wordIds),
    });
  });
  app.get("/api/tasks", (c) =>
    c.json({
      tasks: tasks.list(c.get("account").id).map(({ items, audio: _audio, ...task }) => ({
        ...task,
        count: items.length,
        reviewCount: items.filter((item) => item.source === "review").length,
      })),
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
  app.get("/api/tasks/:id/play", (c) => {
    const task = tasks.require(c.get("account").id, c.req.param("id"));
    const attempts = tasks.listAttempts(c.get("account").id, task.id);
    return c.json({
      task: projectTask(task),
      attempt: attempts.find((attempt) => !attempt.completedAt) ?? attempts.at(-1) ?? null,
    });
  });
  app.post("/api/tasks/:id/start", async (c) => {
    const input = startTaskSchema.parse(await c.req.json());
    return c.json({
      attempt: tasks.start(c.get("account").id, c.req.param("id"), input.onlyHomework),
    });
  });
  app.put("/api/attempts/:id", async (c) =>
    c.json({ attempt: tasks.save(c.get("account").id, c.req.param("id"), await c.req.json()) }),
  );
  app.get("/api/attempts/:id", (c) => {
    const attempt = tasks.attempt(c.get("account").id, c.req.param("id"));
    return c.json({ attempt, task: tasks.require(c.get("account").id, attempt.taskId) });
  });
  app.post("/api/attempts/:id/complete", async (c) => {
    const input = attemptCompleteSchema.parse(await c.req.json());
    return c.json({
      attempt: tasks.complete(
        c.get("account").id,
        c.req.param("id"),
        input.revision,
        input.confirmRemaining,
      ),
    });
  });
  app.notFound((c) => c.json({ error: "入口不存在，请检查地址" }, 404));
  return app;
}
