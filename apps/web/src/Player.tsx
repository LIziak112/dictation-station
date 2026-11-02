import { useEffect, useRef, useState } from "react";
import { type Batch, MODES, type Progress } from "../../../packages/contract/src/index";
import { createQueue, Playback } from "../../../packages/core/src/player";
import { mergeReview } from "../../../packages/core/src/review";
import { api } from "./api";
import { BrowserAudio } from "./audio";

export function Player({
  batch,
  progress,
  onChange,
  onBack,
  ttsEnabled,
  autoStart,
}: {
  batch: Batch;
  progress: Progress;
  onChange: (p: Progress) => boolean;
  onBack: () => void;
  ttsEnabled: boolean;
  autoStart: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState("");
  const [reveal, setReveal] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const ref = useRef(progress);
  ref.current = progress;
  const driver = useRef<BrowserAudio | null>(null);
  const playback = useRef<Playback | null>(null);
  const task = useRef<AbortController | null>(null);
  const entries = progress.ids.flatMap((id) => {
    const e = batch.entries.find((e) => e.id === id);
    return e ? [e] : [];
  });
  const queue = createQueue(entries, progress.mode);
  const q = queue[progress.index];
  const initial = useRef({ autoStart, progress, queue, onChange });
  useEffect(() => {
    const { autoStart, progress, queue, onChange } = initial.current;
    const audio = new BrowserAudio();
    driver.current = audio;
    const player = new Playback(audio, (value, error) => {
      setPlaying(value);
      if (error) setMessage(error);
    });
    playback.current = player;
    if (
      autoStart &&
      ["en2en", "zh_dictation"].includes(progress.mode) &&
      progress.phase === "player"
    )
      void player.play(queue, progress.index, progress.settings, (index) =>
        onChange({ ...ref.current, index }),
      );
    function hide() {
      if (document.hidden) {
        player.stop();
        setMessage("已暂停，返回后点击播放继续");
      }
    }
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      task.current?.abort();
      player.stop();
      audio.dispose();
    };
  }, []);
  const update = (patch: Partial<Progress>) => {
    const previous = ref.current;
    const wrongIds =
      patch.results && patch.ids === undefined
        ? mergeReview(previous.wrongIds, previous.ids, patch.results)
        : previous.wrongIds;
    return onChange({ ...previous, wrongIds, ...patch });
  };
  function stop() {
    playback.current?.stop();
  }
  function play() {
    if (!q?.audioText) return;
    if (playing) {
      stop();
      return;
    }
    setMessage("");
    void playback.current?.play(queue, progress.index, progress.settings, (index) => {
      update({ index });
      setReveal(false);
    });
  }
  function move(index: number) {
    stop();
    setReveal(false);
    update({ index });
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (ref.current.phase !== "player") return;
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
        play();
      }
      if (event.key === "ArrowLeft" && ref.current.index > 0) move(ref.current.index - 1);
      if (event.key === "ArrowRight" && ref.current.index < queue.length - 1)
        move(ref.current.index + 1);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function prepare() {
    stop();
    const controller = new AbortController();
    task.current = controller;
    setPreparing(true);
    setPrepared(false);
    const items = [
      ...new Map(
        queue
          .filter((x) => x.lang && x.audioText)
          .map((x) => [
            `${x.lang}|${x.audioText}`,
            { text: x.audioText, lang: x.lang as "en" | "zh" },
          ]),
      ).values(),
    ];
    try {
      for (let i = 0; i < items.length; i += 6) {
        setMessage(`准备语音 ${i}/${items.length}`);
        const result = await api.tts(items.slice(i, i + 6), controller.signal);
        for (const item of result.items) {
          if (!item.url) throw new Error("部分语音准备失败，可重试或使用设备朗读");
          if (!/^audio\/[a-f0-9]{40}\.mp3$/.test(item.url)) throw new Error("音频地址无效");
          const r = await fetch(item.url, { signal: controller.signal });
          if (!r.ok) throw new Error("音频下载失败，请重试");
          const blob = await r.blob();
          if (controller.signal.aborted) return;
          driver.current?.cache(item.text, item.lang, blob);
        }
      }
      if (!controller.signal.aborted) {
        setPrepared(true);
        setMessage(`已准备 ${items.length} 条音频，本次播放无需再下载`);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : "语音准备失败，请重试");
    } finally {
      if (!controller.signal.aborted) setPreparing(false);
    }
  }
  if (!q)
    return (
      <div className="notice">
        进度与词表不一致，请返回重新开始。
        <button type="button" onClick={onBack}>
          返回词表
        </button>
      </div>
    );
  if (progress.phase === "result") {
    const results = progress.results;
    const wrong = progress.ids.filter((id) => results[id] === false);
    const checked = Object.keys(results).length;
    const markAll = (value?: boolean) =>
      update({
        results:
          value === undefined ? {} : Object.fromEntries(progress.ids.map((id) => [id, value])),
      });
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">核对与重练</p>
            <h1>写完了，来对答案</h1>
            <p>
              {batch.title} · {MODES[progress.mode].label}
            </p>
          </div>
          <button type="button" onClick={onBack}>
            返回词表
          </button>
        </div>
        <section className="panel">
          <div className="result-stats" role="status">
            <strong>
              已核对 {checked}/{queue.length}
            </strong>
            <span>正确 {Object.values(results).filter(Boolean).length}</span>
            <span>错误 {wrong.length}</span>
            <span>未核对 {queue.length - checked}</span>
          </div>
          <div className="row">
            <button type="button" onClick={() => markAll(true)}>
              全部正确
            </button>
            <button type="button" onClick={() => markAll(false)}>
              全部错误
            </button>
            <button type="button" onClick={() => markAll()}>
              清空标记
            </button>
          </div>
          <div className="results">
            {queue.map((item, i) => (
              <article className="result-item" key={item.entry.id}>
                <div>
                  <span className="small muted">{i + 1}</span>
                  <h2>{item.answer}</h2>
                  <p>
                    {item.prompt && item.prompt !== item.answer
                      ? item.prompt
                      : item.entry.en || item.entry.zh}
                    {item.entry.pinyin ? ` · ${item.entry.pinyin}` : ""}
                  </p>
                  {!!item.entry.alt.length && (
                    <p className="small muted">其他写法：{item.entry.alt.join("、")}</p>
                  )}
                </div>
                <div className="row">
                  <button
                    type="button"
                    aria-pressed={results[item.entry.id] === true}
                    onClick={() => update({ results: { ...results, [item.entry.id]: true } })}
                    aria-label={`第 ${i + 1} 词${results[item.entry.id] === true ? "已标正确" : "正确"}`}
                  >
                    {results[item.entry.id] === true ? "✓ 已标正确" : "✓ 正确"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={results[item.entry.id] === false}
                    onClick={() => update({ results: { ...results, [item.entry.id]: false } })}
                    aria-label={`第 ${i + 1} 词${results[item.entry.id] === false ? "已标错误" : "错误"}`}
                  >
                    {results[item.entry.id] === false ? "× 已标错误" : "× 错误"}
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => update({ index: 0, phase: "player", results: {} })}
            >
              整份再练一次
            </button>
            <button
              type="button"
              className="primary"
              disabled={!wrong.length}
              onClick={() => update({ ids: wrong, index: 0, phase: "player", results: {} })}
            >
              只练错词（{wrong.length}）
            </button>
          </div>
          <p className="small muted">结果是本人核对记录，保存在本设备，不代表自动判分。</p>
        </section>
      </>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{MODES[progress.mode].label}</p>
          <h1>{batch.title}</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            stop();
            onBack();
          }}
        >
          暂存并返回
        </button>
      </div>
      <section className="player-panel panel">
        <div className="row between">
          <span className="muted">
            第 {progress.index + 1} / {queue.length} 词
          </span>
          <span className="small muted">{prepared ? "已下载的服务器语音" : "设备朗读"}</span>
        </div>
        <progress value={progress.index + 1} max={queue.length} aria-label="听写进度" />
        <div className="prompt">
          <p className="eyebrow">{MODES[progress.mode].description}</p>
          <h2>{q.prompt || "听一听，写下来"}</h2>
          {q.entry.hint && <p>语境：{q.entry.hint}</p>}
          {reveal && <p className="answer">{q.answer}</p>}
        </div>
        <div className="play-controls">
          <button
            type="button"
            disabled={progress.index === 0 || preparing}
            onClick={() => move(progress.index - 1)}
          >
            上一词
          </button>
          <button
            type="button"
            className="primary play-button"
            disabled={!q.audioText || preparing}
            aria-pressed={playing}
            onClick={play}
          >
            {playing ? "停止播放" : "播放 / 重播"}
          </button>
          <button
            type="button"
            disabled={progress.index === queue.length - 1 || preparing}
            onClick={() => move(progress.index + 1)}
          >
            下一词
          </button>
        </div>
        {!q.audioText && <p className="muted center">此模式不播放语音，写完后点击下一词。</p>}
        <div className="row center">
          <button
            type="button"
            className="subtle"
            aria-pressed={reveal}
            onClick={() => setReveal(!reveal)}
          >
            {reveal ? "收起答案" : "临时查看答案"}
          </button>
          <button
            type="button"
            className="subtle"
            onClick={() => {
              stop();
              update({ phase: "result" });
            }}
          >
            结束并核对答案
          </button>
        </div>
      </section>
      <details className="panel playback-settings">
        <summary>听写设置与语音</summary>
        <div className="form-grid">
          <label className="field">
            重复次数
            <select
              value={progress.settings.repeat}
              onChange={(e) => {
                stop();
                update({ settings: { ...progress.settings, repeat: Number(e.target.value) } });
              }}
            >
              {[1, 2, 3, 4, 5].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            写字间隔（秒）
            <input
              type="number"
              min={1}
              max={30}
              value={progress.settings.interval}
              onChange={(e) => {
                stop();
                update({
                  settings: {
                    ...progress.settings,
                    interval: Math.min(30, Math.max(1, Number(e.target.value) || 1)),
                  },
                });
              }}
            />
          </label>
          <label className="field">
            语速
            <select
              value={progress.settings.speed}
              onChange={(e) => {
                stop();
                update({ settings: { ...progress.settings, speed: Number(e.target.value) } });
              }}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={progress.settings.auto}
              onChange={(e) => {
                stop();
                update({ settings: { ...progress.settings, auto: e.target.checked } });
              }}
            />
            播完自动下一词
          </label>
        </div>
        <p className="small muted">
          默认使用设备朗读，发音取决于系统语音。服务器语音是可选项，需要联网准备；实际读音请先试听。
        </p>
        {ttsEnabled && q.audioText && (
          <button type="button" disabled={preparing} onClick={prepare}>
            {preparing ? "正在准备…" : prepared ? "重新准备服务器语音" : "准备服务器语音"}
          </button>
        )}
      </details>
      <div role="status" aria-atomic="true">
        {message && <p className="notice">{message}</p>}
      </div>
    </>
  );
}
