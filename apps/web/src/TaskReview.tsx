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
  onBack,
}: {
  attemptId: string;
  accountId: string;
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
  onBack,
}: {
  accountId: string;
  initial: Attempt;
  task: Task;
  onBack: () => void;
}) {
  const [saved, setSaved] = useState(initial);
  const local = useLocal(localKey(`attempt:${initial.id}`, accountId), attemptSchema);
  const attempt = local.value ?? saved;
  const [printing, setPrinting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
      <button className="print-controls" type="button" onClick={() => setPrinting(true)}>
        打印练习纸
      </button>
      <div className="results">
        {task.items.map((item, index) => (
          <article key={item.wordId} className="panel result-item">
            <div>
              <p className="eyebrow">
                第 {index + 1} 项 · {item.source === "review" ? "复习" : "作业"}
              </p>
              <h2>{item.entry[MODES[task.mode].answer]}</h2>
              <p>
                {item.entry.en && item.entry.zh} {item.entry.pinyin}
              </p>
              {item.entry.alt.length > 0 && <p>其他写法：{item.entry.alt.join("、")}</p>}
            </div>
            {attempt.completedAt ? (
              <p>
                {
                  (
                    {
                      correct: "已通过",
                      wrong: "待巩固",
                      uncertain: "不确定",
                      unchecked: "未核对",
                    } as const
                  )[attempt.results[item.wordId] ?? "unchecked"]
                }
              </p>
            ) : (
              <div className="row">
                {(
                  [
                    ["wrong", "再练一次"],
                    ["uncertain", "不确定"],
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
            {attempt.completedAt && attempt.results[item.wordId] !== "correct" && (
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
          </article>
        ))}
      </div>
      {!attempt.completedAt && (
        <section className="panel">
          <label className="check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            已全部核对，其余正确
          </label>
          <p className="small muted">未确认时，其余项保留“未核对”，不会算作通过。</p>
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
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "完成失败，请重试");
              } finally {
                setBusy(false);
              }
            }}
          >
            保存核对并完成
          </button>
        </section>
      )}
      {attempt.completedAt && <ReportCard task={task} attempt={attempt} />}
    </>
  );
}
