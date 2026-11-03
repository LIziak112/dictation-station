import { useEffect, useState } from "react";
import {
  type Attempt,
  attemptDetailSchema,
  attemptResponseSchema,
  attemptSchema,
  MODES,
  type Task,
} from "../../../packages/contract/src/index";
import { download, request } from "./api";
import { PrintView } from "./PrintView";
import { ReportCard } from "./ReportCard";
import { localKey, useLocal, useUnsavedProtection } from "./storage";
import { taskApi } from "./task-api";

export function TaskReview({
  attemptId,
  accountId,
  child = false,
  onRedispatched,
  onBack,
}: {
  attemptId: string;
  accountId: string;
  child?: boolean;
  onRedispatched?: (taskId: string) => void;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<{ task: Task; attempt: Attempt } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    request(`api/attempts/${attemptId}`, attemptDetailSchema, {
      signal: controller.signal,
    })
      .then(setDetail)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [attemptId]);
  return (
    <main>
      {error && (
        <div className="notice error">
          <p role="alert">{error}。请返回任务后重试。</p>
          <button type="button" onClick={onBack}>
            返回任务
          </button>
        </div>
      )}
      {detail ? (
        <ReviewSession
          accountId={accountId}
          initial={detail.attempt}
          task={detail.task}
          child={child}
          onRedispatched={onRedispatched}
          onBack={onBack}
        />
      ) : (
        !error && <p role="status">正在读取核对内容…</p>
      )}
    </main>
  );
}
function ReviewSession({
  accountId,
  initial,
  task,
  child,
  onRedispatched,
  onBack,
}: {
  accountId: string;
  initial: Attempt;
  task: Task;
  child: boolean;
  onRedispatched?: (taskId: string) => void;
  onBack: () => void;
}) {
  const [saved, setSaved] = useState(initial);
  const local = useLocal(localKey(`attempt:${initial.id}`, accountId), attemptSchema);
  const attempt = local.value ?? saved;
  const [printing, setPrinting] = useState(false);
  const [filter, setFilter] = useState<"all" | "correct" | "wrong" | "uncertain" | "unchecked">(
    "all",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [resetIndex, setResetIndex] = useState(false);
  const [answerCard, setAnswerCard] = useState(false);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [celebration, setCelebration] = useState(0);
  useUnsavedProtection(!!local.value || !!local.error);
  async function save(next: Attempt) {
    if (!local.write(next)) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await taskApi.save(next.id, next);
      setSaved(result.attempt);
      local.write(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "尚未同步，请重试");
    } finally {
      setBusy(false);
    }
  }
  const checked = Object.values(attempt.results).filter((result) => result !== "unchecked").length;
  const tally = (kind: string) =>
    task.items.filter((i) => (attempt.results[i.wordId] ?? "unchecked") === kind).length;
  const canRedispatch =
    attempt.completedAt &&
    !child &&
    task.items.some(
      (item) =>
        attempt.results[item.wordId] === "wrong" || attempt.results[item.wordId] === "uncertain",
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {MODES[task.mode].label} · {task.date}
          </p>
          <h1>{attempt.completedAt ? "本次核对记录" : "只点需要再练的项"}</h1>
          <p>
            {task.title} · 已核对 {checked}/{task.items.length}
          </p>
        </div>
        <button type="button" onClick={onBack}>
          返回任务
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
      {celebration > 0 && (
        <section className="completion-cheer" role="status">
          <div className="cheer-confetti" aria-hidden="true">
            {Array.from("abcdefghijklmnopqr", (piece, index) => (
              <i
                key={piece}
                style={{ left: `${index * 5.7}%`, animationDelay: `${(index % 6) * 0.08}s` }}
              />
            ))}
          </div>
          <strong>今天也认真完成啦！</strong>
          <p>本设备连续打卡 {celebration} 天 · 坚持小达人</p>
        </section>
      )}
      {!!task.audio.length && (
        <section className="panel">
          <details>
            <summary>本次发音来源</summary>
            {task.audio.map((voice) => (
              <p key={voice.wordId}>
                {voice.text} · {voice.source}
                {voice.kind === "human" && (
                  <>
                    {" "}
                    · {voice.author} ·{" "}
                    <a href={voice.sourceUrl} target="_blank" rel="noreferrer">
                      来源
                    </a>{" "}
                    ·{" "}
                    <a href={voice.licenseUrl} target="_blank" rel="noreferrer">
                      {voice.licenseName}
                    </a>
                  </>
                )}
              </p>
            ))}
          </details>
        </section>
      )}
      {local.error && <p role="alert">{local.error}</p>}
      {local.value && (
        <div className="notice">
          <p>核对尚未同步，请重试。</p>
          <button type="button" disabled={busy} onClick={() => void save(attempt)}>
            重试同步
          </button>
          <button type="button" onClick={() => download("核对备份.json", attempt)}>
            导出备份
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm("放弃本机核对修改，重新载入服务端？")) {
                local.reset();
                location.reload();
              }
            }}
          >
            重新载入服务端
          </button>
        </div>
      )}
      {printing && <PrintView task={task} attempt={attempt} onClose={() => setPrinting(false)} />}
      <div className="review-summary">
        {(
          [
            ["all", "全部"],
            ["correct", "已通过"],
            ["wrong", "未通过"],
            ["uncertain", "待巩固"],
            ["unchecked", "未核对"],
          ] as const
        ).map(([kind, label]) => (
          <button
            type="button"
            key={kind}
            className={`review-filter sum-${kind}`}
            aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}
          >
            {label} <strong>{kind === "all" ? task.items.length : tally(kind)}</strong>
          </button>
        ))}
        <div className="review-summary-actions">
          {canRedispatch && (
            <button
              type="button"
              className="subtle review-redispatch"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const { task: created } = await taskApi.redispatchWrong(attempt.id);
                  if (onRedispatched) onRedispatched(created.id);
                  else onBack();
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "复习任务安排失败");
                } finally {
                  setBusy(false);
                }
              }}
            >
              安排复习
            </button>
          )}
          <button className="print-controls subtle" type="button" onClick={() => setPrinting(true)}>
            打印练习纸
          </button>
        </div>
      </div>
      {!attempt.completedAt && (
        <section className="answer-card-entry">
          <button
            type="button"
            disabled={busy || !!local.value}
            onClick={() => {
              setWrongIds(
                task.items
                  .filter((item) => attempt.results[item.wordId] === "wrong")
                  .map((item) => item.wordId),
              );
              setAnswerCard(true);
            }}
          >
            按序号批改
          </button>
          <span>对照纸面，点选写错的序号</span>
        </section>
      )}
      {answerCard && (
        <dialog
          className="answer-card"
          aria-labelledby="answer-card-title"
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onCancel={() => setAnswerCard(false)}
        >
          <h2 id="answer-card-title">按序号标记错题</h2>
          <p>点选纸面上写错的序号；再次点选可取消。其他核对结果保持不变。</p>
          <div className="answer-card-grid">
            {task.items.map((item, index) => (
              <button
                key={item.wordId}
                type="button"
                aria-label={`第 ${index + 1} 题，${wrongIds.includes(item.wordId) ? "未通过" : "未选为错题"}`}
                aria-pressed={wrongIds.includes(item.wordId)}
                onClick={() =>
                  setWrongIds((ids) =>
                    ids.includes(item.wordId)
                      ? ids.filter((id) => id !== item.wordId)
                      : [...ids, item.wordId],
                  )
                }
              >
                {index + 1}
              </button>
            ))}
          </div>
          <p>已选 {wrongIds.length} 题</p>
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() => {
                const results = { ...attempt.results };
                for (const item of task.items) {
                  if (wrongIds.includes(item.wordId)) results[item.wordId] = "wrong";
                  else if (results[item.wordId] === "wrong") results[item.wordId] = "unchecked";
                }
                setAnswerCard(false);
                void save({ ...attempt, results });
              }}
            >
              保存错题标记
            </button>
            <button type="button" onClick={() => setAnswerCard(false)}>
              取消
            </button>
          </div>
        </dialog>
      )}
      <div className="review-list" role="list" hidden={filter !== "all" && tally(filter) === 0}>
        {task.items
          .map((item, index) => ({ item, index }))
          .filter(
            ({ item }) =>
              filter === "all" || (attempt.results[item.wordId] ?? "unchecked") === filter,
          )
          .map(({ item, index }) => (
            <article
              key={item.wordId}
              role="listitem"
              className="review-row"
              data-result={attempt.results[item.wordId] ?? "unchecked"}
            >
              <span className="review-index">{index + 1}</span>
              <div className="review-word">
                <h2>{item.entry[MODES[task.mode].answer]}</h2>
                <div className="review-meaning">
                  <span>
                    {MODES[task.mode].answer === "en"
                      ? item.entry.zh
                      : item.entry.en || item.entry.pinyin}
                  </span>
                  {(MODES[task.mode].answer === "en" || item.entry.en) && item.entry.pinyin && (
                    <span className="review-extra">{item.entry.pinyin}</span>
                  )}
                  {item.entry.alt.length > 0 && (
                    <span className="review-extra">其他写法：{item.entry.alt.join("、")}</span>
                  )}
                  {item.source === "review" && <span className="review-tag">复习</span>}
                </div>
              </div>
              <div className="review-row-actions">
                {attempt.completedAt ? (
                  <p className="review-result">
                    {
                      (
                        {
                          correct: "已通过",
                          wrong: "未通过",
                          uncertain: "待巩固",
                          unchecked: "未核对",
                        } as const
                      )[attempt.results[item.wordId] ?? "unchecked"]
                    }
                  </p>
                ) : (
                  <div className="review-marks">
                    {(
                      [
                        ["wrong", "未通过"],
                        ["uncertain", "待巩固"],
                        ["correct", "已通过"],
                      ] as const
                    ).map(([result, label]) => (
                      <button
                        type="button"
                        key={result}
                        disabled={busy || !!local.value}
                        aria-pressed={attempt.results[item.wordId] === result}
                        onClick={() =>
                          void save({
                            ...attempt,
                            results: { ...attempt.results, [item.wordId]: result },
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {attempt.completedAt &&
                  ["wrong", "uncertain"].includes(attempt.results[item.wordId]) && (
                    <button
                      type="button"
                      disabled={busy || attempt.corrections.includes(item.wordId)}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const response = await request(
                            `api/attempts/${attempt.id}/corrections`,
                            attemptResponseSchema,
                            {
                              method: "POST",
                              body: JSON.stringify({
                                revision: attempt.revision,
                                wordIds: [item.wordId],
                              }),
                            },
                          );
                          setSaved(response.attempt);
                        } catch (e) {
                          setMessage(e instanceof Error ? e.message : "订正保存失败");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {attempt.corrections.includes(item.wordId) ? "已订正" : "记为已订正"}
                    </button>
                  )}
              </div>
            </article>
          ))}
      </div>
      {filter !== "all" && tally(filter) === 0 && (
        <div className="review-empty" role="status">
          <strong>这里暂时没有词条</strong>
          <p>当前筛选下没有匹配的结果，可以查看全部词条。</p>
          <button type="button" onClick={() => setFilter("all")}>
            查看全部 {task.items.length} 项
          </button>
        </div>
      )}
      {!attempt.completedAt && (
        <section className="panel review-completion" aria-labelledby="review-completion-title">
          <div className="review-completion-heading">
            <h2 id="review-completion-title">完成核对</h2>
            <p className="small muted">确认纸面结果后，保存本次批改。</p>
          </div>
          <div className="review-completion-confirm">
            <label className="check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              已全部核对，其余未标记的题目均正确
            </label>
            <p className="small muted">不勾选时，未标记的题目保留为“未核对”。</p>
          </div>
          <button
            className="primary"
            type="button"
            disabled={busy || !!local.value || local.blocked}
            onClick={async () => {
              setBusy(true);
              setMessage("");
              try {
                const result = await taskApi.complete(attempt.id, attempt.revision, confirmed);
                setSaved(result.attempt);
                setMessage("今天完成了，核对记录已保存。");
                try {
                  const key = localKey("checkin-days", accountId);
                  const today = new Date();
                  const dateKey = (date: Date) =>
                    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                  const dates: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
                  const days = Array.isArray(dates)
                    ? dates.filter((day) => typeof day === "string")
                    : [];
                  const unique = [...new Set([...days, dateKey(today)])].sort().slice(-366);
                  localStorage.setItem(key, JSON.stringify(unique));
                  let streak = 0;
                  while (unique.includes(dateKey(today))) {
                    streak++;
                    today.setDate(today.getDate() - 1);
                  }
                  setCelebration(streak);
                } catch {
                  setCelebration(1);
                }
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "完成失败，请重试");
              } finally {
                setBusy(false);
              }
            }}
          >
            保存核对并完成
          </button>
          {!child && (
            <details className="review-return">
              <summary>退回给孩子继续听写</summary>
              <p className="small muted">
                退回的是整份任务，不是只重做错题；本次所有批改标记都会清除。
              </p>
              <fieldset className="review-return-options">
                <legend>孩子从哪里开始？</legend>
                <label className="check">
                  <input
                    type="radio"
                    name="return-start"
                    checked={!resetIndex}
                    onChange={() => setResetIndex(false)}
                  />
                  从交卷时的位置继续听写
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="return-start"
                    checked={resetIndex}
                    onChange={() => setResetIndex(true)}
                  />
                  从第一题重新听写整份任务
                </label>
              </fieldset>
              <button
                type="button"
                disabled={busy || !!local.value}
                onClick={async () => {
                  if (
                    !confirm(
                      resetIndex
                        ? "退回整份任务，让孩子从第一题重新听写？本次所有批改标记都会清除。"
                        : "退回整份任务，让孩子从交卷时的位置继续听写？本次所有批改标记都会清除。",
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    await taskApi.returnForRedo(attempt.id, attempt.revision, resetIndex);
                    onBack();
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "退回失败");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认退回任务
              </button>
            </details>
          )}
        </section>
      )}
      {attempt.completedAt && !child && attempt.spotCheckWordIds.length > 0 && (
        <section className="notice" role="status">
          <p>
            孩子已完成自主核对 · 建议家长抽查纸面拼写：
            <strong>
              {task.items
                .filter((i) => attempt.spotCheckWordIds.includes(i.wordId))
                .map((i) => i.entry.en || i.entry.zh)
                .join("、")}
            </strong>
          </p>
        </section>
      )}
      {attempt.completedAt && <ReportCard task={task} attempt={attempt} />}
    </>
  );
}
