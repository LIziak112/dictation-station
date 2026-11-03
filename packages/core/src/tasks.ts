import { type Entry, MODES, type Task } from "../../contract/src/index";

export function selectRange<T>(items: T[], range: string): T[] {
  if (!range.trim()) return items;
  const indexes = new Set<number>();
  for (const part of range.split(/[,，、]/)) {
    const match = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!match) throw new Error("范围请填写 1-10 或 1,3,5");
    const from = Number(match[1]),
      to = Number(match[2] ?? match[1]);
    if (from < 1 || to < from || to > items.length) throw new Error("范围超出词表，请检查编号");
    for (let n = from; n <= to; n++) indexes.add(n - 1);
  }
  return items.filter((_, index) => indexes.has(index));
}
export function contentKey(entry: Entry) {
  const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return JSON.stringify(
    [
      entry.kind,
      entry.en,
      entry.zh,
      entry.pinyin,
      entry.hint,
      entry.reading,
      entry.readings.en,
      entry.readings.zh,
      ...entry.alt,
    ].map(normalize),
  );
}
export function projectTask(task: Task) {
  const { items, ...summary } = task;
  const mode = MODES[task.mode];
  return {
    ...summary,
    homeworkCount: items.filter((item) => item.source === "homework").length,
    items: items.map(({ wordId, entry }) => ({
      wordId,
      audioKey: wordId,
      prompt: mode.show ? entry[mode.show] : "",
      hint: entry.hint,
      audioText: mode.audio ? entry[mode.audio] : "",
      lang: mode.audio,
      kind: entry.kind,
      reading: mode.audio ? entry.readings[mode.audio] || entry.reading : "",
    })),
  };
}
