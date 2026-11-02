import { useEffect, useRef, useState } from "react";
import {
  type Attempt,
  attemptSchema,
  type TaskPlay,
  type TaskPlayResponse,
} from "../../../packages/contract/src/index";
import { ActiveTime } from "../../../packages/core/src/pacing";
import { Playback } from "../../../packages/core/src/player";
import { AudioPreparation, type PreparedAudio } from "./AudioPreparation";
import { download } from "./api";
import { BrowserAudio } from "./audio";
import { localKey, useLocal, useUnsavedProtection } from "./storage";
import { taskApi } from "./task-api";

export function TaskPlayer({
  taskId,
  accountId,
  onReview,
  onBack,
  child,
}: {
  child: boolean;
  taskId: string;
  accountId: string;
  onReview: (id: string) => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<TaskPlayResponse | null>(null);
  const [prepared, setPrepared] = useState<PreparedAudio | null>(null);
  const [confirmedVoice, setConfirmedVoice] = useState(false);
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
      <AudioPreparation
        key={data.task.id}
        task={data.task}
        compact={child}
        onPrepared={setPrepared}
      />
      {prepared?.needsConfirmation && <p role="alert">有指定读音未命中，请家长试听并确认兜底。</p>}
      {!child && prepared?.needsConfirmation && (
        <label className="check">
          <input
            type="checkbox"
            checked={confirmedVoice}
            onChange={(e) => setConfirmedVoice(e.target.checked)}
          />
          我已试听并确认本次兜底发音
        </label>
      )}
      {!data.attempt || data.attempt.completedAt ? (
        <section className="panel">
          <p>{data.task.items.length} 项，准备好纸笔。</p>
          <div className="row">
            <button
              className="primary"
              disabled={
                busy || !prepared?.ready || (!!prepared?.needsConfirmation && !confirmedVoice)
              }
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
                disabled={
                  busy || !prepared?.ready || (!!prepared?.needsConfirmation && !confirmedVoice)
                }
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
      ) : prepared?.ready ? (
        <TaskSession
          key={data.attempt.id}
          task={data.task}
          clips={prepared.clips}
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
      ) : (
        <p role="status">声音准备好后即可继续。</p>
      )}
    </main>
  );
}

function TaskSession({
  clips,
  task,
  attempt,
  accountId,
  onSaved,
  onReview,
  onDirty,
  onReload,
}: {
  clips: PreparedAudio["clips"];
  task: TaskPlay;
  attempt: Attempt;
  accountId: string;
  onSaved: (attempt: Attempt) => void;
  onReview: (id: string) => void;
  onDirty: (value: boolean) => void;
  onReload: () => Promise<void>;
}) {
  const initialAudio = useRef({ clips, accent: task.settings.accent });
  const local = useLocal(localKey(`attempt:${attempt.id}`, accountId), attemptSchema);
  const current = local.value ?? attempt;
  const latest = useRef(current);
  latest.current = current;
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState("");
  const playback = useRef<Playback | null>(null);
  const clock = useRef(new ActiveTime());
  const guided = useRef(false);
  const [rest, setRest] = useState<{
    next: number;
    remaining: number;
    reason: "group" | "time";
  } | null>(null);
  const finishRest = useRef<() => void>(() => {});
  useEffect(() => {
    if (current.phase === "player") clock.current.resume();
    else clock.current.pause();
  }, [current.phase]);
  useEffect(() => {
    if (rest?.reason !== "group") return;
    if (rest.remaining === 0) {
      finishRest.current();
      return;
    }
    const timer = setTimeout(
      () => setRest((value) => (value ? { ...value, remaining: value.remaining - 1 } : null)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [rest]);
  useUnsavedProtection(!!local.value || !!local.error);
  useEffect(() => {
    onDirty(!!local.value || busy);
  }, [local.value, busy, onDirty]);
  useEffect(() => {
    const audio = new BrowserAudio(initialAudio.current.accent);
    for (const clip of initialAudio.current.clips)
      audio.cache(clip.audio.text, clip.audio.lang, clip.blob, clip.audio.wordId);
    const player = new Playback(audio, (value, error) => {
      setPlaying(value);
      if (error) setMessage(error);
    });
    playback.current = player;
    const hide = () => {
      if (document.hidden) {
        player.stop();
        clock.current.pause();
        setRest(null);
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
  function play(index = latest.current.index) {
    clock.current.resume();
    setMessage("");
    const guidance = task.settings.guidance && "speechSynthesis" in window;
    const intro = guidance && !guided.current ? "准备好纸笔，写好了点下一项。" : undefined;
    guided.current = true;
    void playback.current?.play(
      task.items,
      index,
      task.settings,
      async (next) => {
        if (!(await save({ index: next }))) throw new Error("尚未同步，已暂停");
        if (clock.current.shouldRest()) {
          playback.current?.stop();
          clock.current.pause();
          setRest({ next, remaining: 0, reason: "time" });
        }
      },
      {
        intro,
        groupGuide: guidance ? "这组写完了，休息一下。" : undefined,
        onBreak: (next) => {
          clock.current.pause();
          setRest({ next, remaining: 10, reason: "group" });
        },
      },
    );
  }
  finishRest.current = () => {
    if (!rest) return;
    if (rest.reason === "time") clock.current.reset();
    clock.current.resume();
    const next = rest.next;
    setRest(null);
    if (task.items[next].lang) play(next);
  };
  async function next() {
    playback.current?.stop();
    clock.current.resume();
    const next = latest.current.index + 1;
    if (next >= task.items.length) {
      clock.current.pause();
      await save({ phase: "review" });
      return;
    }
    if (!(await save({ index: next }))) return;
    if (clock.current.shouldRest()) {
      clock.current.pause();
      setRest({ next, remaining: 0, reason: "time" });
    } else if (task.settings.groupSize && next % task.settings.groupSize === 0) {
      clock.current.pause();
      setRest({ next, remaining: 10, reason: "group" });
    } else if (task.items[next].lang) play(next);
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
                try {
                  await onReload();
                  local.reset();
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "重新载入失败，请重试");
                }
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
      ) : rest ? (
        <section className="rest-panel">
          <h2>
            {rest.reason === "time" ? "已经练习二十分钟，休息一下" : "上一组写完了，歇一会儿"}
          </h2>
          {rest.reason === "group" && <p role="status">{rest.remaining} 秒后继续</p>}
          <button className="primary" type="button" onClick={() => finishRest.current()}>
            准备好了，继续
          </button>
        </section>
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
                  clock.current.pause();
                  void save({});
                } else play();
              }}
            >
              {playing ? "暂停" : "播放 / 再听一次"}
            </button>
            <button type="button" disabled={busy || !!local.value} onClick={() => void next()}>
              {current.index + 1 < task.items.length ? "我写好了，下一个" : "写完了，去核对"}
            </button>
            <button
              type="button"
              disabled={busy || !!local.value}
              onClick={() => {
                playback.current?.stop();
                clock.current.pause();
                setMessage("已暂停练习，回来后点播放或下一项继续");
                void save({});
              }}
            >
              暂停练习
            </button>
          </div>
          {task.settings.groupSize > 0 && (
            <p className="small muted">
              第 {Math.floor(current.index / task.settings.groupSize) + 1} /{" "}
              {Math.ceil(task.items.length / task.settings.groupSize)} 组
            </p>
          )}
        </>
      )}
    </section>
  );
}
