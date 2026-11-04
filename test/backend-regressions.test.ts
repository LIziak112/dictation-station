import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Auth } from "../apps/server/src/auth";
import { Learning } from "../apps/server/src/learning";
import { accounts, metadata, tasks as taskTable } from "../apps/server/src/schema";
import { Store } from "../apps/server/src/store";
import { Tasks } from "../apps/server/src/tasks";
import { Tokens } from "../apps/server/src/tokens";
import type { Attempt } from "../packages/contract/src/index";

const stores: Store[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
});
async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:00:00Z"));
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-regression-")));
  stores.push(store);
  const auth = new Auth(store);
  const account = await auth.register("parent", "synthetic-password");
  if (!account) throw new Error("测试账号失败");
  const tasks = new Tasks(store),
    learning = new Learning(store);
  const batch = store.create(account.id, {
    entries: [
      { en: "sun", zh: "太阳" },
      { en: "moon", zh: "月亮" },
      { en: "star", zh: "星星" },
      { en: "sky", zh: "天空" },
    ],
  });
  const input = {
    title: "听写",
    date: "2026-11-01",
    mode: "en2en",
    reviewCount: 0,
    selections: [{ batchId: batch.id, entryIds: [batch.entries[0].id] }],
  };
  function submit(day: string, result: "correct" | "wrong" | "unchecked" = "correct") {
    vi.setSystemTime(new Date(`${day}T04:00:00Z`));
    const task = tasks.create(account.id, { ...input, date: day });
    const started = tasks.start(account.id, task.id, false, "device-A");
    return tasks.save(account.id, started.id, {
      revision: started.revision,
      index: 0,
      phase: "review",
      results: { [task.items[0].wordId]: result },
      deviceId: "device-A",
    });
  }
  const complete = (attempt: Attempt) =>
    tasks.complete(account.id, attempt.id, attempt.revision, false);
  return { store, auth, account, tasks, learning, batch, input, submit, complete };
}

it("同日练习分日批改只计一次，不同日练习集中批改分别累计", async () => {
  const { account, learning, submit, complete } = await setup();
  complete(submit("2026-11-01", "wrong"));
  const first = submit("2026-11-02"),
    second = submit("2026-11-02");
  vi.setSystemTime(new Date("2026-11-03T04:00:00Z"));
  complete(first);
  vi.setSystemTime(new Date("2026-11-04T04:00:00Z"));
  complete(second);
  expect(learning.list(account.id)[0].state.streak).toBe(1);
  const third = submit("2026-11-03"),
    fourth = submit("2026-11-04");
  vi.setSystemTime(new Date("2026-11-05T04:00:00Z"));
  complete(fourth);
  complete(third);
  expect(learning.list(account.id)[0].state).toMatchObject({
    streak: 3,
    status: "mastered",
    lastQualifiedDate: "2026-11-04",
  });
});

it("倒序补批及同日迟批的错词不会产生额外通过", async () => {
  const { account, learning, submit, complete } = await setup();
  complete(submit("2026-11-01", "wrong"));
  const correct = submit("2026-11-02"),
    wrong = submit("2026-11-03", "wrong"),
    later = submit("2026-11-04");
  const sameDayWrong = submit("2026-11-04", "wrong");
  complete(later);
  complete(wrong);
  complete(correct);
  expect(learning.list(account.id)[0].state).toMatchObject({
    streak: 1,
    lastWrongDate: "2026-11-03",
  });
  complete(sameDayWrong);
  expect(learning.list(account.id)[0].state).toMatchObject({
    streak: 0,
    lastWrongDate: "2026-11-04",
  });
});

it("跨午夜交卷固化账号日期，改时区及延迟批改不改变阶段包和周报归属", async () => {
  const { account, tasks, learning, input } = await setup();
  vi.setSystemTime(new Date("2026-11-01T15:59:00Z"));
  const task = tasks.create(account.id, input);
  const start = tasks.start(account.id, task.id, false, "device-A");
  vi.setSystemTime(new Date("2026-11-01T16:01:00Z"));
  const submitted = tasks.save(account.id, start.id, {
    revision: 1,
    index: 0,
    phase: "review",
    results: { [task.items[0].wordId]: "wrong" },
    deviceId: "device-A",
  });
  expect(submitted.practiceDate).toBe("2026-11-02");
  expect(submitted.submission?.at).toBe("2026-11-01T16:01:00.000Z");
  learning.setPreferences(account.id, { timezone: "UTC" });
  vi.setSystemTime(new Date("2026-11-09T04:00:00Z"));
  tasks.complete(account.id, start.id, submitted.revision, false);
  expect(learning.exam(account.id, "2026-11-02", "2026-11-02", "en2en")).toHaveLength(1);
  expect(learning.exam(account.id, "2026-11-09", "2026-11-09", "en2en")).toHaveLength(0);
  expect(learning.weekly(account.id).completed).toBe(0);
  expect(learning.list(account.id)[0].state.lastPracticedAt).toBe(submitted.submission?.at);
});

