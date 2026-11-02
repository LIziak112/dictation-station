import { useEffect, useState } from "react";
import type { z } from "zod";

// 不覆盖读取失败或未来版本的本机稿；只有显式清理后才允许重新写入。
export function readLocal<T>(
  key: string,
  schema: z.ZodType<T>,
): { value: T | null; error: string; raw: string | null } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
    if (raw === null) return { value: null, error: "", raw: null };
    const result = schema.safeParse(JSON.parse(raw));
    if (!result.success)
      return {
        value: null,
        error: "本机记录格式无法读取，已保留原数据。请先导出备份，再显式清理。",
        raw,
      };
    return { value: result.data, error: "", raw };
  } catch {
    return {
      value: null,
      error:
        raw === null
          ? "本机记录读取失败。请检查浏览器存储权限，原数据不会被覆盖。"
          : "本机记录格式无法读取，已保留原数据。请先导出备份，再显式清理。",
      raw,
    };
  }
}
export function useLocal<T>(key: string, schema: z.ZodType<T>) {
  const [initial] = useState(() => readLocal(key, schema));
  const [value, setValue] = useState<T | null>(initial.value);
  const [error, setError] = useState(initial.error);
  const [blocked, setBlocked] = useState(!!initial.error);
  function write(next: T | null) {
    if (blocked) return false;
    setValue(next);
    try {
      if (next === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(schema.parse(next)));
      setError("");
      return true;
    } catch {
      setError("本机保存失败。请保留此页面、导出备份，或释放浏览器空间后重试。");
      return false;
    }
  }
  function retry() {
    if (!blocked) return write(value);
    const checked = readLocal(key, schema);
    if (checked.error) {
      setError(checked.error);
      return false;
    }
    setValue(checked.value);
    setError("");
    setBlocked(false);
    return true;
  }
  function reset() {
    try {
      localStorage.removeItem(key);
      setBlocked(false);
      setValue(null);
      setError("");
      return true;
    } catch {
      setError("本机记录无法清理，请检查浏览器存储权限");
      return false;
    }
  }
  return { value, write, retry, error, blocked, reset, raw: initial.raw };
}
export const localKey = (name: string, accountId: string) =>
  `ownclass:dictation:${location.pathname}:${accountId}:${name}`;

export function useUnsavedProtection(unsaved: boolean) {
  useEffect(() => {
    const protect = (event: Event) => {
      if (unsaved) event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    window.addEventListener("dictation:before-leave", protect);
    return () => {
      window.removeEventListener("beforeunload", protect);
      window.removeEventListener("dictation:before-leave", protect);
    };
  }, [unsaved]);
}
