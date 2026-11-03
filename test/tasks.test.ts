import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { Auth } from "../apps/server/src/auth";
import { Store } from "../apps/server/src/store";
import { Tasks } from "../apps/server/src/tasks";
import { defaultSettings } from "../packages/contract/src/index";
import { selectRange } from "../packages/core/src/tasks";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
async function setup() {
  const store = new Store(mkdtempSync(join(tmpdir(), "dictation-tasks-")));
  stores.push(store);
  const auth = new Auth(store);
  const account = await auth.register("parent", "synthetic-password");
  if (!account) throw new Error("测试账号创建失败");
  const tasks = new Tasks(store);
  const batch = store.create(account.id, {
    title: "单元一",
    entries: [
      { en: "apple", zh: "苹果" },
      { en: "moon", zh: "月亮" },
      { en: "bank", zh: "银行" },
    ],
  });
  const input = {
    title: "今天作业",
    date: "2026-11-03",
    mode: "en2en",
    settings: { ...defaultSettings, auto: false },
    selections: [{ batchId: batch.id, entryIds: batch.entries.slice(1).map((e) => e.id) }],
  };
  return { store, account, auth, tasks, batch, input };
}

it("范围按编号选择，错误范围明确拒绝，不静默截断", () => {
  expect(selectRange(["a", "b", "c", "d"], "2-3,1")).toEqual(["a", "b", "c"]);
  expect(() => selectRange(["a"], "1-5")).toThrow("范围");
});
it("词条跨词表稳定复用，异义和修改内容不继承身份", async () => {
  const { store, account, batch } = await setup();
  const same = store.create(account.id, {
    title: "复用",
    entries: [
      { en: "apple", zh: "苹果" },
      { en: "bank", zh: "河岸" },
    ],
  });
  expect(same.entries[0].wordId).toBe(batch.entries[0].wordId);
  expect(same.entries[1].wordId).not.toBe(batch.entries[2].wordId);
  const changed = store.update(account.id, batch.id, {
    revision: 1,
    entries: [{ ...batch.entries[0], zh: "苹果公司" }],
  });
  expect(changed?.entries[0].wordId).not.toBe(batch.entries[0].wordId);
});
it("发布固定范围与原顺序，编辑词表不改变快照，其他账号不可读", async () => {
  const { store, account, tasks, batch, input } = await setup();
  const task = tasks.create(account.id, input);
  expect(task.items.map((item) => item.entry.en)).toEqual(["moon", "bank"]);
  store.update(account.id, batch.id, { revision: 1, entries: [{ en: "sun", zh: "太阳" }] });
  expect(tasks.get(account.id, task.id)?.items[0].entry.en).toBe("moon");
  expect(tasks.get("other-account", task.id)).toBeUndefined();
});
it("同任务只创建一个进行中会话，接力使用 revision，不覆盖陈旧进度", async () => {
  const { account, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  const attempt = tasks.start(account.id, task.id, false);
  expect(tasks.start(account.id, task.id, false).id).toBe(attempt.id);
  const next = tasks.save(account.id, attempt.id, {
    revision: attempt.revision,
    index: 1,
    phase: "player",
    results: {},
  });
  expect(next.index).toBe(1);
  expect(() =>
    tasks.save(account.id, attempt.id, {
      revision: attempt.revision,
      index: 0,
      phase: "player",
      results: {},
    }),
  ).toThrow("版本");
  expect(() =>
    tasks.save(account.id, attempt.id, {
      revision: next.revision,
      index: 99,
      phase: "player",
      results: {},
    }),
  ).toThrow();
});
it("播放投影不包含答案字段、词义或完整条目，接口仍按账号隔离", async () => {
  const { store, account, auth, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  const app = createApp(store, {});
  const headers = { Cookie: `dictation_session=${auth.createSession(account.id)}` };
  const response = await app.request(`/api/tasks/${task.id}/play`, { headers });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.task.items[0].audioText).toBe("moon");
  const json = JSON.stringify(data);
  for (const secret of ["月亮", "银行", '"answer"', '"entry"', '"alt"'])
    expect(json).not.toContain(secret);
  expect((await app.request(`/api/tasks/${task.id}/play`)).status).toBe(401);
});
it("任务开始前可改范围，开始后复制新任务，不覆盖旧快照", async () => {
  const { account, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  const changed = tasks.update(account.id, task.id, 1, { ...input, title: "修改任务" });
  expect(changed.revision).toBe(2);
  tasks.start(account.id, task.id, false);
  expect(() => tasks.update(account.id, task.id, 3, input)).toThrow("复制");
  const copy = tasks.create(account.id, {
    ...input,
    selections: [],
    wordIds: changed.items.map((item) => item.wordId),
  });
  expect(copy.id).not.toBe(task.id);
  expect(copy.items.map((item) => item.entry.en)).toEqual(["moon", "bank"]);
});
it("完成请求重复执行不写第二次结果，核对后不能回到未揭示答案的练习阶段", async () => {
  const { account, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  const attempt = tasks.start(account.id, task.id, false);
  const reviewing = tasks.save(account.id, attempt.id, {
    revision: 1,
    index: 1,
    phase: "review",
    results: {},
  });
  expect(() =>
    tasks.save(account.id, attempt.id, {
      revision: reviewing.revision,
      index: 0,
      phase: "player",
      results: {},
    }),
  ).toThrow("新建");
  const completed = tasks.complete(account.id, attempt.id, reviewing.revision, false);
  expect(Object.values(completed.results)).toEqual(["unchecked", "unchecked"]);
  expect(tasks.complete(account.id, attempt.id, reviewing.revision, true)).toEqual(completed);
});

it("任务状态机完整流转：单活互斥、设备租约接管、撤回中断、退回重做、重派与错词再派", async () => {
  const { account, tasks, batch, input } = await setup();
  const task1 = tasks.create(account.id, input);
  const task2 = tasks.create(account.id, { ...input, title: "第二份作业" });

  // 1. 单活进行中互斥
  const attempt1 = tasks.start(account.id, task1.id, false, "device-A", false);
  expect(attempt1.activeDeviceId).toBe("device-A");
  expect(() => tasks.start(account.id, task2.id, false, "device-A", false)).toThrow(
    "同一时间只能进行一份任务",
  );

  // 2. 设备租约心跳冲突与强制接管
  expect(() =>
    tasks.save(account.id, attempt1.id, {
      revision: attempt1.revision,
      index: 1,
      phase: "player",
      results: {},
      deviceId: "device-B",
      forceTakeover: false,
    }),
  ).toThrow("另一台设备");

  const takenOver = tasks.save(account.id, attempt1.id, {
    revision: attempt1.revision,
    index: 1,
    phase: "player",
    results: {},
    deviceId: "device-B",
    forceTakeover: true,
  });
  expect(takenOver.activeDeviceId).toBe("device-B");

  // 3. 进行中撤回保留部分进度并标记 interruptedAt，后续保存拒绝
  const withdrawn = tasks.withdraw(
    account.id,
    task1.id,
    tasks.require(account.id, task1.id).revision,
  );
  expect(withdrawn.status).toBe("withdrawn");
  expect(tasks.attempt(account.id, attempt1.id).interruptedAt).toBeTruthy();
  expect(() =>
    tasks.save(account.id, attempt1.id, {
      revision: takenOver.revision,
      index: 1,
      phase: "player",
      results: {},
      deviceId: "device-B",
    }),
  ).toThrow("撤回");

  // 4. 重派已撤回任务到今天
  const rescheduled = tasks.reschedule(account.id, task1.id);
  expect(rescheduled.status).toBe("pending");

  // 5. 交卷(submitted) -> 退回重做(in_progress) -> 再次交卷并批改完成 -> 错词再派发
  const attempt2 = tasks.start(account.id, task2.id, false, "device-A", false);
  const submitted = tasks.save(account.id, attempt2.id, {
    revision: attempt2.revision,
    index: 1,
    phase: "review",
    results: {},
    deviceId: "device-A",
  });
  expect(tasks.require(account.id, task2.id).status).toBe("submitted");

  const returned = tasks.returnForRedo(account.id, attempt2.id, submitted.revision);
  expect(returned.phase).toBe("player");
  expect(returned.index).toBe(0);
  expect(tasks.require(account.id, task2.id).status).toBe("in_progress");

  const resubmitted = tasks.save(account.id, attempt2.id, {
    revision: returned.revision,
    index: 1,
    phase: "review",
    results: {
      [task2.items[0].wordId]: "wrong",
      [task2.items[1].wordId]: "uncertain",
    },
    deviceId: "device-A",
  });
  tasks.complete(account.id, attempt2.id, resubmitted.revision, true);
  expect(tasks.require(account.id, task2.id).status).toBe("completed");

  const redispatched = tasks.redispatchWrong(account.id, attempt2.id);
  expect(redispatched.parentTaskId).toBe(task2.id);
  expect(redispatched.status).toBe("pending");
  expect(redispatched.items.map((item) => item.entry.en)).toEqual(["moon", "bank"]);
  expect(batch.entries).toHaveLength(3);
});

it("childToken 门禁、交卷前详情拦截、待考词界面提示与一键重置", async () => {
  const { store, account, auth, tasks, batch, input } = await setup();
  const task = tasks.create(account.id, input);
  const app = createApp(store, {});
  const parentHeaders = { Cookie: `dictation_session=${auth.createSession(account.id)}` };

  // 1. 获取并验证 childToken
  const tokenRes = await app.request("/api/child-token", {
    method: "POST",
    headers: parentHeaders,
  });
  expect(tokenRes.status).toBe(201);
  const childToken = await tokenRes.json();
  expect(childToken.token).toMatch(/^ct_/);

  const childHeaders = { "X-Child-Token": childToken.token, "User-Agent": "iPad Safari" };

  // 2. 白名单拦截一切家长端管理接口
  for (const [method, url] of [
    ["DELETE", `/api/batches/${batch.id}`],
    ["GET", `/api/tasks/${task.id}`],
    ["POST", "/api/tokens"],
    ["GET", "/api/preferences"],
    ["POST", `/api/tasks/${task.id}/withdraw`],
  ] as const) {
    const blocked = await app.request(url, { method, headers: childHeaders });
    expect(blocked.status).toBe(403);
  }

  // 3. 保留原文供设备朗读，待考词 ID 用于界面隐藏文字。
  const overviewRes = await app.request("/api/child/overview", { headers: childHeaders });
  expect(overviewRes.status).toBe(200);
  const overview = await overviewRes.json();
  expect(overview.tasks).toHaveLength(1);
  expect(overview.batches[0].lockedCount).toBe(2);

  const listenRes = await app.request(`/api/child/batches/${batch.id}/listen`, {
    headers: childHeaders,
  });
  expect(listenRes.status).toBe(200);
  const listenData = await listenRes.json();
  // batch.entries[0] ("apple") 不在任务中，允许展示；entries[1..2] ("moon", "bank") 在任务中，必须遮罩
  expect(listenData.lockedWordIds).toHaveLength(2);
  expect(listenData.batch.entries[0].en).toBe("apple");
  expect(listenData.batch.entries[1].en).toBe("moon");
  expect(listenData.batch.entries[1].zh).toBe("月亮");

  // 4. 孩子开始任务并交卷后，未开启 allowSelfReview 时禁止读取答案详情或自行完成核对
  const startRes = await app.request(`/api/tasks/${task.id}/start`, {
    method: "POST",
    headers: { ...childHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ onlyHomework: false, deviceId: "ipad-1", forceTakeover: false }),
  });
  expect(startRes.status).toBe(200);
  const { attempt } = await startRes.json();

  const detailBeforeComplete = await app.request(`/api/attempts/${attempt.id}`, {
    headers: childHeaders,
  });
  expect(detailBeforeComplete.status).toBe(403);

  const completeByChild = await app.request(`/api/attempts/${attempt.id}/complete`, {
    method: "POST",
    headers: { ...childHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ revision: attempt.revision, confirmRemaining: true }),
  });
  expect(completeByChild.status).toBe(403);

  // 5. 家长一键重置链接后，旧 childToken 立即失效
  const rotateRes = await app.request("/api/child-token/rotate", {
    method: "POST",
    headers: parentHeaders,
  });
  expect(rotateRes.status).toBe(200);
  const expiredRes = await app.request("/api/child/overview", { headers: childHeaders });
  expect(expiredRes.status).toBe(401);
});

it("退回不产生两个进行中任务，继续补写保留位置并清除旧批改，完成后不能重开原任务", async () => {
  const { account, tasks, input } = await setup();
  const task = tasks.create(account.id, input);
  const attempt = tasks.start(account.id, task.id, false);
  expect(() => tasks.returnForRedo(account.id, attempt.id, attempt.revision)).toThrow("待批改");
  const submitted = tasks.save(account.id, attempt.id, {
    revision: attempt.revision,
    index: 1,
    phase: "review",
    results: { [task.items[0].wordId]: "wrong" },
  });
  expect(() => tasks.start(account.id, task.id, false)).toThrow("已交卷");
  const other = tasks.create(account.id, input);
  tasks.start(account.id, other.id, false);
  expect(() => tasks.returnForRedo(account.id, attempt.id, submitted.revision, false)).toThrow(
    "请先完成",
  );
  expect(tasks.require(account.id, task.id).status).toBe("submitted");
  tasks.withdraw(account.id, other.id);
  const returned = tasks.returnForRedo(account.id, attempt.id, submitted.revision, false);
  expect(returned.index).toBe(1);
  expect(returned.results).toEqual({});
  const resubmitted = tasks.save(account.id, attempt.id, {
    revision: returned.revision,
    index: 1,
    phase: "review",
    results: { [task.items[0].wordId]: "unchecked" },
  });
  const completed = tasks.complete(account.id, attempt.id, resubmitted.revision, true);
  expect(Object.values(completed.results)).toEqual(["correct", "correct"]);
  expect(() => tasks.start(account.id, task.id, false)).toThrow("复制新任务");
  expect(tasks.require(account.id, task.id).status).toBe("completed");
  expect(tasks.attempt(account.id, attempt.id)).toEqual(completed);
});

it("孩子自评抽查从正确项中选择，最多两项且不重复", async () => {
  const { account, tasks, input, batch } = await setup();
  const task = tasks.create(account.id, {
    ...input,
    allowSelfReview: true,
    selections: [{ batchId: batch.id, entryIds: batch.entries.map((entry) => entry.id) }],
  });
  const attempt = tasks.start(account.id, task.id, false);
  const submitted = tasks.save(account.id, attempt.id, {
    revision: attempt.revision,
    index: 2,
    phase: "review",
    results: {},
  });
  const completed = tasks.complete(account.id, attempt.id, submitted.revision, true, true);
  expect(completed.spotCheckWordIds).toHaveLength(2);
  expect(new Set(completed.spotCheckWordIds).size).toBe(2);
  for (const wordId of completed.spotCheckWordIds)
    expect(completed.results[wordId]).toBe("correct");
});
