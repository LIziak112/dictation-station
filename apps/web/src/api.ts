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

const CHILD_TOKEN_KEY = "ownclass:dictation:child-token";
const DEVICE_ID_KEY = "ownclass:dictation:device-id";

export function captureChildTokenFromUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(location.search);
  const ct = params.get("ct");
  if (ct) {
    try {
      localStorage.setItem(CHILD_TOKEN_KEY, ct);
    } catch {
      /* 忽略无痕存储异常 */
    }
    params.delete("ct");
    const nextSearch = params.toString();
    history.replaceState(
      null,
      "",
      `${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash}`,
    );
  }
}

export function getStoredChildToken() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(CHILD_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function getDeviceId() {
  if (typeof window === "undefined") return "server";
  try {
    let id = sessionStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `dev_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
      sessionStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "browser";
  }
}

export function childHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const isChild = new URLSearchParams(location.search).get("child") === "1";
  if (!isChild) return {};
  const ct = getStoredChildToken();
  return ct ? { "X-Child-Token": ct, "X-Child-Mode": "1" } : { "X-Child-Mode": "1" };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  for (const [k, v] of Object.entries(childHeaders())) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const r = await fetch(path, { ...options, headers });
  const body: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(body);
    if (r.status === 401 && !path.startsWith("api/auth/"))
      window.dispatchEvent(new Event("dictation:session-expired"));
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
    if (draft.sourceDraftId)
      return request(`api/drafts/${draft.sourceDraftId}/publish`, batchResponseSchema, {
        method: "POST",
        body: JSON.stringify(payload),
      });
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
