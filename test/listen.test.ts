import { expect, it } from "vitest";
import { normalizeEntry } from "../packages/contract/src/index";
import { listeningQueue } from "../packages/core/src/listen";

it("中英交替保留同一词的配对，不朗读缺失内容；打乱只改变词的顺序", () => {
  const entries = [
    normalizeEntry({ en: "sun", zh: "太阳" }, 0),
    normalizeEntry({ en: "moon", zh: "月亮" }, 1),
    normalizeEntry({ zh: "音乐", pinyin: "yīn yuè" }, 2),
  ];
  expect(listeningQueue(entries, "both", false).map((item) => item.audioText)).toEqual([
    "sun",
    "太阳",
    "moon",
    "月亮",
    "音乐",
  ]);
  const shuffled = listeningQueue(entries.slice(0, 2), "both", true, () => 0);
  expect(shuffled.map((item) => item.audioText)).toEqual(["moon", "月亮", "sun", "太阳"]);
  expect(listeningQueue(entries, "en", false)).toHaveLength(2);
});
