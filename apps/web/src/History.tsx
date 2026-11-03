import { useEffect, useState } from "react";
import {
  type HistoryItem,
  historyResponseSchema,
  MODES,
  weeklyResponseSchema,
} from "../../../packages/contract/src/index";
import { request } from "./api";

export function History({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [weekly, setWeekly] = useState<{
    completed: number;
    pending: number;
    next: string[];
    from: string;
    to: string;
  }>();
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      request("api/history", historyResponseSchema, { signal: controller.signal }),
      request("api/weekly", weeklyResponseSchema, { signal: controller.signal }),
    ])
      .then(([history, summary]) => {
        setItems(history.items);
        setWeekly({
          ...summary,
          next: summary.next.map(
            ({ entry, state }) => `${entry.en || entry.zh}（${MODES[state.mode].label}）`,
          ),
        });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setMessage(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">一点点，留得住</p>
          <h1>听写记录</h1>
        </div>
      </div>
      {message && <p role="alert">{message}</p>}
      {weekly && (
        <section className="panel">
          <h2>这周的三件事</h2>
          <p className="small muted">
            {weekly.from} 至 {weekly.to}
          </p>
          <dl className="weekly-grid">
            <div>
              <dt>这周听了几次</dt>
              <dd>{weekly.completed} 次</dd>
            </div>
            <div>
              <dt>哪些还没过关</dt>
              <dd>{weekly.pending} 项待巩固</dd>
            </div>
            <div>
              <dt>下次优先练什么</dt>
              <dd>{weekly.next.length ? weekly.next.join("、") : "目前没有到期的复习项"}</dd>
            </div>
          </dl>
          <p className="small muted">这是按当前复习规则的预览，发布任务前可能变化。</p>
        </section>
      )}
      {!items.length && (
        <section className="panel empty">
          <p>完成任务核对后，会在这里留下记录。</p>
        </section>
      )}
      <div className="record-list">
        {items.map(({ task, attempt }) => (
          <article className="panel record-card" key={attempt.id}>
            <div className="record-details">
              <p className="small muted">
                {task.date} · {MODES[task.mode].label}
              </p>
              <h2>{task.title}</h2>
              <p>
                {task.count} 项 ·{" "}
                {Object.values(attempt.results).filter((result) => result === "wrong").length}{" "}
                项未通过 · 已订正 {attempt.corrections.length} 项
              </p>
            </div>
            <button type="button" onClick={() => onOpen(attempt.id)}>
              查看核对与订正
            </button>
          </article>
        ))}
      </div>
    </main>
  );
}
