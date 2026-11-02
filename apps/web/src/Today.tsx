import { useEffect, useRef, useState } from "react";
import { MODES, type TaskSummary } from "../../../packages/contract/src/index";
import { taskApi } from "./task-api";

export function Today({
  child,
  onOpen,
  onCreate,
  onLibrary,
}: {
  child: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onLibrary: () => void;
}) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const refreshNow = useRef<() => void>(() => {});
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (!document.hidden)
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
    };
    refreshNow.current = refresh;
    refresh();
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">纸笔准备好了吗</p>
          <h1>{child ? "今天练一点" : "今日任务"}</h1>
          <p>{child ? "选一份任务，跟着声音慢慢写。" : "手机安排，平板打开，接着上次进度练。"}</p>
        </div>
        {!child && (
          <button className="primary" type="button" onClick={onCreate}>
            安排任务
          </button>
        )}
      </div>
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
      {!loading && !message && !tasks.length && (
        <section className="panel empty">
          <h2>还没有安排任务</h2>
          <p>{child ? "请家长准备今天的内容。" : "从自己的词表选择今天要听的范围。"}</p>
          {!child && (
            <button type="button" onClick={onLibrary}>
              打开词库
            </button>
          )}
        </section>
      )}
      <div className="batch-grid">
        {tasks.map((task) => (
          <article className="panel task-card" key={task.id}>
            <p className="eyebrow">
              {task.date} ·{" "}
              {task.status === "completed"
                ? "已完成"
                : task.status === "in_progress"
                  ? "进行中"
                  : "待完成"}
            </p>
            <h2>{task.title}</h2>
            <p>
              {task.count - task.reviewCount} 项作业
              {task.reviewCount ? ` + ${task.reviewCount} 项复习` : ""} · {MODES[task.mode].label}
            </p>
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
            <button type="button" onClick={() => onOpen(task.id)}>
              {task.status === "completed"
                ? "查看或再练"
                : task.status === "pending"
                  ? "准备开始"
                  : "继续任务"}
            </button>
          </article>
        ))}
      </div>
    </main>
  );
}
