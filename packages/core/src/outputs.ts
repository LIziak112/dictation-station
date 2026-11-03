import { type Attempt, MODES, type Task } from "../../contract/src/index";

export type PrintTemplate = "blank" | "pinyin" | "review";
export function worksheetRows(task: Task, attempt: Attempt | undefined, template: PrintTemplate) {
  const mode = MODES[task.mode];
  const hasReviewItems = task.items.some((item) => item.source === "review");
  return task.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (template !== "review") return true;
      if (attempt) return attempt.results[item.wordId] !== "correct";
      return hasReviewItems ? item.source === "review" : true;
    })
    .map(({ item, index }) => ({
      number: index + 1,
      prompt:
        template === "pinyin"
          ? item.entry.pinyin || "（未提供拼音）"
          : template === "review"
            ? (mode.show ? item.entry[mode.show] : "") ||
              (item.entry.en ? item.entry.zh : item.entry.pinyin) ||
              `听第 ${index + 1} 项`
            : `听第 ${index + 1} 项`,
      lines: item.entry.kind === "sentence" ? 3 : 1,
    }));
}
export function cardCounts(task: Task, attempt: Attempt) {
  const results = task.items.map((item) => attempt.results[item.wordId] ?? "unchecked");
  return {
    total: task.items.length,
    correct: results.filter((value) => value === "correct").length,
    pending: results.filter((value) => value === "wrong" || value === "uncertain").length,
    unchecked: results.filter((value) => value === "unchecked").length,
    corrected: attempt.corrections.length,
  };
}
