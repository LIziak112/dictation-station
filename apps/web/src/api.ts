import { z } from "zod";
import {
  type Batch,
  batchListSchema,
  batchResponseSchema,
  type Draft,
  exportSchema,
  healthSchema,
  ttsResponseSchema,
} from "../../../packages/contract/src/index";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}) {
  const write = !!options.method && !["GET", "HEAD"].includes(options.method);
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (write) {
    const token = sessionStorage.getItem("writeToken");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const r = await fetch(path, { ...options, headers });
  const body: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(body);
    if (r.status === 401) sessionStorage.removeItem("writeToken");
    throw new ApiError(parsed.success ? parsed.data.error : "请求失败，请保留草稿后重试", r.status);
  }
  return schema.parse(body);
}
export const api = {
  health: () => request("api/health", healthSchema),
  list: (signal?: AbortSignal) => request("api/batches", batchListSchema, { signal }),
  batch: (id: string, signal?: AbortSignal) =>
    request(`api/batches/${encodeURIComponent(id)}`, batchResponseSchema, { signal }),
  save: (draft: Draft) => {
    const entries = draft.entries;
    const subject = entries.some((e) => e.en)
      ? entries.some((e) => !e.en)
        ? "mixed"
        : "english"
      : "chinese";
    const { title, grade, unit, stage, textbook } = draft;
    const payload = { title, grade, unit, stage, textbook, subject, entries };
    return draft.batchId
      ? request(`api/batches/${draft.batchId}`, batchResponseSchema, {
          method: "PUT",
          body: JSON.stringify({ ...payload, revision: draft.revision }),
        })
      : request("api/batches", batchResponseSchema, {
          method: "POST",
          body: JSON.stringify({ ...payload, sourceText: draft.raw }),
        });
  },
  remove: (batch: Batch) =>
    request(`api/batches/${batch.id}?revision=${batch.revision}`, z.object({ ok: z.boolean() }), {
      method: "DELETE",
    }),
  ocr: (image: { name: string; type: string; data: string }, signal: AbortSignal) =>
    request("api/ocr", z.object({ text: z.string() }), {
      method: "POST",
      body: JSON.stringify({ image }),
      signal,
    }),
  tts: (items: { text: string; lang: "en" | "zh" }[], signal: AbortSignal) =>
    request("api/tts", ttsResponseSchema, {
      method: "POST",
      body: JSON.stringify({ items }),
      signal,
    }),
};
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([typeof value === "string" ? value : JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportBatch(batch: Batch) {
  const {
    id: _id,
    revision: _revision,
    createdAt: _created,
    updatedAt: _updated,
    ...content
  } = batch;
  download(`${batch.title}.json`, exportSchema.parse(content));
}