it("重放保留当次批改的阈值，手动掌握优先于之前已交卷的补批", async () => {
  const { account, learning, submit, complete } = await setup();
  complete(submit("2026-11-01", "wrong"));
  complete(submit("2026-11-02"));
  learning.setPreferences(account.id, { masteryThreshold: 1 });
  complete(submit("2026-11-03", "unchecked"));
  const wordId = learning.list(account.id)[0].state.wordId;
  expect(learning.list(account.id)[0].state).toMatchObject({ streak: 1, status: "pending" });
  const late = submit("2026-11-04", "wrong");
  learning.manual(account.id, wordId, "en2en", "mastered");
  complete(late);
  expect(learning.list(account.id)[0].state.status).toBe("mastered");
  complete(submit("2026-11-05", "wrong"));
  expect(learning.list(account.id)[0].state.status).toBe("pending");
  learning.manual(account.id, wordId, "en2en", "pending");
  complete(submit("2026-11-06"));
  expect(learning.list(account.id)[0].state.status).toBe("mastered");
});

it("旧学习状态作为基线保留，不会因缺少练习日期而被清空或重算", async () => {
  const { store, account, learning, tasks, submit, complete } = await setup();
  const old = complete(submit("2026-11-01", "wrong"));
  store.db
    .delete(metadata)
    .where(
      eq(metadata.key, `learning-checkpoint:${account.id}:${Object.keys(old.results)[0]}:en2en`),
    )
    .run();
  tasks.writeAttempt(account.id, { ...old, practiceDate: undefined, submission: undefined });
  complete(submit("2026-11-02"));
  expect(learning.list(account.id)[0].state).toMatchObject({
    streak: 1,
    lastWrongDate: "2026-11-01",
  });
});

it("手动掌握后退回同一任务重做，新交卷仍可使错词重新入池", async () => {
  const { account, tasks, learning, submit, complete } = await setup();
  complete(submit("2026-11-01", "wrong"));
  const old = submit("2026-11-02", "wrong");
  const wordId = Object.keys(old.results)[0];
  learning.manual(account.id, wordId, "en2en", "mastered");
  const returned = tasks.returnForRedo(account.id, old.id, old.revision);
  vi.setSystemTime(new Date("2026-11-03T04:00:00Z"));
  const next = tasks.save(account.id, old.id, {
    revision: returned.revision,
    index: 0,
    phase: "review",
    results: { [wordId]: "wrong" },
    deviceId: "device-A",
  });
  complete(next);
  expect(learning.list(account.id)[0].state).toMatchObject({
    status: "pending",
    lastWrongDate: "2026-11-03",
  });
});

it("改密撤销旧会话和 PIN，旧孩子链接不能重建家长会话，新密码可重新绑定", async () => {
  const { store, auth, account } = await setup();
  const deviceId = "a".repeat(32);
  const session = auth.createSession(account.id);
  const token = new Tokens(store).createChildToken(account.id).token;
  await auth.setDevicePin(account.id, deviceId, "2468");
  await auth.changePassword(account.id, "synthetic-password", "replacement-password");
  expect(auth.current(session)).toBeUndefined();
  const app = createApp(store, {});
  const res = await app.request("/api/auth/unlock-pin", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Child-Token": token },
    body: JSON.stringify({ deviceId, pin: "2468" }),
  });
  expect(res.status).toBe(409);
  expect(res.headers.get("set-cookie")).not.toContain("dictation_session=");
  expect(await auth.login("parent", "replacement-password")).toBeTruthy();
  await auth.setDevicePin(account.id, deviceId, "1357");
  const unlocked = await auth.unlockDevicePin(account.id, deviceId, "1357");
  expect(typeof unlocked).toBe("string");
});

it("PIN 验证和设置过程中撤销授权，异步回执不能恢复旧授权", async () => {
  const { store, auth, account } = await setup();
  const deviceId = "a".repeat(32);
  await auth.setDevicePin(account.id, deviceId, "2468");
  const pending = auth.unlockDevicePin(account.id, deviceId, "2468");
  store.db
    .delete(metadata)
    .where(eq(metadata.key, `parent-pin:${account.id}:${deviceId}`))
    .run();
  expect(await pending).toBeNull();
  const setting = auth.setDevicePin(account.id, deviceId, "1357");
  store.db
    .update(accounts)
    .set({ passwordHash: "changed-by-reset" })
    .where(eq(accounts.id, account.id))
    .run();
  await expect(setting).rejects.toThrow("密码已变化");
  expect(await auth.unlockDevicePin(account.id, deviceId, "1357")).toBeNull();
});

