import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ocrRequestSchema, ttsItemSchema } from "../../../packages/contract/src/index";

export type OcrInput = z.infer<typeof ocrRequestSchema>["image"];
export type TtsInput = z.infer<typeof ttsItemSchema>;
const jobSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z
    .object({
      jobId: z.string().optional(),
      state: z.string().optional(),
      resultUrl: z.object({ jsonUrl: z.url().optional() }).optional(),
    })
    .optional(),
});
const resultSchema = z.object({
  result: z.object({
    layoutParsingResults: z.array(
      z.object({ markdown: z.object({ text: z.string().optional() }).optional() }),
    ),
  }),
});
export async function paddleOcr(image: OcrInput) {
  const token = process.env.PADDLEOCR_TOKEN;
  if (!token) throw new Error("尚未配置图片识别，请直接粘贴文字");
  const endpoint =
    process.env.PADDLEOCR_URL ?? "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
  const bytes = Buffer.from(image.data, "base64");
  if (bytes.length > 20 * 1024 * 1024) throw new Error("图片超过 20MB，请压缩后重试");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: image.type }), image.name);
  form.append("model", process.env.PADDLEOCR_MODEL ?? "PaddleOCR-VL-1.6");
  const headers = { Authorization: `Bearer ${token}` };
  async function job(url: string, init?: RequestInit) {
    const r = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error("图片识别服务暂不可用，请稍后重试");
    const j = jobSchema.parse(await r.json());
    if (j.code !== 0) throw new Error("图片识别失败，请重试或粘贴文字");
    return j.data;
  }
  const submitted = await job(endpoint, { method: "POST", body: form });
  if (!submitted?.jobId) throw new Error("识别服务未返回任务编号");
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const data = await job(`${endpoint}/${encodeURIComponent(submitted.jobId)}`);
    if (data?.state === "done") {
      const url = data.resultUrl?.jsonUrl;
      if (!url || new URL(url).protocol !== "https:") throw new Error("识别结果地址无效");
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error("识别结果读取失败，请重试");
      const result = resultSchema.parse(await r.json());
      return result.result.layoutParsingResults.map((x) => x.markdown?.text ?? "").join("\n\n");
    }
    if (data?.state === "failed" || data?.state === "error")
      throw new Error("图片识别失败，请重拍或粘贴文字");
  }
  throw new Error("图片识别超时，请重试或粘贴文字");
}

export function createTts(dir: string) {
  mkdirSync(dir, { recursive: true });
  const pending = new Map<string, Promise<string>>();
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function tts(item: TtsInput): Promise<string> {
    if (process.env.ENABLE_SERVER_TTS !== "true")
      throw new Error("服务器语音未启用，请使用设备朗读");
    const voice =
      item.lang === "en"
        ? (process.env.VOICE_EN ?? "en-US-AriaNeural")
        : (process.env.VOICE_ZH ?? "zh-CN-XiaoxiaoNeural");
    // 保留旧缓存键，已有音频可以继续使用。
    const key = createHash("sha1").update(`${voice}|${item.rate}|${item.text}`).digest("hex");
    const file = join(dir, `${key}.mp3`);
    if (existsSync(file) && statSync(file).size > 0) return `audio/${key}.mp3`;
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= 100) throw new Error("语音准备队列已满，请稍后重试");
    const promise = (async () => {
      if (running >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
      else running++;
      const temp = join(dir, `${key}.${randomBytes(4).toString("hex")}.tmp.mp3`);
      try {
        await new Promise<void>((resolve, reject) => {
          const env = { ...process.env };
          if (process.env.EDGE_TTS_PYTHONPATH) env.PYTHONPATH = process.env.EDGE_TTS_PYTHONPATH;
          const py =
            "import asyncio,sys,edge_tts\nasyncio.run(edge_tts.Communicate(sys.argv[1],sys.argv[2],rate=sys.argv[3]).save(sys.argv[4]))";
          const child = spawn(
            process.env.EDGE_TTS_PYTHON ?? "python3",
            ["-c", py, item.text, voice, item.rate, temp],
            { env, windowsHide: true, stdio: "ignore" },
          );
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error("语音准备超时，请重试"));
          }, 45000);
          child.on("error", () => {
            clearTimeout(timer);
            reject(new Error("语音服务未就绪，请检查 Python 与 edge-tts"));
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0 && existsSync(temp) && statSync(temp).size > 0) resolve();
            else reject(new Error("语音准备失败，请重试或使用设备朗读"));
          });
        });
        renameSync(temp, file);
        return `audio/${key}.mp3`;
      } finally {
        rmSync(temp, { force: true });
        const next = waiting.shift();
        if (next) next();
        else running--;
      }
    })();
    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  };
}
