import { timingSafeEqual } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  batchInputSchema,
  idSchema,
  ocrRequestSchema,
  ttsRequestSchema,
  updateSchema,
} from "../../../packages/contract/src/index";
import type { OcrInput, TtsInput } from "./providers";
import { Conflict, type Store } from "./store";

interface Options {
  writeToken: string;
  ocr?: (image: OcrInput) => Promise<string>;
  tts?: (item: TtsInput) => Promise<string>;
  trustProxy?: boolean;
}
export function createApp(store: Store, options: Options) {
  const app = new Hono();
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
      if (options.writeToken) {
        const supplied = Buffer.from(c.req.header("Authorization") ?? "");
        const expected = Buffer.from(`Bearer ${options.writeToken}`);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
          return c.json({ error: "请输入正确的管理口令" }, 401);
      }
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
    if (error instanceof Conflict) return c.json({ error: error.message }, 409);
    console.error("[dictation]", error instanceof Error ? error.message : "未知错误");
    return c.json({ error: "服务暂时不可用，请保留草稿后重试" }, 500);
  });
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      ocr: !!options.ocr,
      tts: !!options.tts,
      writeProtected: !!options.writeToken,
    }),
  );
  app.get("/api/batches", (c) =>
    c.json({
      batches: store.list().map(({ entries, ...batch }) => ({ ...batch, count: entries.length })),
    }),
  );
  app.post("/api/batches", async (c) =>
    c.json({ batch: store.create(batchInputSchema.parse(await c.req.json())) }, 201),
  );
  app.get("/api/batches/:id", (c) => {
    const b = store.get(idSchema.parse(c.req.param("id")));
    return b ? c.json({ batch: b }) : c.json({ error: "词表不存在，请检查分享链接" }, 404);
  });
  app.put("/api/batches/:id", async (c) => {
    const b = store.update(
      idSchema.parse(c.req.param("id")),
      updateSchema.parse(await c.req.json()),
    );
    return b ? c.json({ batch: b }) : c.json({ error: "词表不存在，草稿仍在本机" }, 404);
  });
  app.delete("/api/batches/:id", (c) => {
    const revision = z.coerce.number().int().positive().parse(c.req.query("revision"));
    return store.delete(idSchema.parse(c.req.param("id")), revision)
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
        result.push({ text: item.text, lang: item.lang, url: await tts(item) });
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
  app.notFound((c) => c.json({ error: "入口不存在，请检查地址" }, 404));
  return app;
}