it("直接启动过期任务被拒绝且过期状态落库，只记一次日志，重派后可启动", async () => {
  const { store, account, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  vi.setSystemTime(new Date("2026-11-04T04:00:00Z"));
  expect(() => tasks.start(account.id, task.id, false, "device-A")).toThrow("过期");
  const raw = store.db.select().from(taskTable).where(eq(taskTable.id, task.id)).get();
  expect(JSON.parse(raw?.payload ?? "{}").status).toBe("expired");
  tasks.get(account.id, task.id);
  tasks.list(account.id);
  expect(store.listAudit(account.id).filter((log) => log.action === "task.expired")).toHaveLength(
    1,
  );
  tasks.reschedule(account.id, task.id);
  expect(tasks.start(account.id, task.id, false, "device-A").phase).toBe("player");
});

it("接管递增版本，旧设备、缺失设备标识或旧版本不能覆盖进度", async () => {
  const { account, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  const old = tasks.start(account.id, task.id, false, "device-A");
  const next = tasks.start(account.id, task.id, false, "device-B", true);
  expect(next.revision).toBe(old.revision + 1);
  const payload = { revision: old.revision, index: 0, phase: "player", results: {} };
  expect(() => tasks.save(account.id, old.id, payload)).toThrow("版本");
  expect(() => tasks.save(account.id, old.id, { ...payload, revision: next.revision })).toThrow(
    "设备标识",
  );
  expect(() =>
    tasks.save(account.id, old.id, { ...payload, revision: next.revision, deviceId: "device-A" }),
  ).toThrow("另一台设备");
  expect(
    tasks.save(account.id, old.id, { ...payload, revision: next.revision, deviceId: "device-B" })
      .revision,
  ).toBe(next.revision + 1);
});

it("订正仅接受错词与不确定项，保持幂等，80 字任务可重派", async () => {
  const { account, tasks, input, batch } = await setup();
  const task = tasks.create(account.id, {
    ...input,
    title: "长".repeat(80),
    selections: [{ batchId: batch.id, entryIds: batch.entries.map((entry) => entry.id) }],
  });
  const start = tasks.start(account.id, task.id, false, "device-A");
  const results = Object.fromEntries(
    task.items.map((item, i) => [item.wordId, ["wrong", "uncertain", "correct", "unchecked"][i]]),
  );
  const submitted = tasks.save(account.id, start.id, {
    revision: 1,
    index: 3,
    phase: "review",
    results,
    deviceId: "device-A",
  });
  const completed = tasks.complete(account.id, start.id, submitted.revision, false);
  for (const item of task.items.slice(2))
    expect(() => tasks.correct(account.id, start.id, completed.revision, [item.wordId])).toThrow(
      "只能标记",
    );
  const ids = task.items.slice(0, 2).map((item) => item.wordId);
  const corrected = tasks.correct(account.id, start.id, completed.revision, ids);
  expect(tasks.correct(account.id, start.id, completed.revision, ids)).toEqual(corrected);
  const copy = tasks.redispatchWrong(account.id, start.id);
  expect(copy.title.length).toBeLessThanOrEqual(80);
  expect(copy.parentTaskId).toBe(task.id);
  expect(copy.items.map((item) => item.wordId)).toEqual(ids);
});

it("超过 15 条历史时所有未订正记录仍可见，已订正历史只保留最近 15 条", async () => {
  const { account, tasks, submit, complete } = await setup();
  const pendingIds: string[] = [];
  for (let i = 0; i < 33; i++) {
    const completed = complete(submit("2026-11-01", "wrong"));
    if (i < 17) pendingIds.push(completed.id);
    else
      tasks.correct(account.id, completed.id, completed.revision, Object.keys(completed.results));
  }
  const overview = tasks.childOverview(account.id);
  expect(
    overview.corrections
      .slice(0, 17)
      .map((item) => item.attemptId)
      .sort(),
  ).toEqual(pendingIds.sort());
  expect(overview.corrections).toHaveLength(32);
  expect(
    overview.corrections.reduce(
      (n, item) => n + item.words.filter((word) => !word.corrected).length,
      0,
    ),
  ).toBe(17);
});
