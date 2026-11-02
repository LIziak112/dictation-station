import { expect, it } from "vitest";
import {
  type Attempt,
  defaultSettings,
  normalizeEntry,
  type Task,
} from "../packages/contract/src/index";
import { cardCounts, worksheetRows } from "../packages/core/src/outputs";

const task: Task = {
  id: "task",
  title: "打印测试",
  date: "2026-11-03",
  mode: "zh_dictation",
  settings: defaultSettings,
  status: "completed",
  revision: 1,
  createdAt: "2026-11-03T00:00:00Z",
  audio: [],
  items: [
    {
      wordId: "word1",
      entry: normalizeEntry({ zh: "太阳", pinyin: "tài yáng" }, 0),
      source: "homework",
      batchTitle: "词表",
    },
    {
      wordId: "word2",
      entry: normalizeEntry({ zh: "月亮", pinyin: "yuè liang" }, 1),
      source: "review",
      batchTitle: "旧词",
    },
  ],
};
const attempt: Attempt = {
  id: "attempt",
  taskId: "task",
  revision: 1,
  index: 1,
  phase: "review",
  startedAt: "2026-11-03T00:00:00Z",
  completedAt: "2026-11-03T00:01:00Z",
  results: { word1: "wrong" },
  corrections: ["word1"],
};

it("空白与拼音纸默认不含答案，待巩固卷保留原编号", () => {
  expect(JSON.stringify(worksheetRows(task, attempt, "blank"))).not.toContain("太阳");
  expect(worksheetRows(task, attempt, "pinyin")[0].prompt).toBe("tài yáng");
  expect(JSON.stringify(worksheetRows(task, attempt, "pinyin"))).not.toContain("太阳");
  expect(
    worksheetRows(
      task,
      { ...attempt, results: { word1: "correct", word2: "uncertain" } },
      "review",
    ).map((row) => row.number),
  ).toEqual([2]);
});
it("汇报卡不把未核对项算正确，订正独立统计", () => {
  expect(cardCounts(task, attempt)).toEqual({
    total: 2,
    correct: 0,
    pending: 1,
    unchecked: 1,
    corrected: 1,
  });
});
