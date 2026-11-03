import {
  CalendarCheck,
  CheckCircle2,
  Headphones,
  History,
  Mic,
  RotateCcw,
  Send,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type AuditLogItem,
  type ChildOverview,
  type Entry,
  MODES,
  type TaskSummary,
  voiceResponseSchema,
} from "../../../packages/contract/src/index";
import { loadAudio } from "./AudioPreparation";
import { request } from "./api";
import { BrowserAudio } from "./audio";
import { taskApi } from "./task-api";

const STATUS_LABELS: Record<TaskSummary["status"], string> = {
  pending: "待完成",
  in_progress: "进行中",
  submitted: "待批改",
  completed: "已完成",
  withdrawn: "已撤回",
  expired: "已过期",
};

type ChildTab = "today" | "listen" | "history";

export function Today({
  child,
  onOpen,
  onPrint,
  onReview,
  onCreate,
  onLibrary,
  onShareChild,
  onChildPractice,
}: {
  child: boolean;
  onOpen: (id: string) => void;
  onPrint?: (id: string) => void;
  onReview?: (attemptId: string) => void;
  onCreate: () => void;
  onLibrary: () => void;
  onShareChild?: (id: string) => void;
  onChildPractice?: (batchId: string, follow: boolean) => void;
}) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [overview, setOverview] = useState<ChildOverview | null>(null);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [tab, setTab] = useState<ChildTab>(() => {
    try {
      const saved = sessionStorage.getItem("ownclass:child-tab");
      return saved === "listen" || saved === "history" ? saved : "today";
    } catch {
      return "today";
    }
  });
  function switchTab(next: ChildTab) {
    setTab(next);
    try {
      sessionStorage.setItem("ownclass:child-tab", next);
    } catch {
      /* 忽略存储异常 */
    }
  }
  const refreshNow = useRef<() => void>(() => {});
  const audioRef = useRef<BrowserAudio | null>(null);

  useEffect(() => {
    audioRef.current = new BrowserAudio("us");
    return () => audioRef.current?.dispose();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.hidden) return;
      taskApi
        .list(controller.signal)
        .then((result) => {
          setTasks(result.tasks);
          setMessage("");
        })
        .catch((e: Error) => {
          if (!controller.signal.aborted) setMessage(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      if (child) {
        taskApi
          .childOverview(controller.signal)
          .then(setOverview)
          .catch(() => {});
      } else {
        taskApi
          .auditLogs(controller.signal)
          .then((res) => setLogs(res.logs))
          .catch(() => {});
      }
    };
    refreshNow.current = refresh;
    refresh();
    const timer = setInterval(refresh, 10000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [child]);

  useEffect(() => {
    if (child) {
      const activeCount = tasks.filter(
        (t) => t.status === "pending" || t.status === "in_progress",
      ).length;
      document.title = `${activeCount > 0 ? `(${activeCount} 待听写) ` : ""}孩子听写区 · 听写小站 · OwnClass`;
    } else {
      const submittedCount = tasks.filter((t) => t.status === "submitted").length;
      document.title = `${submittedCount > 0 ? `(${submittedCount} 待批改) ` : ""}今日任务 · 听写小站 · OwnClass`;
    }
  }, [tasks, child]);

  async function speakWord(entry: Entry) {
    const lang: "en" | "zh" = entry.en ? "en" : "zh";
    const text = entry[lang];
    if (!text) return;
    try {
      const { voice } = await request("api/pronunciation/preview", voiceResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          wordId: entry.wordId,
          text,
          lang,
          accent: "us",
          reading: entry.readings[lang] || entry.reading,
          pinyin: lang === "zh" ? entry.pinyin : undefined,
        }),
      });
      if (voice.url) {
        const blob = await loadAudio(voice.url);
        audioRef.current?.cache(text, lang, blob, entry.id);
      }
      await audioRef.current?.speak(text, lang, 1, entry.id);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "发音播放失败");
    }
  }

  async function handleWithdraw(task: TaskSummary) {
    const confirmText =
      task.status === "in_progress"
        ? `孩子已听写到第 ${(task.progressIndex ?? 0) + 1}/${task.count} 项。撤回后孩子端将在刷新或同步时停止，进度会留档。确定撤回吗？`
        : `确定撤回任务「${task.title}」吗？撤回后将从孩子待办列表中移除。`;
    if (!confirm(confirmText)) return;
    setBusyId(task.id);
    try {
      await taskApi.withdraw(task.id, task.revision);
      setNotice(`已撤回任务「${task.title}」`);
      refreshNow.current();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "撤回失败");
    } finally {
      setBusyId("");
    }
  }

  async function handleReschedule(task: TaskSummary) {
    setBusyId(task.id);
    try {
      await taskApi.reschedule(task.id);
      setNotice(`已将「${task.title}」重新派发到今日待办`);
      refreshNow.current();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "重派失败");
    } finally {
      setBusyId("");
    }
  }

  async function handleRedispatchWrong(task: TaskSummary) {
    if (!task.activeAttemptId) return;
    setBusyId(task.id);
    try {
      const { task: created } = await taskApi.redispatchWrong(task.activeAttemptId);
      setNotice(`已生成错词复练任务「${created.title}」并派发到孩子听写区`);
      refreshNow.current();
      onShareChild?.(created.id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "错词重派失败");
    } finally {
      setBusyId("");
    }
  }

  const hasActiveTask = tasks.some((t) => t.status === "in_progress");
  const submittedTasks = tasks.filter((t) => t.status === "submitted");
  const archivedStatuses = ["completed", "withdrawn", "expired"];
  const archivedTasks = tasks.filter((task) => archivedStatuses.includes(task.status));
  const statusOrder = child
    ? { in_progress: 0, pending: 1, submitted: 2, completed: 3, withdrawn: 4, expired: 5 }
    : { submitted: 0, in_progress: 1, pending: 2, completed: 3, withdrawn: 4, expired: 5 };
  const visibleTasks = tasks
    .filter((task) => !child || !archivedStatuses.includes(task.status))
    .sort((a, b) =>
      child
        ? statusOrder[a.status] - statusOrder[b.status] || a.createdAt.localeCompare(b.createdAt)
        : b.date.localeCompare(a.date) ||
          statusOrder[a.status] - statusOrder[b.status] ||
          b.createdAt.localeCompare(a.createdAt),
    );

  const historyTasks = [...archivedTasks].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
  const pendingCorrections =
    overview?.corrections.reduce((n, c) => n + c.words.filter((w) => !w.corrected).length, 0) ?? 0;
  const showToday = !child || tab === "today";

  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{child ? "孩子听写区" : "家长工作台"}</p>
          <h1>{child ? "今天练一点" : "今日任务"}</h1>
          <p>
            {child
              ? "选一份任务，跟着声音慢慢写，写完交给家长批改。"
              : "安排听写，查看进度，收到听写纸后批改。"}
          </p>
        </div>
        {!child && (
          <div className="row">
            <button
              className={submittedTasks.length > 0 ? undefined : "primary"}
              type="button"
              onClick={onCreate}
            >
              安排任务
            </button>
            <button type="button" onClick={onLibrary}>
              从词库派发
            </button>
          </div>
        )}
      </div>
      {child && (
        <div className="child-tabs" role="tablist" aria-label="孩子区分区">
          {(
            [
              ["today", "今天", CalendarCheck, pendingCorrections],
              ["listen", "磨耳朵", Headphones, 0],
              ["history", "历史", History, 0],
            ] as const
          ).map(([key, label, Icon, badge]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => switchTab(key)}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
              {badge > 0 && <span className="tab-badge">{badge}</span>}
            </button>
          ))}
        </div>
      )}
      {notice && (
        <div className="notice">
          <p role="status">{notice}</p>
          <button type="button" className="subtle" onClick={() => setNotice("")}>
            关闭
          </button>
        </div>
      )}
      {message && (
        <div className="notice error">
          <p role="alert">任务未能更新：{message}。请检查连接后重试。</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              refreshNow.current();
            }}
          >
            重新读取任务
          </button>
        </div>
      )}
      <p role="status">{loading ? "正在读取任务…" : ""}</p>
      {!child && submittedTasks.length > 0 && (
        <section className="panel review-alert-banner" aria-label="待批改任务提醒">
          <div className="review-alert-header">
            <p className="eyebrow">孩子已交卷 · 待家长核对</p>
            <h2>待批改的听写</h2>
          </div>
          <ul className="review-alert-list">
            {submittedTasks.map((task) => (
              <li className="review-alert-item" key={task.id}>
                <div className="review-alert-task">
                  <strong>{task.title}</strong>
                  <span>
                    {task.date} · {task.count} 项
                  </span>
                </div>
                <button
                  type="button"
                  className="primary"
                  aria-label={`立即批改 ${task.title}`}
                  onClick={() => {
                    if (task.activeAttemptId && onReview) onReview(task.activeAttemptId);
                    else onOpen(task.id);
                  }}
                >
                  立即批改
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {showToday && !loading && !message && !visibleTasks.length && (
        <section className="panel empty">
          <h2>{child && tasks.length ? "今天的任务都完成了" : "还没有安排任务"}</h2>
          <p>
            {child
              ? tasks.length
                ? "做得好！可以去「磨耳朵」听一听，或在「历史」里回看。"
                : "请家长准备今天的内容。"
              : "从自己的词表选择今天要听的范围，派发到孩子听写区。"}
          </p>
          {!child && (
            <button type="button" onClick={onLibrary}>
              打开词库
            </button>
          )}
        </section>
      )}
      {showToday && !!visibleTasks.length && (
        <section aria-label={child ? "今日待听写任务" : "任务列表"}>
          {child && (
            <div className="section-head">
              <h2>今日听写任务</h2>
              <p className="small muted">同一时间只能进行一份听写，其余任务自动排队。</p>
            </div>
          )}
          <div className={child ? "batch-grid" : "task-timeline"}>
            {visibleTasks.map((task, index) => {
              const statusLabel = STATUS_LABELS[task.status] ?? "待完成";
              const queuedBehindActive = child && task.status === "pending" && hasActiveTask;
              return (
                <div className={child ? undefined : "timeline-entry"} key={task.id}>
                  {!child && (index === 0 || visibleTasks[index - 1].date !== task.date) && (
                    <div className="timeline-date">{task.date}</div>
                  )}
                  <article className="panel task-card" data-status={task.status}>
                    <div className="row between task-card-top">
                      <p className="eyebrow">{task.date}</p>
                      <span className={`status-pill status-${task.status}`}>{statusLabel}</span>
                    </div>
                    <h2>{task.title}</h2>
                    <p className="task-meta">
                      {task.count - task.reviewCount} 项作业
                      {task.reviewCount ? ` + ${task.reviewCount} 项复习` : ""} ·{" "}
                      {MODES[task.mode].label}
                    </p>
                    {task.status === "in_progress" && task.progressIndex !== undefined && (
                      <p className="small">
                        当前进度：第 {task.progressIndex + 1} / {task.count} 项
                      </p>
                    )}
                    {task.status === "completed" && task.wrongCount !== undefined && (
                      <p className="small muted">
                        {task.wrongCount > 0
                          ? `待巩固错词 ${task.wrongCount} 项（${task.uncorrectedCount ? `待订正 ${task.uncorrectedCount} 项` : "已全部订正"}）`
                          : "暂无待巩固项，核对情况见记录"}
                      </p>
                    )}
                    {!child && task.spotCheckWords && task.spotCheckWords.length > 0 && (
                      <p className="small muted">
                        孩子已自主核对 · 建议抽查：{task.spotCheckWords.join("、")}
                      </p>
                    )}
                    {queuedBehindActive ? (
                      <p className="small muted">排队中：请先完成上方正在进行的听写任务</p>
                    ) : (
                      <p className="small muted">
                        约{" "}
                        {Math.max(
                          1,
                          Math.ceil(
                            (task.count *
                              (task.settings.repeat * 2 +
                                task.settings.interval +
                                (task.settings.auto ? 0 : 8))) /
                              60,
                          ),
                        )}{" "}
                        分钟 · 按自己的速度来
                      </p>
                    )}
                    <div className="row task-card-actions">
                      {!child ? (
                        task.status === "expired" || task.status === "withdrawn" ? (
                          <button
                            type="button"
                            disabled={busyId === task.id}
                            onClick={() => void handleReschedule(task)}
                          >
                            <RotateCcw size={15} aria-hidden="true" />
                            重派到今天
                          </button>
                        ) : task.status === "submitted" ? (
                          <>
                            {task.activeAttemptId && onReview && (
                              <button
                                type="button"
                                onClick={() => onReview(task.activeAttemptId as string)}
                              >
                                立即批改
                              </button>
                            )}
                            <button
                              type="button"
                              className="subtle"
                              onClick={() => onPrint?.(task.id)}
                            >
                              打印纸
                            </button>
                          </>
                        ) : task.status === "completed" ? (
                          <>
                            {task.activeAttemptId && onReview && (
                              <button
                                type="button"
                                onClick={() => onReview(task.activeAttemptId as string)}
                              >
                                查看核对记录
                              </button>
                            )}
                            <button
                              type="button"
                              className="subtle"
                              onClick={() => onPrint?.(task.id)}
                            >
                              打印纸
                            </button>
                            {(task.wrongCount ?? 0) > 0 && task.activeAttemptId && (
                              <button
                                type="button"
                                disabled={busyId === task.id}
                                onClick={() => void handleRedispatchWrong(task)}
                              >
                                <Send size={14} aria-hidden="true" />
                                错词再派发一次（{task.wrongCount}）
                              </button>
                            )}
                          </>
                        ) : task.status === "in_progress" ? (
                          <>
                            <button
                              type="button"
                              className="primary"
                              onClick={() => onOpen(task.id)}
                            >
                              监控进度
                            </button>
                            <button
                              type="button"
                              className="subtle"
                              onClick={() => onPrint?.(task.id)}
                            >
                              打印纸
                            </button>
                            <button
                              type="button"
                              className="danger subtle"
                              disabled={busyId === task.id}
                              onClick={() => void handleWithdraw(task)}
                            >
                              撤回任务
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => onOpen(task.id)}>
                              查看任务
                            </button>
                            <button
                              type="button"
                              className="subtle"
                              onClick={() => onPrint?.(task.id)}
                            >
                              打印纸
                            </button>
                            <button
                              type="button"
                              className="danger subtle"
                              disabled={busyId === task.id}
                              onClick={() => void handleWithdraw(task)}
                            >
                              撤回任务
                            </button>
                          </>
                        )
                      ) : task.status === "expired" ||
                        task.status === "withdrawn" ? null : task.status === "submitted" ? (
                        <>
                          {task.allowSelfReview && task.activeAttemptId && onReview ? (
                            <button
                              type="button"
                              className="primary"
                              onClick={() => onReview(task.activeAttemptId as string)}
                            >
                              自主核对答案
                            </button>
                          ) : null}
                          <button type="button" onClick={() => onOpen(task.id)}>
                            查看任务
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={queuedBehindActive}
                          className={task.status === "completed" ? undefined : "primary"}
                          onClick={() =>
                            task.status === "completed" && task.activeAttemptId && onReview
                              ? onReview(task.activeAttemptId)
                              : onOpen(task.id)
                          }
                        >
                          {task.status === "completed"
                            ? "查看核对记录"
                            : task.status === "pending"
                              ? "准备开始"
                              : "继续任务"}
                        </button>
                      )}
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {child && overview && (
        <>
          {tab === "today" && (
            <section className="panel" aria-labelledby="child-corrections-heading">
              <div className="section-head">
                <h2 id="child-corrections-heading">错词订正</h2>
                <p className="small muted">
                  先在纸上订正，再点“我已订正”。以后再独立听写，逐步巩固。
                </p>
              </div>
              {!overview.corrections.length ? (
                <p className="small muted">目前没有待订正的错词，继续保持！</p>
              ) : (
                <div className="editor-stack">
                  {overview.corrections.map((item) => (
                    <article key={item.attemptId} className="task-source">
                      <div className="row between">
                        <strong>
                          {item.taskTitle}（{item.taskDate} · {MODES[item.mode].label}）
                        </strong>
                        <span className="status-pill status-completed">
                          答对 {item.correctCount}/{item.totalCount} · 待订正{" "}
                          {item.words.filter((w) => !w.corrected).length} 项
                        </span>
                      </div>
                      <div className="learning-table">
                        {item.words.map((word) => (
                          <div key={word.wordId} className="learning-row correction-row">
                            <div className="learning-word">
                              <strong>{word.entry.en || word.entry.zh}</strong>
                              <span className="muted">
                                {word.entry.en ? word.entry.zh : word.entry.pinyin}
                              </span>
                              {word.entry.en && word.entry.pinyin && (
                                <span className="small muted">{word.entry.pinyin}</span>
                              )}
                            </div>
                            <div className="learning-meta">
                              <span className="voice-badge voice-human">
                                {word.result === "wrong" ? "未通过" : "待巩固"}
                              </span>
                            </div>
                            <div className="row correction-actions">
                              <button
                                type="button"
                                className="subtle icon-btn"
                                onClick={() => void speakWord(word.entry)}
                              >
                                <Volume2 size={14} aria-hidden="true" />
                                听发音
                              </button>
                              <button
                                type="button"
                                disabled={
                                  word.corrected || busyId === `${item.attemptId}:${word.wordId}`
                                }
                                onClick={async () => {
                                  setBusyId(`${item.attemptId}:${word.wordId}`);
                                  try {
                                    await taskApi.correct(item.attemptId, item.attemptRevision, [
                                      word.wordId,
                                    ]);
                                    const nextOverview = await taskApi.childOverview();
                                    setOverview(nextOverview);
                                  } catch (e) {
                                    setMessage(e instanceof Error ? e.message : "订正保存失败");
                                  } finally {
                                    setBusyId("");
                                  }
                                }}
                              >
                                <CheckCircle2 size={14} aria-hidden="true" />
                                {word.corrected ? "已订正" : "我已订正"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === "listen" && (
            <section className="panel" aria-labelledby="child-listen-heading">
              <div className="section-head">
                <h2 id="child-listen-heading">自主磨耳朵</h2>
                <p className="small muted">
                  听示范，也可以录音跟读。这些练习不计入掌握次数，待考词暂时隐藏文字。
                </p>
              </div>
              {!overview.batches.length ? (
                <p className="small muted">词库中还没有词表。</p>
              ) : (
                <div className="batch-grid">
                  {overview.batches.map((b) => (
                    <article key={b.id} className="panel task-card">
                      <div className="row between task-card-top">
                        <p className="eyebrow">
                          {b.count} 词 ·{" "}
                          {[b.grade, b.unit].filter(Boolean).join(" · ") || "自主练习"}
                        </p>
                        {b.lockedCount > 0 && (
                          <span className="status-pill status-in_progress">
                            🔒 {b.lockedCount} 词盲听保护
                          </span>
                        )}
                      </div>
                      <h3>{b.title}</h3>
                      <div className="row task-card-actions">
                        <button type="button" onClick={() => onChildPractice?.(b.id, false)}>
                          <Headphones size={15} aria-hidden="true" />
                          纯听磨耳朵
                        </button>
                        <button type="button" onClick={() => onChildPractice?.(b.id, true)}>
                          <Mic size={15} aria-hidden="true" />
                          跟读练口语
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
      {child && tab === "history" && (
        <section className="panel" aria-labelledby="child-history-heading">
          <div className="section-head">
            <h2 id="child-history-heading">听写历史</h2>
            <p className="small muted">做过的听写都在这里，点开可以回看批改结果。</p>
          </div>
          {!historyTasks.length ? (
            <p className="small muted">还没有完成的听写。</p>
          ) : (
            <ul className="history-list">
              {historyTasks.map((task) => (
                <li key={task.id}>
                  <span className="history-icon" aria-hidden="true">
                    <History size={20} />
                  </span>
                  <div className="history-main">
                    <strong>{task.title}</strong>
                    <span className="small muted">
                      {task.date} · {MODES[task.mode].label} · {task.count} 项
                    </span>
                  </div>
                  {task.status === "completed" && task.wrongCount !== undefined ? (
                    <span className={task.wrongCount ? "history-score has-wrong" : "history-score"}>
                      {task.wrongCount ? `错 ${task.wrongCount}` : "全对"}
                    </span>
                  ) : (
                    <span className={`status-pill status-${task.status}`}>
                      {STATUS_LABELS[task.status]}
                    </span>
                  )}
                  {task.status === "completed" && task.activeAttemptId && onReview && (
                    <button
                      type="button"
                      className="subtle"
                      onClick={() => onReview(task.activeAttemptId as string)}
                    >
                      查看
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!child && logs.length > 0 && (
        <section className="panel">
          <details>
            <summary>最近操作（{logs.length}）</summary>
            <div className="learning-table">
              {logs.slice(0, 15).map((log) => (
                <div key={log.id} className="learning-row">
                  <div className="learning-word">
                    <strong>{log.detail}</strong>
                  </div>
                  <div className="learning-meta">
                    <span className="small muted">
                      {log.actor === "child"
                        ? "孩子端"
                        : log.actor === "system"
                          ? "系统"
                          : "家长端"}{" "}
                      · {new Date(log.createdAt).toLocaleString("zh-CN")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}
    </main>
  );
}
