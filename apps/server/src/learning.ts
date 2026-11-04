import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
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
import { accounts, attempts, learningStates, metadata, tasks, words } from "./schema";
import type { Store } from "./store";

const checkpointSchema = z.object({
  state: learningStateSchema.nullable(),
  ignoredSubmissions: z.array(z.string()),
});
const checkpointKey = (accountId: string, wordId: string, mode: Mode) =>
  `learning-checkpoint:${accountId}:${wordId}:${mode}`;
const practiceTime = (attempt: Attempt) =>
  attempt.submission?.at ?? (attempt.completedAt as string);
const practiceDate = (attempt: Attempt, timezone: string) =>
  attempt.practiceDate ?? localDate(new Date(practiceTime(attempt)), timezone);
const submissionKey = (attempt: Attempt) =>
  `${attempt.id}:${attempt.submission?.at ?? attempt.startedAt}`;

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
    const history = this.history(accountId).filter((item) => item.task.mode === task.mode);
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
      const key = checkpointKey(accountId, item.wordId, task.mode);
      const stored = this.store.db.select().from(metadata).where(eq(metadata.key, key)).get();
      // Preserve existing learning data; replay only grades recorded after this checkpoint.
      const checkpoint = stored
        ? checkpointSchema.parse(JSON.parse(stored.value))
        : {
            state: previous,
            ignoredSubmissions: history.map(({ attempt }) => submissionKey(attempt)),
          };
      if (!stored)
        this.store.db
          .insert(metadata)
          .values({ key, value: JSON.stringify(checkpoint) })
          .run();
      const ignored = new Set(checkpoint.ignoredSubmissions);
      const records = [...history.map(({ attempt }) => attempt), attempt]
        .filter(
          (record) =>
            !ignored.has(submissionKey(record)) && Object.hasOwn(record.results, item.wordId),
        )
        .sort(
          (a, b) =>
            practiceDate(a, preferences.timezone).localeCompare(
              practiceDate(b, preferences.timezone),
            ) ||
            practiceTime(a).localeCompare(practiceTime(b)) ||
            a.id.localeCompare(b.id),
        );
      let state: LearningState | null = checkpoint.state;
      for (const record of records) {
        const next = advanceLearning(
          state,
          record.results[item.wordId],
          practiceDate(record, preferences.timezone),
          record.masteryThreshold ?? preferences.masteryThreshold,
        );
        if (next)
          state = {
            ...next,
            wordId: item.wordId,
            mode: task.mode,
            lastPracticedAt: practiceTime(record),
          };
      }
      if (state) this.write(accountId, state);
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
    return this.store.db.transaction(() => {
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
      const key = checkpointKey(accountId, wordId, mode);
      const ignoredSubmissions = this.records(accountId)
        .filter((record) => record.task.mode === mode && record.attempt.phase === "review")
        .map((record) => submissionKey(record.attempt));
      const value = JSON.stringify({ state, ignoredSubmissions });
      this.store.db
        .insert(metadata)
        .values({ key, value })
        .onConflictDoUpdate({ target: metadata.key, set: { value } })
        .run();
      return state;
    });
  }
  private records(accountId: string) {
    return this.store.db
      .select({ attempt: attempts.payload, task: tasks.payload })
      .from(attempts)
      .innerJoin(tasks, and(eq(tasks.id, attempts.taskId), eq(tasks.accountId, attempts.accountId)))
      .where(eq(attempts.accountId, accountId))
      .all()
      .map((row) => {
        const { items, audio: _audio, ...task } = taskSchema.parse(JSON.parse(row.task));
        return {
          task: {
            ...task,
            count: items.length,
            reviewCount: items.filter((item) => item.source === "review").length,
          },
          attempt: attemptSchema.parse(JSON.parse(row.attempt)),
        };
      });
  }
  history(accountId: string) {
    return this.records(accountId)
      .filter(({ attempt }) => attempt.completedAt)
      .sort((a, b) => (b.attempt.completedAt ?? "").localeCompare(a.attempt.completedAt ?? ""));
  }
  exam(accountId: string, from: string, to: string, mode: Mode) {
    const preferences = this.preferences(accountId),
      latest = new Map<string, string>();
    for (const { task, attempt } of this.history(accountId)) {
      const date = practiceDate(attempt, preferences.timezone);
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
      const date = practiceDate(attempt, preferences.timezone);
      return date >= from && date <= today;
    }).length;
    const pending = this.list(accountId).filter(({ state }) => state.status === "pending");
    const next = (Object.keys(MODES) as Mode[]).flatMap((mode) =>
      this.due(accountId, mode, today, new Set(), preferences.reviewCount),
    );
    return { completed, pending: pending.length, next, from, to: today };
  }
}
