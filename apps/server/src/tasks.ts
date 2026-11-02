import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  type Attempt,
  attemptSchema,
  attemptUpdateSchema,
  entrySchema,
  type Task,
  taskInputSchema,
  taskSchema,
} from "../../../packages/contract/src/index";
import { interleaveReview } from "../../../packages/core/src/scheduling";
import { Learning } from "./learning";
import { attempts, tasks, words } from "./schema";
import { Conflict, type Store } from "./store";

const id = () => randomBytes(12).toString("base64url");
export class Tasks {
  constructor(readonly store: Store) {}
  list(accountId: string) {
    return this.store.db
      .select()
      .from(tasks)
      .where(eq(tasks.accountId, accountId))
      .all()
      .map((row) => taskSchema.parse(JSON.parse(row.payload)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }
  get(accountId: string, taskId: string) {
    const row = this.store.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.accountId, accountId), eq(tasks.id, taskId)))
      .get();
    return row ? taskSchema.parse(JSON.parse(row.payload)) : undefined;
  }
  require(accountId: string, taskId: string) {
    const task = this.get(accountId, taskId);
    if (!task) throw new HTTPException(404, { message: "任务不存在" });
    return task;
  }
  private write(accountId: string, task: Task) {
    this.store.db
      .update(tasks)
      .set({ payload: JSON.stringify(task) })
      .where(and(eq(tasks.accountId, accountId), eq(tasks.id, task.id)))
      .run();
  }
  private build(accountId: string, value: unknown) {
    const input = taskInputSchema.parse(value);
    const items: Task["items"] = [];
    const seen = new Set<string>();
    for (const wordId of input.wordIds) {
      const row = this.store.db
        .select()
        .from(words)
        .where(and(eq(words.id, wordId), eq(words.accountId, accountId)))
        .get();
      if (!row) throw new HTTPException(404, { message: "词条不存在" });
      const entry = entrySchema.parse(JSON.parse(row.payload));
      if (!entry.modes.includes(input.mode))
        throw new HTTPException(400, { message: "词条不支持本次练法" });
      if (!seen.has(wordId))
        items.push({
          wordId,
          entry,
          source: input.reviewOnly ? "review" : "homework",
          batchTitle: "复用内容",
        });
      seen.add(wordId);
    }
    for (const selection of input.selections) {
      const batch = this.store.get(accountId, selection.batchId);
      if (!batch) throw new HTTPException(404, { message: "所选词表不存在" });
      if (
        selection.entryIds.some((entryId) => !batch.entries.some((entry) => entry.id === entryId))
      )
        throw new HTTPException(400, { message: "所选范围已变化，请重新选择" });
      for (const entry of batch.entries.filter((entry) => selection.entryIds.includes(entry.id))) {
        if (!entry.modes.includes(input.mode))
          throw new HTTPException(400, { message: "所选内容不支持本次练法" });
        if (!entry.wordId) throw new HTTPException(400, { message: "请重新保存词表后创建任务" });
        if (!seen.has(entry.wordId))
          items.push({ wordId: entry.wordId, entry, source: "homework", batchTitle: batch.title });
        seen.add(entry.wordId);
      }
    }
    if (input.settings.shuffle) {
      for (let n = items.length - 1; n > 0; n--) {
        const next = Math.floor(Math.random() * (n + 1));
        [items[n], items[next]] = [items[next], items[n]];
      }
    }
    const learning = new Learning(this.store),
      preferences = learning.preferences(accountId);
    const review = learning
      .due(
        accountId,
        input.mode,
        input.date,
        seen,
        input.reviewOnly ? 0 : (input.reviewCount ?? preferences.reviewCount),
      )
      .map(({ entry, state }) => ({
        wordId: state.wordId,
        entry,
        source: "review" as const,
        batchTitle: "待巩固复习",
      }));
    const task = taskSchema.parse({
      ...input,
      selections: undefined,
      id: id(),
      items: interleaveReview(items, review, input.reviewPlacement ?? preferences.reviewPlacement),
      status: "pending",
      revision: 1,
      createdAt: new Date().toISOString(),
    });
    return task;
  }
  preview(accountId: string, value: unknown) {
    return this.build(accountId, value);
  }
  create(accountId: string, value: unknown) {
    const task = this.build(accountId, value);
    this.store.db
      .insert(tasks)
      .values({ id: task.id, accountId, payload: JSON.stringify(task) })
      .run();
    return task;
  }
  update(accountId: string, taskId: string, revision: number, value: unknown) {
    return this.store.db.transaction(() => {
      const previous = this.require(accountId, taskId);
      if (previous.revision !== revision) throw new Conflict();
      if (previous.status !== "pending")
        throw new HTTPException(400, { message: "已开始的任务请复制后修改" });
      const created = this.build(accountId, value);
      const task = {
        ...created,
        id: previous.id,
        revision: previous.revision + 1,
        createdAt: previous.createdAt,
      };
      this.write(accountId, task);
      return task;
    });
  }
  listAttempts(accountId: string, taskId?: string) {
    return this.store.db
      .select()
      .from(attempts)
      .where(
        taskId
          ? and(eq(attempts.accountId, accountId), eq(attempts.taskId, taskId))
          : eq(attempts.accountId, accountId),
      )
      .all()
      .map((row) => attemptSchema.parse(JSON.parse(row.payload)));
  }
  attempt(accountId: string, attemptId: string) {
    const row = this.store.db
      .select()
      .from(attempts)
      .where(and(eq(attempts.accountId, accountId), eq(attempts.id, attemptId)))
      .get();
    if (!row) throw new HTTPException(404, { message: "听写记录不存在" });
    return attemptSchema.parse(JSON.parse(row.payload));
  }
  start(accountId: string, taskId: string, onlyHomework: boolean) {
    return this.store.db.transaction(() => {
      const task = this.require(accountId, taskId);
      const active = this.listAttempts(accountId, taskId).find((attempt) => !attempt.completedAt);
      if (active) return active;
      if (onlyHomework && task.status !== "pending")
        throw new HTTPException(400, { message: "已经开始的任务请复制后调整范围" });
      if (onlyHomework) task.items = task.items.filter((item) => item.source === "homework");
      if (!task.items.length) throw new HTTPException(400, { message: "任务没有可练内容" });
      this.write(accountId, { ...task, status: "in_progress", revision: task.revision + 1 });
      const attempt: Attempt = {
        id: id(),
        taskId,
        revision: 1,
        index: 0,
        phase: "player",
        results: {},
        corrections: [],
        startedAt: new Date().toISOString(),
        completedAt: null,
      };
      this.store.db
        .insert(attempts)
        .values({ id: attempt.id, accountId, taskId, payload: JSON.stringify(attempt) })
        .run();
      return attempt;
    });
  }
  save(accountId: string, attemptId: string, value: unknown) {
    const input = attemptUpdateSchema.parse(value);
    return this.store.db.transaction(() => {
      const previous = this.attempt(accountId, attemptId);
      if (previous.revision !== input.revision) throw new Conflict();
      if (previous.phase === "review" && input.phase === "player")
        throw new HTTPException(400, { message: "核对后请新建一次练习" });
      if (previous.completedAt) throw new HTTPException(400, { message: "已完成的记录不能覆盖" });
      const task = this.require(accountId, previous.taskId);
      if (
        input.index >= task.items.length ||
        Object.keys(input.results).some(
          (wordId) => !task.items.some((item) => item.wordId === wordId),
        )
      )
        throw new HTTPException(400, { message: "核对内容或进度不属于本任务" });
      const attempt = { ...previous, ...input, revision: previous.revision + 1 };
      this.writeAttempt(accountId, attempt);
      return attempt;
    });
  }
  writeAttempt(accountId: string, attempt: Attempt) {
    this.store.db
      .update(attempts)
      .set({ payload: JSON.stringify(attempt) })
      .where(and(eq(attempts.accountId, accountId), eq(attempts.id, attempt.id)))
      .run();
  }
  complete(accountId: string, attemptId: string, revision: number, confirmRemaining: boolean) {
    return this.store.db.transaction(() => {
      const attempt = this.attempt(accountId, attemptId);
      if (attempt.completedAt) return attempt;
      if (attempt.revision !== revision) throw new Conflict();
      if (attempt.phase !== "review") throw new HTTPException(400, { message: "请先进入核对页面" });
      const task = this.require(accountId, attempt.taskId);
      for (const item of task.items)
        attempt.results[item.wordId] ??= confirmRemaining ? "correct" : "unchecked";
      attempt.completedAt = new Date().toISOString();
      attempt.revision++;
      new Learning(this.store).apply(accountId, task, attempt);
      this.writeAttempt(accountId, attempt);
      this.write(accountId, { ...task, status: "completed", revision: task.revision + 1 });
      return attempt;
    });
  }
  correct(accountId: string, attemptId: string, revision: number, wordIds: string[]) {
    return this.store.db.transaction(() => {
      const attempt = this.attempt(accountId, attemptId);
      if (!attempt.completedAt) throw new HTTPException(400, { message: "完成核对后才能记订正" });
      const task = this.require(accountId, attempt.taskId);
      if (wordIds.some((wordId) => !task.items.some((item) => item.wordId === wordId)))
        throw new HTTPException(400, { message: "订正内容不属于本任务" });
      if (wordIds.every((wordId) => attempt.corrections.includes(wordId))) return attempt;
      if (attempt.revision !== revision) throw new Conflict();
      const next = {
        ...attempt,
        corrections: [...new Set([...attempt.corrections, ...wordIds])],
        revision: attempt.revision + 1,
      };
      this.writeAttempt(accountId, next);
      return next;
    });
  }
}
