import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  type Attempt,
  accountPreferencesSchema,
  attemptSchema,
  entrySchema,
  type LearningItem,
  type LearningState,
  learningStateSchema,
  MODES,
  type Mode,
  type Task,
  taskSchema,
} from "../../../packages/contract/src/index";
import { addDays, advanceLearning, localDate } from "../../../packages/core/src/scheduling";
import { accounts, attempts, learningStates, tasks, words } from "./schema";
import type { Store } from "./store";

export class Learning {
  constructor(readonly store: Store) {}
  preferences(accountId: string) {
    const row = this.store.db
      .select({ preferences: accounts.preferences })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();
    if (!row) throw new HTTPException(404, { message: "账号不存在" });
    return accountPreferencesSchema.parse(JSON.parse(row.preferences));
  }
  setPreferences(accountId: string, value: unknown) {
    const preferences = accountPreferencesSchema.parse(value);
    this.store.db
      .update(accounts)
      .set({ preferences: JSON.stringify(preferences) })
      .where(eq(accounts.id, accountId))
      .run();
    return preferences;
  }
  list(accountId: string): LearningItem[] {
    return this.store.db
      .select({ payload: learningStates.payload, entry: words.payload })
      .from(learningStates)
      .innerJoin(
        words,
        and(eq(words.id, learningStates.wordId), eq(words.accountId, learningStates.accountId)),
      )
      .where(eq(learningStates.accountId, accountId))
      .all()
      .map((row) => ({
        state: learningStateSchema.parse(JSON.parse(row.payload)),
        entry: entrySchema.parse(JSON.parse(row.entry)),
      }));
  }
  private write(accountId: string, state: LearningState) {
    this.store.db
      .insert(learningStates)
      .values({ accountId, wordId: state.wordId, mode: state.mode, payload: JSON.stringify(state) })
      .onConflictDoUpdate({
        target: [learningStates.accountId, learningStates.wordId, learningStates.mode],
        set: { payload: JSON.stringify(state) },
      })
      .run();
  }
  apply(accountId: string, task: Task, attempt: Attempt) {
    const preferences = this.preferences(accountId);
    const date = localDate(new Date(attempt.completedAt as string), preferences.timezone);
    for (const item of task.items) {
      const row = this.store.db
        .select()
        .from(learningStates)
        .where(
          and(
            eq(learningStates.accountId, accountId),
            eq(learningStates.wordId, item.wordId),
            eq(learningStates.mode, task.mode),
          ),
        )
        .get();
      const previous = row ? learningStateSchema.parse(JSON.parse(row.payload)) : null;
      const next = advanceLearning(
        previous,
        attempt.results[item.wordId] ?? "unchecked",
        date,
        preferences.masteryThreshold,
      );
      if (next)
        this.write(accountId, {
          ...next,
          wordId: item.wordId,
          mode: task.mode,
          lastPracticedAt: attempt.completedAt as string,
        });
    }
  }
  due(accountId: string, mode: Mode, date: string, excluded: Set<string>, limit: number) {
    return this.list(accountId)
      .filter(
        ({ state }) =>
          state.mode === mode &&
          state.status === "pending" &&
          state.dueDate !== null &&
          state.dueDate <= date &&
          !excluded.has(state.wordId),
      )
      .sort(
        (a, b) =>
          (a.state.dueDate ?? "").localeCompare(b.state.dueDate ?? "") ||
          (b.state.lastWrongDate ?? "").localeCompare(a.state.lastWrongDate ?? "") ||
          a.state.wordId.localeCompare(b.state.wordId),
      )
      .slice(0, limit);
  }
  manual(accountId: string, wordId: string, mode: Mode, status: "pending" | "mastered") {
    const item = this.list(accountId).find(
      ({ state }) => state.wordId === wordId && state.mode === mode,
    );
    if (!item) throw new HTTPException(404, { message: "待巩固记录不存在" });
    const date = localDate(new Date(), this.preferences(accountId).timezone);
    const state = {
      ...item.state,
      status,
      manual: true,
      ...(status === "pending" ? { streak: 0, dueDate: date } : { dueDate: null }),
    };
    this.write(accountId, state);
    return state;
  }
  history(accountId: string) {
    return this.store.db
      .select({ attempt: attempts.payload, task: tasks.payload })
      .from(attempts)
      .innerJoin(tasks, and(eq(tasks.id, attempts.taskId), eq(tasks.accountId, attempts.accountId)))
      .where(eq(attempts.accountId, accountId))
      .all()
      .map((row) => {
        const { items, ...task } = taskSchema.parse(JSON.parse(row.task));
        return {
          task: {
            ...task,
            count: items.length,
            reviewCount: items.filter((item) => item.source === "review").length,
          },
          attempt: attemptSchema.parse(JSON.parse(row.attempt)),
        };
      })
      .filter(({ attempt }) => attempt.completedAt)
      .sort((a, b) => (b.attempt.completedAt ?? "").localeCompare(a.attempt.completedAt ?? ""));
  }
  exam(accountId: string, from: string, to: string, mode: Mode) {
    const preferences = this.preferences(accountId),
      latest = new Map<string, string>();
    for (const { task, attempt } of this.history(accountId)) {
      const date = localDate(new Date(attempt.completedAt as string), preferences.timezone);
      if (task.mode === mode && date >= from && date <= to) {
        for (const [wordId, result] of Object.entries(attempt.results))
          if (!latest.has(wordId)) latest.set(wordId, result);
      }
    }
    const states = new Map(
      this.list(accountId)
        .filter((item) => item.state.mode === mode)
        .map((item) => [item.state.wordId, item.state]),
    );
    return this.store.db
      .select()
      .from(words)
      .where(eq(words.accountId, accountId))
      .all()
      .filter(
        (row) =>
          latest.has(row.id) &&
          (states.get(row.id)?.status === "pending" ||
            (!states.has(row.id) && latest.get(row.id) !== "correct")),
      )
      .map((row) => ({
        wordId: row.id,
        entry: entrySchema.parse(JSON.parse(row.payload)),
        status: states.get(row.id)?.status ?? "unchecked",
      }));
  }
  weekly(accountId: string) {
    const preferences = this.preferences(accountId),
      today = localDate(new Date(), preferences.timezone);
    const day = new Date(`${today}T00:00:00Z`).getUTCDay(),
      from = addDays(today, -((day + 6) % 7));
    const completed = this.history(accountId).filter(({ attempt }) => {
      const date = localDate(new Date(attempt.completedAt as string), preferences.timezone);
      return date >= from && date <= today;
    }).length;
    const pending = this.list(accountId).filter(({ state }) => state.status === "pending");
    const next = (Object.keys(MODES) as Mode[]).flatMap((mode) =>
      this.due(accountId, mode, today, new Set(), preferences.reviewCount),
    );
    return { completed, pending: pending.length, next, from, to: today };
  }
}
