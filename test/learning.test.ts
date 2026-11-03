import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Auth } from "../apps/server/src/auth";
import { Learning } from "../apps/server/src/learning";
import { Store } from "../apps/server/src/store";
import { Tasks } from "../apps/server/src/tasks";
import { defaultSettings } from "../packages/contract/src/index";
import { advanceLearning, interleaveReview } from "../packages/core/src/scheduling";

const stores: Store[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
});

it("同日订正不计通过，三个不同日期通过后掌握，再错重新入池", () => {
  let state = advanceLearning(null, "wrong", "2026-11-01", 3);
  expect(state?.streak).toBe(0);
  state = advanceLearning(state, "correct", "2026-11-01", 3);
  expect(state?.streak).toBe(0);
  state = advanceLearning(state, "correct", "2026-11-02", 3);
  expect(state?.streak).toBe(1);
  expect(advanceLearning(state, "correct", "2026-11-02", 3)?.streak).toBe(1);
  state = advanceLearning(state, "correct", "2026-11-05", 3);
  state = advanceLearning(state, "correct", "2026-11-12", 3);
  expect(state?.status).toBe("mastered");
  expect(state?.dueDate).toBeNull();
  state = advanceLearning(state, "wrong", "2026-11-13", 3);
  expect(state?.status).toBe("pending");
  expect(state?.streak).toBe(0);
  expect(advanceLearning(null, "unchecked", "2026-11-01", 3)).toBeNull();
  const uncertainFirst = advanceLearning(null, "uncertain", "2026-11-01", 3);
  expect(uncertainFirst?.status).toBe("pending");
  expect(uncertainFirst?.dueDate).toBe("2026-11-02");
  expect(advanceLearning(state, "uncertain", "2026-11-14", 3)?.streak).toBe(0);
  expect(advanceLearning(state, "uncertain", "2026-11-14", 3)?.status).toBe("pending");
});
it("穿插保留作业原顺序，剩余复习置于末尾", () => {
  expect(interleaveReview([1, 2, 3, 4, 5, 6], [7, 8], "interleave")).toEqual([
    1, 2, 3, 4, 5, 7, 6, 8,
  ]);
  expect(interleaveReview([1, 2], [7, 8], "end")).toEqual([1, 2, 7, 8]);
});
it("完成核对原子写学习状态，重复请求不计数，练法与账号隔离，阶段复习去重", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-learning-")));
  stores.push(store);
  const account = await new Auth(store).register("parent", "synthetic-password");
  if (!account) throw new Error("测试账号失败");
  const tasks = new Tasks(store),
    learning = new Learning(store);
  const batch = store.create(account.id, { entries: [{ en: "sun", zh: "太阳" }] });
  const input = {
    title: "听写",
    date: "2026-11-01",
    mode: "en2en",
    settings: defaultSettings,
    selections: [{ batchId: batch.id, entryIds: [batch.entries[0].id] }],
    reviewCount: 0,
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:00:00Z"));
  const task = tasks.create(account.id, input),
    attempt = tasks.start(account.id, task.id, false);
  const next = tasks.save(account.id, attempt.id, {
    revision: 1,
    index: 0,
    phase: "review",
    results: { [task.items[0].wordId]: "wrong" },
  });
  tasks.complete(account.id, attempt.id, next.revision, false);
  expect(learning.list(account.id)[0].state.streak).toBe(0);
  vi.setSystemTime(new Date("2026-11-02T04:00:00Z"));
  const later = tasks.create(account.id, { ...input, date: "2026-11-02" }),
    practice = tasks.start(account.id, later.id, false);
  const checked = tasks.save(account.id, practice.id, {
    revision: 1,
    index: 0,
    phase: "review",
    results: {},
  });
  tasks.complete(account.id, practice.id, checked.revision, true);
  tasks.complete(account.id, practice.id, checked.revision, true);
  expect(learning.list(account.id)[0].state.streak).toBe(1);
  expect(learning.list(account.id).filter((item) => item.state.mode === "zh2en")).toEqual([]);
  expect(learning.list("another-account")).toEqual([]);
  expect(learning.exam(account.id, "2026-11-01", "2026-11-02", "en2en")).toHaveLength(1);
  const corrected = tasks.correct(
    account.id,
    attempt.id,
    tasks.attempt(account.id, attempt.id).revision,
    [task.items[0].wordId],
  );
  expect(corrected.corrections).toHaveLength(1);
  expect(learning.list(account.id)[0].state.streak).toBe(1);
});
it("到期复习排除今日已有项，只作业入口不改变历史任务范围", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-due-")));
  stores.push(store);
  const account = await new Auth(store).register("parent", "synthetic-password");
  if (!account) throw new Error("测试账号失败");
  const tasks = new Tasks(store);
  const batch = store.create(account.id, {
    entries: [
      { en: "sun", zh: "太阳" },
      { en: "moon", zh: "月亮" },
    ],
  });
  const input = {
    title: "听写",
    date: "2026-11-01",
    mode: "en2en",
    settings: defaultSettings,
    selections: [{ batchId: batch.id, entryIds: [batch.entries[0].id] }],
    reviewCount: 0,
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:00:00Z"));
  const original = tasks.create(account.id, input),
    attempt = tasks.start(account.id, original.id, false);
  tasks.save(account.id, attempt.id, {
    revision: 1,
    index: 0,
    phase: "review",
    results: { [original.items[0].wordId]: "wrong" },
  });
  tasks.complete(account.id, attempt.id, 2, false);
  vi.setSystemTime(new Date("2026-11-02T04:00:00Z"));
  const withReview = tasks.create(account.id, {
    ...input,
    date: "2026-11-02",
    selections: [{ batchId: batch.id, entryIds: [batch.entries[1].id] }],
    reviewCount: 3,
  });
  expect(withReview.items.map((item) => item.entry.en)).toEqual(["moon", "sun"]);
  tasks.start(account.id, withReview.id, true);
  expect(tasks.require(account.id, withReview.id).items.map((item) => item.entry.en)).toEqual([
    "moon",
  ]);
  const same = tasks.create(account.id, { ...input, date: "2026-11-02", reviewCount: 3 });
  expect(same.items).toHaveLength(1);
  expect(tasks.require(account.id, original.id).items[0].entry.en).toBe("sun");
});
it("首次全对不额外入复习池，阶段包保留未核对项，修改阈值不追溯重算", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-stage-")));
  stores.push(store);
  const account = await new Auth(store).register("parent", "synthetic-password");
  if (!account) throw new Error("测试账号失败");
  const tasks = new Tasks(store),
    learning = new Learning(store);
  const batch = store.create(account.id, {
    entries: [
      { en: "sun", zh: "太阳" },
      { en: "moon", zh: "月亮" },
    ],
  });
  const input = {
    title: "听写",
    date: "2026-11-03",
    mode: "en2en",
    selections: [{ batchId: batch.id, entryIds: batch.entries.map((e) => e.id) }],
    reviewCount: 0,
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T04:00:00Z"));
  const task = tasks.create(account.id, input),
    attempt = tasks.start(account.id, task.id, false);
  tasks.save(account.id, attempt.id, {
    revision: 1,
    index: 1,
    phase: "review",
    results: { [task.items[0].wordId]: "correct" },
  });
  tasks.complete(account.id, attempt.id, 2, false);
  expect(learning.list(account.id)).toEqual([]);
  expect(
    learning.exam(account.id, "2026-11-03", "2026-11-03", "en2en").map((item) => item.entry.en),
  ).toEqual(["moon"]);
  learning.setPreferences(account.id, { masteryThreshold: 1 });
  expect(learning.list(account.id)).toEqual([]);
  expect(() => learning.setPreferences(account.id, { timezone: "invalid-timezone" })).toThrow();
});
