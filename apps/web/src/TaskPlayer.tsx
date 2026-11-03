import { useEffect, useRef, useState } from "react";
import {
  type Attempt,
  attemptSchema,
  MODES,
  type Settings,
  type TaskPlay,
  type TaskPlayResponse,
} from "../../../packages/contract/src/index";
import { ActiveTime } from "../../../packages/core/src/pacing";
import { Playback } from "../../../packages/core/src/player";
import { AudioPreparation, type PreparedAudio } from "./AudioPreparation";
import { ApiError, download, getDeviceId } from "./api";
import { BrowserAudio } from "./audio";
import { localKey, useLocal, useUnsavedProtection } from "./storage";
import { taskApi } from "./task-api";

export function TaskPlayer({
  taskId,
  accountId,
  onShareChild,
  onPrint,
  onEditTask,
  onCloneTask,
  onReview,
  onBack,
  child,
}: {
  child: boolean;
  taskId: string;
  accountId: string;
  onShareChild?: () => void;
  onPrint?: () => void;
  onEditTask?: () => void;
  onCloneTask?: () => void;
  onReview: (id: string, stayInChild?: boolean) => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<TaskPlayResponse | null>(null);
  const [prepared, setPrepared] = useState<PreparedAudio | null>(null);
  const [confirmedVoice, setConfirmedVoice] = useState(false);
  const [message, setMessage] = useState("");
  const [takeoverPrompt, setTakeoverPrompt] = useState<{
    onlyHomework: boolean;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [justStarted, setJustStarted] = useState(false);
  const dirty = useRef(false);
  const loaded = !!data;
  useEffect(() => {
    if (loaded) document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
  }, [loaded]);
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

  async function startTask(onlyHomework: boolean, forceTakeover = false) {
    setBusy(true);
    setMessage("");
    try {
      await taskApi.start(taskId, onlyHomework, forceTakeover);
      setTakeoverPrompt(null);
      setJustStarted(true);
      setData(await taskApi.play(taskId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.message.includes("接管")) {
        setTakeoverPrompt({ onlyHomework, text: e.message });
      } else {
        setMessage(e instanceof Error ? e.message : "开始失败");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <main tabIndex={-1} id="main">
        <p role="status">{message || "正在读取任务…"}</p>
        <button type="button" onClick={onBack}>
          返回任务
        </button>
      </main>
    );
  const conflictOnInitialLoad =
    data.attempt &&
    !data.attempt.completedAt &&
    !data.attempt.interruptedAt &&
    data.attempt.activeDeviceId &&
    data.attempt.activeDeviceId !== getDeviceId() &&
    data.attempt.heartbeatAt &&
    Date.now() - new Date(data.attempt.heartbeatAt).getTime() < 30_000;

  const isPlayingSession =
    child && !!data.attempt && !data.attempt.completedAt && !data.attempt.interruptedAt;

  return (
    <main tabIndex={-1} id="main">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {MODES[data.task.mode].label} · {data.task.date}
          </p>
          <h1>{data.task.title}</h1>
        </div>
        <button type="button" onClick={onBack}>
          {isPlayingSession ? "暂存并返回" : "返回任务"}
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
      {takeoverPrompt && (
        <section className="notice" role="alert">
          <p>{takeoverPrompt.text}</p>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void startTask(takeoverPrompt.onlyHomework, true)}
            >
              在此设备接管并继续
            </button>
            <button type="button" onClick={() => setTakeoverPrompt(null)}>
              取消
            </button>
          </div>
        </section>
      )}
      {data.task.status === "withdrawn" ? (
        <section className="panel">
          <h2>该任务已被家长撤回</h2>
          <p>本次听写已停止，已完成的部分进度已按中断档案保存。</p>
          <button type="button" className="primary" onClick={onBack}>
            返回任务列表
          </button>
        </section>
      ) : !child ? (
        <>
          <AudioPreparation
            key={data.task.id}
            task={data.task}
            compact={false}
            onPrepared={setPrepared}
          />
          {prepared?.needsConfirmation && (
            <>
              <p role="alert">有指定读音未命中，请家长试听并确认兜底。</p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmedVoice}
                  onChange={(e) => setConfirmedVoice(e.target.checked)}
                />
                我已试听并确认本次兜底发音
              </label>
            </>
          )}
          <section className="panel">
            <h2>
              {data.task.status === "submitted"
                ? "孩子已交卷，待家长批改"
                : data.task.status === "completed"
                  ? "本次听写已批改完成"
                  : data.task.status === "in_progress"
                    ? "孩子正在听写中"
                    : "已派发到孩子听写区，等待孩子开始"}
            </h2>
            <p>
              {data.task.homeworkCount} 项作业 + {data.task.items.length - data.task.homeworkCount}{" "}
              项复习
              {data.task.status === "in_progress" && data.attempt
                ? ` · 当前进度：第 ${(data.attempt.index ?? 0) + 1} / ${data.task.items.length} 项`
                : " · 请让孩子在平板或学习设备上扫码打开「孩子听写区」独立完成听写"}
            </p>
            <div className="row">
              {data.task.status === "submitted" && data.attempt ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => onReview(data.attempt?.id ?? "")}
                >
                  立即批改
                </button>
              ) : data.task.status === "completed" && data.attempt ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => onReview(data.attempt?.id ?? "", true)}
                >
                  查看核对记录
                </button>
              ) : (
                onShareChild && (
                  <button type="button" className="primary" onClick={onShareChild}>
                    孩子区链接 / 二维码
                  </button>
                )
              )}
              {onPrint && (
                <button type="button" onClick={onPrint}>
                  打印准备纸
                </button>
              )}
              {onEditTask && data.task.status === "pending" && (
                <button type="button" onClick={onEditTask}>
                  修改待开始任务
                </button>
              )}
              {onCloneTask && (
                <button type="button" onClick={onCloneTask}>
                  复制再练
                </button>
              )}
              {onShareChild &&
                (data.task.status === "submitted" || data.task.status === "completed") && (
                  <button type="button" onClick={onShareChild}>
                    孩子区链接 / 二维码
                  </button>
                )}
            </div>
          </section>
        </>
      ) : (
        <>
          <div hidden={isPlayingSession}>
            <AudioPreparation
              key={data.task.id}
              task={data.task}
              compact={child}
              onPrepared={setPrepared}
            />
          </div>
          {!isPlayingSession && prepared?.needsConfirmation && (
            <>
              <p role="alert">有指定读音未命中，请家长试听并确认兜底。</p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmedVoice}
                  onChange={(e) => setConfirmedVoice(e.target.checked)}
                />
                我已试听并确认本次兜底发音
              </label>
            </>
          )}
          {!data.attempt || data.attempt.completedAt || data.attempt.interruptedAt ? (
            <section className="panel">
              <h2>准备好纸笔，就可以开始</h2>
              <p>
                {data.task.homeworkCount} 项作业 +{" "}
                {data.task.items.length - data.task.homeworkCount} 项复习
              </p>
              <div className="row">
                <button
                  className="primary"
                  disabled={
                    busy || !prepared?.ready || (!!prepared?.needsConfirmation && !confirmedVoice)
                  }
                  type="button"
                  onClick={() => void startTask(false)}
                >
                  {data.attempt?.completedAt ? "再练一次" : "开始任务"}
                </button>
                {!data.attempt && data.task.homeworkCount > 0 && (
                  <button
                    type="button"
                    disabled={
                      busy || !prepared?.ready || (!!prepared?.needsConfirmation && !confirmedVoice)
                    }
                    onClick={() => void startTask(true)}
                  >
                    今天只完成作业
                  </button>
                )}
                {data.attempt?.completedAt && (
                  <button type="button" onClick={() => onReview(data.attempt?.id ?? "", true)}>
                    查看核对记录
                  </button>
                )}
              </div>
            </section>
          ) : conflictOnInitialLoad && !takeoverPrompt ? (
            <section className="panel">
              <h2>该任务正在另一台设备上进行</h2>
              <p>
                另一台设备正在听写第 {(data.attempt.index ?? 0) + 1} / {data.task.items.length}{" "}
                项。如果换到了这台平板，请点击下方接管继续。
              </p>
              <div className="row">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void startTask(false, true)}
                >
                  在此设备接管并继续
                </button>
                <button type="button" onClick={onBack}>
                  返回任务列表
                </button>
              </div>
            </section>
          ) : prepared?.ready ? (
            <TaskSession
              key={data.attempt.id}
              task={data.task}
              clips={prepared.clips}
              attempt={data.attempt}
              accountId={accountId}
              autoStart={justStarted}
              onSaved={(attempt) =>
                setData((previous) => (previous ? { ...previous, attempt } : previous))
              }
              onReview={onReview}
              onBack={onBack}
              onDirty={(value) => {
                dirty.current = value;
              }}
              onReload={async () => setData(await taskApi.play(taskId))}
            />
          ) : (
            <p role="status">声音准备好后即可继续。</p>
          )}
        </>
      )}
    </main>
  );
}

