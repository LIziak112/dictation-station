import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app";
import { Pronunciation } from "./pronunciation";
import { createTts, paddleOcr } from "./providers";
import { Store } from "./store";

if (existsSync(resolve(".env"))) process.loadEnvFile(resolve(".env"));
const data = resolve(process.env.DATA_DIR ?? "data");
const store = new Store(data);
const rawBase = process.env.BASE_PATH ?? "/";
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(rawBase))
  throw new Error("BASE_PATH 必须为 / 或 /tingxie/ 形式");
const base = rawBase === "/" ? "" : rawBase.slice(0, -1);
const tts =
  process.env.ENABLE_SERVER_TTS === "true" ? createTts(resolve(data, "audio")) : undefined;
const pronunciation = new Pronunciation({
  dir: resolve(data, "audio"),
  publicDictionary: process.env.PUBLIC_DICTIONARY !== "false",
  localDirectory: process.env.WORD_AUDIO_DIR,
  tts,
});
const api = createApp(store, {
  pronunciation,
  allowRegistration: process.env.ALLOW_REGISTRATION !== "false",
  trustProxy: process.env.TRUST_PROXY === "true",
  ocr: process.env.PADDLEOCR_TOKEN ? paddleOcr : undefined,
  tts,
  basePath: base,
  publicUrl: process.env.PUBLIC_URL,
});
const app = new Hono();
api.get("*", serveStatic({ root: "dist/web" }));
if (base) {
  app.get(base, (c) => c.redirect(`${base}/`));
  app.all(`${base}/*`, (c) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice(base.length) || "/";
    return api.fetch(new Request(url, c.req.raw));
  });
} else app.route("/", api);
// 旧 nginx 可能已剥离 /tingxie 前缀；BASE_PATH=/ 时保持原部署行为。
const server = serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 8083),
    hostname: process.env.HOST ?? "127.0.0.1",
  },
  (info) => console.log(`[dictation] listening on 127.0.0.1:${info.port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
