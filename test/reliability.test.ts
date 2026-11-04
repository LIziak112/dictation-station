import { afterEach, describe, expect, it, vi } from "vitest";
import { readLocal } from "../apps/web/src/storage";
import { draftSchema, normalizeEntry, progressSchema } from "../packages/contract/src/index";
import { editEntry } from "../packages/core/src/edit";
import { parseList } from "../packages/core/src/parse-list";
import { mergeReview } from "../packages/core/src/review";

afterEach(() => vi.unstubAllGlobals());
describe("内容与本机稿边界", () => {
  it("损坏 JSON 仍保留原始字符串用于备份，不导出空值", () => {
    vi.stubGlobal("localStorage", { getItem: () => "{broken", setItem: vi.fn() });
    const result = readLocal("draft", draftSchema);
    expect(result.error).toBeTruthy();
    expect(result.raw).toBe("{broken");
  });
  it("逐字输入英文短语与拼音时保留中间的空格", () => {
    let entry = normalizeEntry({ zh: "照顾" }, 0);
    for (const c of "look after") entry = editEntry(entry, "en", entry.en + c);
    expect(entry.en).toBe("look after");
    for (const c of "tài yáng") entry = editEntry(entry, "pinyin", entry.pinyin + c);
    expect(entry.pinyin).toBe("tài yáng");
  });
  it("单字母英文可导入，未知版本不默认为 v1", () => {
    expect(parseList("I  我\na  一个").entries.map((e) => e.en)).toEqual(["I", "a"]);
    expect(() => parseList('{"version":999,"entries":[{"zh":"太阳"}]}')).toThrow();
    expect(parseList('{"words":[{"zh":"太阳"}]}').entries[0].zh).toBe("太阳");
  });
  it("读取失败与未来版本都保留原数据，不产生空稿", () => {
    const set = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => '{"version":999}', setItem: set });
    expect(readLocal("draft", draftSchema).error).toContain("保留原数据");
    expect(set).not.toHaveBeenCalled();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: set,
    });
    expect(readLocal("draft", draftSchema).error).toContain("读取失败");
    expect(set).not.toHaveBeenCalled();
  });
  it("重练部分词条只更新本轮核对，不清掉其他错词", () => {
    expect(mergeReview(["e1", "e2"], ["e1"], { e1: true })).toEqual(["e2"]);
    expect(mergeReview(["e1", "e2"], ["e1"], { e1: false })).toEqual(["e2", "e1"]);
  });
  it("进度拒绝不在会话内的结果与重复词条", () => {
    const value = {
      version: 1,
      batchId: "test1",
      revision: 1,
      mode: "en2en",
      ids: ["e1"],
      index: 0,
      settings: { repeat: 1, interval: 1, speed: 1, auto: false, shuffle: false },
      results: { e2: true },
      phase: "player",
    };
    expect(progressSchema.safeParse(value).success).toBe(false);
    expect(progressSchema.safeParse({ ...value, ids: ["e1", "e1"], results: {} }).success).toBe(
      false,
    );
    expect(normalizeEntry({ en: "apple", zh: "苹果" }, 0).modes).toContain("en2en");
  });
});