function TaskSession({
  clips,
  task,
  attempt,
  accountId,
  autoStart = false,
  onSaved,
  onReview,
  onBack,
  onDirty,
  onReload,
}: {
  clips: PreparedAudio["clips"];
  task: TaskPlay;
  attempt: Attempt;
  accountId: string;
  autoStart?: boolean;
  onSaved: (attempt: Attempt) => void;
  onReview: (id: string, stayInChild?: boolean) => void;
  onBack: () => void;
  onDirty: (value: boolean) => void;
  onReload: () => Promise<void>;
}) {
  const local = useLocal(localKey(`attempt:${attempt.id}`, accountId), attemptSchema);
  const current = local.value ?? attempt;
  const latest = useRef(current);
  latest.current = current;
  const [liveSettings, setLiveSettings] = useState<Settings>(task.settings);
  const settingsRef = useRef(liveSettings);
  settingsRef.current = liveSettings;
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState("");
  const [takeoverNeeded, setTakeoverNeeded] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  const driverRef = useRef<BrowserAudio | null>(null);
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
    const audio = new BrowserAudio(settingsRef.current.accent);
    driverRef.current = audio;
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
  useEffect(() => {
    driverRef.current?.setAccent(liveSettings.accent);
  }, [liveSettings.accent]);
  useEffect(() => {
    for (const clip of clips) {
      driverRef.current?.cache(clip.audio.text, clip.audio.lang, clip.blob, clip.audio.wordId);
    }
  }, [clips]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅在点击开始任务进入会话时自动播报首词。
  useEffect(() => {
    if (autoStart && latest.current.phase === "player" && task.items[latest.current.index]?.lang) {
      play(latest.current.index);
    }
  }, []);
  async function save(patch: Partial<Attempt>, forceTakeover = false) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    if (!local.write(next)) return false;
    setBusy(true);
    setMessage("");
    try {
      const { attempt: saved } = await taskApi.save(next.id, { ...next, forceTakeover });
      latest.current = saved;
      onSaved(saved);
      local.write(null);
      setTakeoverNeeded(false);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        playback.current?.stop();
        clock.current.pause();
        if (e.message.includes("撤回")) {
          local.write(null);
          setWithdrawn(true);
          setMessage(e.message);
          return false;
        }
        if (e.message.includes("另一台设备") || e.message.includes("接管")) {
          setTakeoverNeeded(true);
          setMessage(e.message);
          return false;
        }
      }
      setMessage(e instanceof Error ? e.message : "尚未同步，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function play(index = latest.current.index) {
    clock.current.resume();
    setMessage("");
    const activeSettings = settingsRef.current;
    const guidance = activeSettings.guidance && "speechSynthesis" in window;
    const intro = guidance && !guided.current ? "准备好纸笔，写好了点下一项。" : undefined;
    guided.current = true;
    void playback.current?.play(
      task.items,
      index,
      activeSettings,
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
  async function prev() {
    if (latest.current.index <= 0) return;
    playback.current?.stop();
    clock.current.resume();
    const target = latest.current.index - 1;
    if (!(await save({ index: target }))) return;
    if (task.items[target].lang) play(target);
  }
  async function next() {
    playback.current?.stop();
    clock.current.resume();
    const nextIndex = latest.current.index + 1;
    if (nextIndex >= task.items.length) {
      clock.current.pause();
      await save({ phase: "review" });
      return;
    }
    if (!(await save({ index: nextIndex }))) return;
    if (clock.current.shouldRest()) {
      clock.current.pause();
      setRest({ next: nextIndex, remaining: 0, reason: "time" });
    } else if (settingsRef.current.groupSize && nextIndex % settingsRef.current.groupSize === 0) {
      clock.current.pause();
      setRest({ next: nextIndex, remaining: 10, reason: "group" });
    } else if (task.items[nextIndex].lang) play(nextIndex);
  }
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (latest.current.phase !== "player" || rest) return;
      if (
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest("input,textarea,select,button,a,summary,[contenteditable]"))
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        if (playing) {
          playback.current?.stop();
          clock.current.pause();
        } else if (task.items[latest.current.index]?.audioText) {
          play(latest.current.index);
        }
      }
      if (event.key === "ArrowLeft" && latest.current.index > 0) {
        event.preventDefault();
        void prev();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        void next();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  const item = task.items[current.index];
  if (withdrawn) {
    return (
      <section className="panel task-session">
        <h2>家长已撤回该任务</h2>
        <p role="alert">{message || "本次听写已停止，已完成的部分进度已按中断档案保存。"}</p>
        <button type="button" className="primary" onClick={onBack}>
          返回任务列表
        </button>
      </section>
    );
  }
  return (
    <>
      <section className="player-panel panel task-session">
        {local.value && <p role="status">有尚未同步的进度，请重试同步或导出备份。</p>}
        {local.error && <p role="alert">{local.error}</p>}
        {message && <p role="alert">{message}</p>}
        {takeoverNeeded && (
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void save({}, true)}
            >
              在此设备接管并同步
            </button>
          </div>
        )}
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
            <h2>
              {task.allowSelfReview ? "写完了，可以自主核对答案" : "写完了，已交卷给家长批改"}
            </h2>
            <p>
              练习进度已同步，家长端已收到“待批改”提醒；
              {task.allowSelfReview
                ? "本任务已开启自主核对，你可以点击下方直接对照答案核对。"
                : "请把听写纸交给家长核对，批改完成后可在首页订正错词。"}
            </p>
            <div className="row">
              {task.allowSelfReview ? (
                <>
                  <button
                    className="primary"
                    disabled={busy || !!local.value}
                    type="button"
                    onClick={() => onReview(current.id, true)}
                  >
                    自主核对答案
                  </button>
                  <button type="button" onClick={onBack}>
                    返回任务列表
                  </button>
                </>
              ) : (
                <button className="primary" type="button" onClick={onBack}>
                  返回任务列表
                </button>
              )}
            </div>
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
            <div className="row between">
              <span className="muted">
                第 {current.index + 1} / {task.items.length} 项
              </span>
              <span className="small muted">
                {clips.length > 0 ? "真人 / 合成语音已准备" : "本机设备朗读"}
                {liveSettings.groupSize > 0
                  ? ` · 第 ${Math.floor(current.index / liveSettings.groupSize) + 1} / ${Math.ceil(task.items.length / liveSettings.groupSize)} 组`
                  : ""}
              </span>
            </div>
            <progress value={current.index + 1} max={task.items.length} aria-label="任务进度" />
            <div className="prompt">
              <p className="eyebrow">{MODES[task.mode].description}</p>
              <h2 className="task-prompt">{item.prompt || "听一听，写下来"}</h2>
              {item.reading && <p className="muted">读音：{item.reading}</p>}
            </div>
            <div className="play-controls">
              <button
                type="button"
                disabled={current.index === 0 || busy || !!local.value}
                onClick={() => void prev()}
              >
                上一词
              </button>
              <button
                className="primary play-button"
                disabled={busy || !item.audioText || !!local.value}
                aria-pressed={playing}
                type="button"
                onClick={() => {
                  if (playing) {
                    playback.current?.stop();
                    clock.current.pause();
                  } else {
                    play();
                  }
                }}
              >
                {playing ? "暂停" : "播放 / 再听一次"}
              </button>
              <button type="button" disabled={busy || !!local.value} onClick={() => void next()}>
                {current.index + 1 < task.items.length ? "我写好了，下一个" : "写完了，去核对"}
              </button>
            </div>
            {!item.audioText && (
              <p className="muted center">此模式看拼音默写，不播放语音，写完后点击下一项。</p>
            )}
            <div className="row center">
              <button
                type="button"
                className="subtle"
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
              <button
                type="button"
                className="subtle"
                disabled={busy || !!local.value}
                onClick={() => {
                  playback.current?.stop();
                  clock.current.pause();
                  void save({ phase: "review" });
                }}
              >
                结束并核对答案
              </button>
            </div>
          </>
        )}
      </section>
      {current.phase === "player" && !rest && (
        <details className="panel playback-settings">
          <summary>听写设置与语音（可随时调整）</summary>
          <div className="form-grid">
            <label className="field">
              重复次数
              <select
                value={liveSettings.repeat}
                onChange={(e) => {
                  playback.current?.stop();
                  setLiveSettings((prev) => ({ ...prev, repeat: Number(e.target.value) }));
                }}
              >
                {[1, 2, 3, 4, 5].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              写字间隔（秒）
              <input
                type="number"
                min={1}
                max={30}
                value={liveSettings.interval}
                onChange={(e) => {
                  playback.current?.stop();
                  setLiveSettings((prev) => ({
                    ...prev,
                    interval: Math.min(30, Math.max(1, Number(e.target.value) || 1)),
                  }));
                }}
              />
            </label>
            <label className="field">
              语速
              <select
                value={liveSettings.speed}
                onChange={(e) => {
                  playback.current?.stop();
                  setLiveSettings((prev) => ({ ...prev, speed: Number(e.target.value) }));
                }}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              每组项数
              <select
                value={liveSettings.groupSize}
                onChange={(e) => {
                  playback.current?.stop();
                  setLiveSettings((prev) => ({
                    ...prev,
                    groupSize: Number(e.target.value) as 0 | 5 | 10,
                  }));
                }}
              >
                <option value={5}>五项一组</option>
                <option value={10}>十项一组</option>
                <option value={0}>不分组</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={liveSettings.auto}
                onChange={(e) => {
                  playback.current?.stop();
                  setLiveSettings((prev) => ({ ...prev, auto: e.target.checked }));
                }}
              />
              播完自动下一词
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={liveSettings.adaptiveInterval}
                onChange={(e) => {
                  setLiveSettings((prev) => ({ ...prev, adaptiveInterval: e.target.checked }));
                }}
              />
              长词和句子多留写字时间
            </label>
          </div>
          <p className="small muted">
            支持键盘快捷键：空格键播放 / 暂停，左方向键上一词，右方向键下一词。
          </p>
        </details>
      )}
    </>
  );
}
