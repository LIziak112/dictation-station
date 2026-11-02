import { type Entry, normalizeEntry } from "../../contract/src/index";

// 输入阶段保留空格；只在推导模式、导入与服务端保存边界规范化字段。
export function editEntry(
  entry: Entry,
  field: "en" | "zh" | "pinyin" | "hint",
  value: string,
): Entry {
  const next = { ...entry, [field]: value };
  return {
    ...next,
    modes: field === "hint" ? entry.modes : normalizeEntry({ ...next, modes: undefined }, 0).modes,
  };
}
