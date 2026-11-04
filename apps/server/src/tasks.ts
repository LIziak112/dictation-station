import { randomBytes, randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  type Attempt,
  attemptSchema,
  attemptUpdateSchema,
  type ChildCorrectionItem,
  type ChildOverview,
  entrySchema,
  MODES,
  type Task,
  type TaskAudio,
  type TaskSummary,
  taskInputSchema,
  taskSchema,
} from "../../../packages/contract/src/index";
import { addDays, interleaveReview, localDate } from "../../../packages/core/src/scheduling";
import { Learning } from "./learning";
import type { Pronunciation } from "./pronunciation";
import { attempts, tasks, words } from "./schema";
import { Conflict, type Store } from "./store";

const id = () => randomBytes(12).toString("base64url");
const LEASE_TIMEOUT_MS = 30_000;

export class Tasks {
  constructor(readonly store: Store) {}
  private expire(accountId: string, task: Task, today: string): Task {
    if (task.status !== "pending" || today <= addDays(task.date, 1)) return task;
    return this.store.db.transaction(() => {
      const row = this.store.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.accountId, accountId), eq(tasks.id, task.id)))
        .get();
      const current = row ? taskSchema.parse(JSON.parse(row.payload)) : task;
      if (current.status !== "pending" || today <= addDays(current.date, 1)) return current;
      const expired: Task = { ...current, status: "expired", revision: current.revision + 1 };
      this.write(accountId, expired);
      this.store.logAudit(
        accountId,
        "task.expired",
        `任务跨日未开始自动过期：${current.title}`,
        "system",
      );
      return expired;
    });
  }
  list(accountId: string) {
    const preferences = new Learning(this.store).preferences(accountId);
    const today = localDate(new Date(), preferences.timezone);
    return this.store.db
      .select()
      .from(tasks)
      .where(eq(tasks.accountId, accountId))
      .all()
      .map((row) => this.expire(accountId, taskSchema.parse(JSON.parse(row.payload)), today))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }
  summarize(accountId: string): TaskSummary[] {
    const taskList = this.list(accountId);
    const allAttempts = this.listAttempts(accountId);
    return taskList.map(({ items, audio: _audio, ...task }) => {
      const taskAttempts = allAttempts.filter((a) => a.taskId === task.id);
      const active = taskAttempts.find((a) => !a.completedAt && !a.interruptedAt);
      const latestCompleted = taskAttempts.filter((a) => a.completedAt).at(-1);
      const latestInterrupted = taskAttempts.filter((a) => a.interruptedAt).at(-1);
      const wrongCount = latestCompleted
        ? items.filter(
            (item) =>
              latestCompleted.results[item.wordId] === "wrong" ||
              latestCompleted.results[item.wordId] === "uncertain",
          ).length
        : undefined;
      const uncorrectedCount = latestCompleted
        ? items.filter(
            (item) =>
              (latestCompleted.results[item.wordId] === "wrong" ||
                latestCompleted.results[item.wordId] === "uncertain") &&
              !latestCompleted.corrections.includes(item.wordId),
          ).length
        : undefined;
      const spotCheckWords =
        latestCompleted && latestCompleted.spotCheckWordIds.length > 0
          ? items
              .filter((item) => latestCompleted.spotCheckWordIds.includes(item.wordId))
              .map((item) => item.entry.en || item.entry.zh)
          : undefined;
      return {
        ...task,
        count: items.length,
        reviewCount: items.filter((item) => item.source === "review").length,
        progressIndex: active
          ? active.index
          : latestInterrupted
            ? latestInterrupted.index
            : undefined,
        submission: active?.submission ?? latestCompleted?.submission,
        activeAttemptId: (active ?? latestCompleted ?? latestInterrupted)?.id,
        wrongCount,
        uncorrectedCount,
        spotCheckWords,
      };
    });
  }
  get(accountId: string, taskId: string) {
    const row = this.store.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.accountId, accountId), eq(tasks.id, taskId)))
      .get();
    if (!row) return undefined;
    const task = taskSchema.parse(JSON.parse(row.payload));
    if (task.status !== "pending") return task;
    const preferences = new Learning(this.store).preferences(accountId);
    return this.expire(accountId, task, localDate(new Date(), preferences.timezone));
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
    this.store.logAudit(
      accountId,
      "task.dispatched",
      `派发任务：${task.title}（${task.items.length} 词）`,
      "parent",
    );
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
  withdraw(accountId: string, taskId: string, revision?: number) {
    return this.store.db.transaction(() => {
      const task = this.require(accountId, taskId);
      if (revision !== undefined && task.revision !== revision) throw new Conflict();
      if (task.status !== "pending" && task.status !== "in_progress")
        throw new HTTPException(400, { message: "只有待开始或进行中的任务可以撤回" });
      const active = this.listAttempts(accountId, taskId).find(
        (attempt) => !attempt.completedAt && !attempt.interruptedAt,
      );
      if (active) {
        this.writeAttempt(accountId, {
          ...active,
          interruptedAt: new Date().toISOString(),
          revision: active.revision + 1,
        });
      }
      const next: Task = {
        ...task,
        status: "withdrawn",
        revision: task.revision + 1,
      };
      this.write(accountId, next);
      this.store.logAudit(
        accountId,
        "task.withdrawn",
        `撤回任务：${task.title}${active ? `（已完成至第 ${active.index + 1}/${task.items.length} 词，已按中断留档）` : ""}`,
        "parent",
      );
      return next;
    });
  }
  reschedule(accountId: string, taskId: string) {
    return this.store.db.transaction(() => {
      const task = this.require(accountId, taskId);
      if (task.status !== "expired" && task.status !== "withdrawn")
        throw new HTTPException(400, { message: "只有已过期或已撤回的任务可以重派" });
      const preferences = new Learning(this.store).preferences(accountId);
      const today = localDate(new Date(), preferences.timezone);
      const next: Task = {
        ...task,
        date: today,
        status: "pending",
        revision: task.revision + 1,
      };
      this.write(accountId, next);
      this.store.logAudit(accountId, "task.dispatched", `重派任务到今日：${task.title}`, "parent");
      return next;
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
  start(
    accountId: string,
    taskId: string,
    onlyHomework: boolean,
    deviceId: string,
    forceTakeover = false,
    isChildMode = false,
  ) {
    if (!deviceId.trim() || deviceId.length > 120)
      throw new HTTPException(400, { message: "开始听写需要有效的设备标识" });
    // Commit expiry before a rejected start rolls back its own transaction.
    this.require(accountId, taskId);
    return this.store.db.transaction(() => {
      const task = this.require(accountId, taskId);
      if (task.status === "withdrawn")
        throw new HTTPException(400, { message: "该任务已被家长撤回" });
      if (task.status === "expired")
        throw new HTTPException(400, { message: "该任务已过期，请找家长重派后再开始" });
      if (task.status === "completed" || task.status === "submitted")
        throw new HTTPException(400, { message: "任务已交卷，再练请由家长复制新任务" });
      const otherActive = this.list(accountId).find(
        (other) => other.id !== taskId && other.status === "in_progress",
      );
      if (otherActive)
        throw new HTTPException(409, {
          message: `同一时间只能进行一份任务，请先完成或交卷「${otherActive.title}」`,
        });
      const active = this.listAttempts(accountId, taskId).find(
        (attempt) => !attempt.completedAt && !attempt.interruptedAt,
      );
      if (active) {
        if (
          deviceId &&
          active.activeDeviceId &&
          active.activeDeviceId !== deviceId &&
          !forceTakeover
        ) {
          const lastBeat = active.heartbeatAt ? new Date(active.heartbeatAt).getTime() : 0;
          if (Date.now() - lastBeat < LEASE_TIMEOUT_MS)
            throw new Conflict(
              `任务正在另一台设备进行（第 ${active.index + 1}/${task.items.length} 项），是否在此设备接管？`,
            );
        }
        if (deviceId && (active.activeDeviceId !== deviceId || forceTakeover)) {
          const taken: Attempt = {
            ...active,
            revision: active.revision + 1,
            activeDeviceId: deviceId,
            heartbeatAt: new Date().toISOString(),
          };
          this.writeAttempt(accountId, taken);
          return taken;
        }
        return active;
      }
      if (onlyHomework && task.status !== "pending")
        throw new HTTPException(400, { message: "已经开始的任务请复制后调整范围" });
      if (onlyHomework) {
        task.items = task.items.filter((item) => item.source === "homework");
        task.audio = task.audio.filter((voice) =>
          task.items.some((item) => item.wordId === voice.wordId),
        );
      }
      if (!task.items.length) throw new HTTPException(400, { message: "任务没有可练内容" });
      this.write(accountId, { ...task, status: "in_progress", revision: task.revision + 1 });
      const now = new Date().toISOString();
      const attempt: Attempt = {
        id: id(),
        taskId,
        revision: 1,
        index: 0,
        phase: "player",
        results: {},
        corrections: [],
        startedAt: now,
        completedAt: null,
        interruptedAt: null,
        activeDeviceId: deviceId,
        heartbeatAt: now,
        spotCheckWordIds: [],
      };
      this.store.db
        .insert(attempts)
        .values({ id: attempt.id, accountId, taskId, payload: JSON.stringify(attempt) })
        .run();
      this.store.logAudit(
        accountId,
        "task.started",
        `开始听写：${task.title}`,
        isChildMode ? "child" : "parent",
      );
      return attempt;
    });
  }
  save(accountId: string, attemptId: string, value: unknown, isChildMode = false) {
    const input = attemptUpdateSchema.parse(value);
    return this.store.db.transaction(() => {
      const previous = this.attempt(accountId, attemptId);
      const task = this.require(accountId, previous.taskId);
      if (task.status === "withdrawn" || previous.interruptedAt)
        throw new Conflict("家长已撤回该任务，本次练习已停止");
      if (previous.revision !== input.revision) throw new Conflict();
      if (previous.phase === "player" && !input.deviceId?.trim())
        throw new HTTPException(400, { message: "保存听写进度需要有效的设备标识" });
      if (
        previous.phase === "player" &&
        input.deviceId &&
        previous.activeDeviceId &&
        previous.activeDeviceId !== input.deviceId &&
        !input.forceTakeover
      ) {
        const lastBeat = previous.heartbeatAt ? new Date(previous.heartbeatAt).getTime() : 0;
        if (Date.now() - lastBeat < LEASE_TIMEOUT_MS)
          throw new Conflict("该任务已在另一台设备接管，当前设备已暂停");
      }
      if (previous.phase === "review" && input.phase === "player")
        throw new HTTPException(400, { message: "核对后请新建一次练习" });
      if (previous.completedAt) throw new HTTPException(400, { message: "已完成的记录不能覆盖" });
      if (
        input.index >= task.items.length ||
        Object.keys(input.results).some(
          (wordId) => !task.items.some((item) => item.wordId === wordId),
        )
      )
        throw new HTTPException(400, { message: "核对内容或进度不属于本任务" });
      const now = new Date().toISOString();
      const submitting = previous.phase === "player" && input.phase === "review";
      const attempt: Attempt = {
        ...previous,
        index: input.index,
        phase: input.phase,
        practiceDate: submitting
          ? localDate(new Date(now), new Learning(this.store).preferences(accountId).timezone)
          : previous.practiceDate,
        submission: submitting
          ? {
              early: input.earlySubmission ?? input.index < task.items.length - 1,
              index: input.index,
              at: now,
            }
          : previous.submission,
        results: isChildMode && !task.allowSelfReview ? previous.results : input.results,
        activeDeviceId: input.deviceId || previous.activeDeviceId,
        heartbeatAt: now,
        revision: previous.revision + 1,
      };
      this.writeAttempt(accountId, attempt);
      if (
        input.phase === "review" &&
        previous.phase === "player" &&
        (task.status === "in_progress" || task.status === "pending")
      ) {
        this.write(accountId, { ...task, status: "submitted", revision: task.revision + 1 });
        this.store.logAudit(
          accountId,
          "attempt.submitted",
          `完成听写并交卷：${task.title}`,
          isChildMode ? "child" : "parent",
        );
      }
      return attempt;
    });
  }
  returnForRedo(accountId: string, attemptId: string, revision: number, resetIndex = true) {
    return this.store.db.transaction(() => {
      const attempt = this.attempt(accountId, attemptId);
      if (attempt.completedAt)
        throw new HTTPException(400, { message: "已完成的任务不可退回，请使用错词重派" });
      if (attempt.revision !== revision) throw new Conflict();
      const task = this.require(accountId, attempt.taskId);
      if (task.status !== "submitted" || attempt.interruptedAt)
        throw new HTTPException(400, { message: "只有待批改的任务可以退回重做" });
      const otherActive = this.list(accountId).find(
        (other) => other.id !== task.id && other.status === "in_progress",
      );
      if (otherActive)
        throw new HTTPException(409, {
          message: `请先完成或交卷「${otherActive.title}」，再退回这份任务`,
        });
      const nextAttempt: Attempt = {
        ...attempt,
        phase: "player",
        index: resetIndex ? 0 : attempt.index,
        submission: undefined,
        practiceDate: undefined,
        results: {},
        activeDeviceId: "",
        heartbeatAt: new Date().toISOString(),
        revision: attempt.revision + 1,
      };
      this.writeAttempt(accountId, nextAttempt);
      this.write(accountId, { ...task, status: "in_progress", revision: task.revision + 1 });
      this.store.logAudit(
        accountId,
        "attempt.returned",
        `家长退回任务重做：${task.title}`,
        "parent",
      );
      return nextAttempt;
    });
  }
  writeAttempt(accountId: string, attempt: Attempt) {
    this.store.db
      .update(attempts)
      .set({ payload: JSON.stringify(attempt) })
      .where(and(eq(attempts.accountId, accountId), eq(attempts.id, attempt.id)))
      .run();
  }
  complete(
    accountId: string,
    attemptId: string,
    revision: number,
    confirmRemaining: boolean,
    isChildMode = false,
  ) {
    return this.store.db.transaction(() => {
      const attempt = this.attempt(accountId, attemptId);
      if (attempt.completedAt) return attempt;
      if (attempt.revision !== revision) throw new Conflict();
      const task = this.require(accountId, attempt.taskId);
      if (isChildMode && !task.allowSelfReview)
        throw new HTTPException(403, { message: "该任务需由家长核对批改" });
      if (attempt.phase !== "review") throw new HTTPException(400, { message: "请先进入核对页面" });
      for (const item of task.items) {
        if (!attempt.results[item.wordId] || attempt.results[item.wordId] === "unchecked")
          attempt.results[item.wordId] = confirmRemaining ? "correct" : "unchecked";
      }
      if (isChildMode && task.allowSelfReview) {
        const correctIds = task.items
          .map((item) => item.wordId)
          .filter((wordId) => attempt.results[wordId] === "correct");
        attempt.spotCheckWordIds = [];
        while (correctIds.length && attempt.spotCheckWordIds.length < 2) {
          attempt.spotCheckWordIds.push(correctIds.splice(randomInt(correctIds.length), 1)[0]);
        }
      }
      attempt.completedAt = new Date().toISOString();
      attempt.masteryThreshold = new Learning(this.store).preferences(accountId).masteryThreshold;
      attempt.revision++;
      new Learning(this.store).apply(accountId, task, attempt);
      this.writeAttempt(accountId, attempt);
      this.write(accountId, { ...task, status: "completed", revision: task.revision + 1 });
      this.store.logAudit(
        accountId,
        "attempt.completed",
        `${isChildMode ? "孩子自主核对完成" : "家长完成批改"}：${task.title}`,
        isChildMode ? "child" : "parent",
      );
      return attempt;
    });
  }
  correct(
    accountId: string,
    attemptId: string,
    revision: number,
    wordIds: string[],
    isChildMode = false,
  ) {
    return this.store.db.transaction(() => {
      const attempt = this.attempt(accountId, attemptId);
      if (!attempt.completedAt) throw new HTTPException(400, { message: "完成核对后才能记订正" });
      const task = this.require(accountId, attempt.taskId);
      if (wordIds.some((wordId) => !task.items.some((item) => item.wordId === wordId)))
        throw new HTTPException(400, { message: "订正内容不属于本任务" });
      if (wordIds.some((wordId) => !["wrong", "uncertain"].includes(attempt.results[wordId])))
        throw new HTTPException(400, { message: "只能标记错词或不确定项已订正" });
      if (wordIds.every((wordId) => attempt.corrections.includes(wordId))) return attempt;
      if (attempt.revision !== revision) throw new Conflict();
      const next = {
        ...attempt,
        corrections: [...new Set([...attempt.corrections, ...wordIds])],
        revision: attempt.revision + 1,
      };
      this.writeAttempt(accountId, next);
      this.store.logAudit(
        accountId,
        "attempt.corrected",
        `标记错词已订正：${task.title}（${wordIds.length} 项）`,
        isChildMode ? "child" : "parent",
      );
      return next;
    });
  }
  redispatchWrong(accountId: string, attemptId: string) {
    const attempt = this.attempt(accountId, attemptId);
    if (!attempt.completedAt)
      throw new HTTPException(400, { message: "请先完成批改再派发错词复练" });
    const task = this.require(accountId, attempt.taskId);
    const wordIds = task.items
      .map((item) => item.wordId)
      .filter(
        (wordId) => attempt.results[wordId] === "wrong" || attempt.results[wordId] === "uncertain",
      );
    if (!wordIds.length)
      throw new HTTPException(400, { message: "本次听写没有错词或待确认项，无需重派" });
    const preferences = new Learning(this.store).preferences(accountId);
    const today = localDate(new Date(), preferences.timezone);
    const suffix = " · 错词复练";
    return this.create(accountId, {
      title: `${task.title.slice(0, 80 - suffix.length)}${suffix}`,
      date: today,
      mode: task.mode,
      settings: task.settings,
      selections: [],
      wordIds,
      reviewCount: 0,
      allowSelfReview: task.allowSelfReview,
      parentTaskId: task.id,
    });
  }
  lockedWordIds(accountId: string) {
    const locked = new Set<string>();
    for (const task of this.list(accountId)) {
      if (
        task.status === "pending" ||
        task.status === "in_progress" ||
        task.status === "submitted"
      ) {
        for (const item of task.items) locked.add(item.wordId);
      }
    }
    return locked;
  }
  childOverview(accountId: string): ChildOverview {
    const summaries = this.summarize(accountId).filter(
      (task) =>
        task.status === "pending" ||
        task.status === "in_progress" ||
        task.status === "submitted" ||
        task.status === "completed",
    );
    const statusOrder: Record<string, number> = {
      in_progress: 0,
      pending: 1,
      submitted: 2,
      completed: 3,
    };
    const sortedTasks = [...summaries].sort((a, b) => {
      const orderDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (orderDiff !== 0) return orderDiff;
      if (a.status === "pending") return a.createdAt.localeCompare(b.createdAt);
      return b.createdAt.localeCompare(a.createdAt);
    });
    const allAttempts = this.listAttempts(accountId)
      .filter((a) => a.completedAt !== null)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    const corrections: ChildCorrectionItem[] = [];
    for (const attempt of allAttempts) {
      const task = this.get(accountId, attempt.taskId);
      if (!task) continue;
      const wrongWords = task.items.flatMap((item) => {
        const res = attempt.results[item.wordId];
        if (res !== "wrong" && res !== "uncertain") return [];
        return [
          {
            wordId: item.wordId,
            entry: item.entry,
            result: res,
            corrected: attempt.corrections.includes(item.wordId),
          },
        ];
      });
      if (wrongWords.length > 0) {
        corrections.push({
          attemptId: attempt.id,
          attemptRevision: attempt.revision,
          taskId: task.id,
          taskTitle: task.title,
          taskDate: task.date,
          mode: task.mode,
          completedAt: attempt.completedAt as string,
          totalCount: task.items.length,
          correctCount: task.items.filter((i) => attempt.results[i.wordId] === "correct").length,
          words: wrongWords,
        });
      }
    }
    const locked = this.lockedWordIds(accountId);
    const batches = this.store.list(accountId).map(({ entries, ...batch }) => ({
      ...batch,
      count: entries.length,
      lockedCount: entries.filter((e) => e.wordId && locked.has(e.wordId)).length,
    }));
    return {
      tasks: sortedTasks,
      corrections: [
        ...corrections.filter((item) => item.words.some((word) => !word.corrected)),
        ...corrections.filter((item) => item.words.every((word) => word.corrected)).slice(0, 15),
      ],
      batches,
    };
  }
  childListenBatch(accountId: string, batchId: string) {
    const batch = this.store.get(accountId, batchId);
    if (!batch) throw new HTTPException(404, { message: "词表不存在" });
    const locked = this.lockedWordIds(accountId);
    return {
      // 待考词仅在界面隐藏文字；设备朗读仍需要原文。
      batch,
      lockedWordIds: [...locked].filter((wid) => batch.entries.some((e) => e.wordId === wid)),
    };
  }
  async prepareAudio(
    accountId: string,
    taskId: string,
    provider: Pronunciation,
    fallbackIds: string[],
  ) {
    const task = this.require(accountId, taskId);
    if (task.status !== "pending" && task.audio.length > 0 && !fallbackIds.length)
      return task.audio;
    const mode = MODES[task.mode],
      audio: TaskAudio[] = [];
    if (!mode.audio) return audio;
    const lang = mode.audio;
    for (let offset = 0; offset < task.items.length; offset += 3) {
      const group = await Promise.all(
        task.items.slice(offset, offset + 3).map(async ({ entry, wordId }) => {
          const previous = task.audio.find((voice) => voice.wordId === wordId);
          if (fallbackIds.length && !fallbackIds.includes(wordId) && previous) return previous;
          return {
            ...(await provider.prepare(
              {
                text: entry[lang],
                lang,
                accent: task.settings.accent,
                reading: entry.readings[lang] || entry.reading,
                pinyin: lang === "zh" ? entry.pinyin : undefined,
              },
              fallbackIds.includes(wordId),
            )),
            wordId,
            text: entry[lang],
            lang,
          };
        }),
      );
      audio.push(...group);
    }
    return this.store.db.transaction(() => {
      const current = this.require(accountId, taskId);
      if (current.revision !== task.revision) throw new Conflict();
      this.write(accountId, { ...current, audio, revision: current.revision + 1 });
      for (const voice of audio)
        if (voice.url) this.store.grantAudio(accountId, voice.url.slice("audio/".length));
      return audio;
    });
  }
}
