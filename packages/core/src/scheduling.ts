import type { LearningProgress } from "../../contract/src/index";

export function localDate(time: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);
}
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function advanceLearning(
  previous: LearningProgress | null,
  result: "correct" | "wrong" | "uncertain" | "unchecked",
  date: string,
  threshold: number,
): LearningProgress | null {
  if (result === "unchecked") return previous;
  if (result === "correct" && !previous) return null;
  const state: LearningProgress = previous ?? {
    status: "pending",
    streak: 0,
    lastQualifiedDate: null,
    lastWrongDate: null,
    dueDate: addDays(date, 1),
    manual: false,
  };
  if (result === "wrong")
    return {
      ...state,
      status: "pending",
      streak: 0,
      lastWrongDate: date,
      dueDate: addDays(date, 1),
      manual: false,
    };
  if (
    result === "uncertain" ||
    state.status === "mastered" ||
    state.lastQualifiedDate === date ||
    state.lastWrongDate === date
  )
    return state;
  const streak = state.streak + 1,
    mastered = streak >= threshold;
  return {
    ...state,
    streak,
    status: mastered ? "mastered" : "pending",
    lastQualifiedDate: date,
    dueDate: mastered ? null : addDays(date, streak === 1 ? 3 : 7),
    manual: false,
  };
}
export function interleaveReview<T>(
  homework: T[],
  review: T[],
  placement: "interleave" | "end",
): T[] {
  if (placement === "end") return [...homework, ...review];
  const result: T[] = [],
    remaining = [...review];
  homework.forEach((item, index) => {
    result.push(item);
    if ((index + 1) % 5 === 0 && remaining.length) result.push(remaining.shift() as T);
  });
  return [...result, ...remaining];
}
