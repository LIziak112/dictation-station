import { useEffect, useRef, useState } from "react";
import {
  type Attempt,
  attemptSchema,
  type TaskPlay,
  type TaskPlayResponse,
} from "../../../packages/contract/src/index";
import { Playback } from "../../../packages/core/src/player";
import { download } from "./api";
import { BrowserAudio } from "./audio";
import { localKey, useLocal, useUnsavedProtection } from "./storage";
import { taskApi } from "./task-api";

export function TaskPlayer({
  taskId,
  accountId,
  onReview,
  onBack,
}: {
  taskId: string;
  accountId: string;
  onReview: (id: string) => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<TaskPlayResponse | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (!document.hidden && !dirty.current)
        taskApi
          .play(taskId, controller.signal)
          .then(setData)
          .catch((e: Error) => {
            if (!controller.signal.aborted) setMessage(e.message);
          });
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [taskId]);
  if (!data)
    return (
      <main>
        <p role="status">{message || "正在读取任务…"}</p>
        <button type="button" onClick={onBack}>
          返回任务
        </button>
      </main>
    );
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{data.task.date}</p>
          <h1>{data.task.title}</h1>
        </div>
        <button type="button" onClick={onBack}>
          返回任务
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
      {!data.attempt || data.attempt.completedAt ? (
        <section className="panel">
          <p>{data.task.items.length} 项，准备好纸笔。</p>
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              type="button"
              onClick={async () => {
                setBusy(true);
                try {
                  await taskApi.start(taskId, false);
                  setData(await taskApi.play(taskId));
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "开始失败");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {data.attempt?.completedAt ? "再练一次" : "开始任务"}
            </button>
            {!data.attempt && data.task.homeworkCount > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await taskApi.start(taskId, true);
                    setData(await taskApi.play(taskId));
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "开始失败");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                今天只完成作业
              </button>
            )}
            {data.attempt?.completedAt && (
              <button type="button" onClick={() => onReview(data.attempt?.id ?? "")}>
                查看核对记录
              </button>
            )}
          </div>
        </section>
      ) : (
        <TaskSession
          key={data.attempt.id}
          task={data.task}
          attempt={data.attempt}
          accountId={accountId}
          onSaved={(attempt) =>
            setData((previous) => (previous ? { ...previous, attempt } : previous))
          }
          onReview={onReview}
          onDirty={(value) => {
            dirty.current = value;
          }}
          onReload={async () => setData(await taskApi.play(taskId))}
        />
      )}
    </main>
  );
}

function TaskSession({
  task,
  attempt,
  accountId,
  onSaved,
  onReview,
  onDirty,
  onReload,
}: {
  task: TaskPlay;
  attempt: Attempt;
  accountId: string;
  onSaved: (attempt: Attempt) => void;
  onReview: (id: string) => void;
  onDirty: (value: boolean) => void;
  onReload: () => Promise<void>;
}) {
  const local = useLocal(localKey(`attempt:${attempt.id}`, accountId), attemptSchema);
  const current = local.value ?? attempt;
  const latest = useRef(current);
  latest.current = current;
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState("");
  const playback = useRef<Playback | null>(null);
  useUnsavedProtection(!!local.value || !!local.error);
  useEffect(() => {
    onDirty(!!local.value || busy);
  }, [local.value, busy, onDirty]);
  useEffect(() => {
    const audio = new BrowserAudio();
    const player = new Playback(audio, (value, error) => {
      setPlaying(value);
      if (error) setMessage(error);
    });
    playback.current = player;
    const hide = () => {
      if (document.hidden) {
        player.stop();
        setMessage("已暂停，回来后点播放继续");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      player.stop();
      audio.dispose();
    };
  }, []);
  async function save(patch: Partial<Attempt>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    if (!local.write(next)) return false;
    setBusy(true);
    setMessage("");
    try {
      const { attempt: saved } = await taskApi.save(next.id, next);
      latest.current = saved;
      onSaved(saved);
      local.write(null);
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "尚未同步，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const item = task.items[current.index];
  return (
    <section className="panel task-session">
      {local.value && <p role="status">有尚未同步的进度，请重试同步或导出备份。</p>}
      {local.error && <p role="alert">{local.error}</p>}
      {message && <p role="alert">{message}</p>}
      {(local.value || local.error) && (
        <div className="row">
          <button type="button" disabled={busy} onClick={() => void save({})}>
            重试同步
          </button>
          <button
            type="button"
            onClick={() => download("未同步听写进度.json", local.value ?? local.raw)}
          >
            导出备份
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (confirm("放弃本机尚未同步的进度，重新载入服务端？建议先导出备份。")) {
                await onReload();
                local.reset();
              }
            }}
          >
            重新载入服务端
          </button>
        </div>
      )}
      {current.phase === "review" ? (
        <>
          <h2>写完了，请家长核对</h2>
          <p>核对答案需要本机家长口令。</p>
          <button
            className="primary"
            disabled={busy || !!local.value}
            type="button"
            onClick={() => onReview(current.id)}
          >
            请家长核对
          </button>
        </>
      ) : (
        <>
          <p className="eyebrow">
            第 {current.index + 1} / {task.items.length} 项
          </p>
          <progress value={current.index + 1} max={task.items.length} aria-label="任务进度" />
          <h2 className="task-prompt">{item.prompt || "听声音，在纸上写下答案"}</h2>
          <div className="row">
            <button
              className="primary"
              disabled={busy || !item.audioText || !!local.value}
              type="button"
              onClick={() => {
                if (playing) {
                  playback.current?.stop();
                  void save({});
                  return;
                }
                void playback.current?.play(
                  task.items,
                  current.index,
                  task.settings,
                  async (index) => {
                    if (!(await save({ index }))) throw new Error("尚未同步，已暂停");
                  },
                );
              }}
            >
              {playing ? "暂停" : "播放 / 再听一次"}
            </button>
            <button
              type="button"
              disabled={busy || !!local.value}
              onClick={async () => {
                playback.current?.stop();
                await save(
                  current.index + 1 < task.items.length
                    ? { index: current.index + 1 }
                    : { phase: "review" },
                );
              }}
            >
              {current.index + 1 < task.items.length ? "我写好了，下一个" : "写完了，去核对"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
