import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Batch, defaultSettings, type Voice } from "../../../packages/contract/src/index";
import { listeningQueue } from "../../../packages/core/src/listen";
import { Playback } from "../../../packages/core/src/player";
import { BrowserAudio } from "./audio";
import { prepareVoice } from "./prepared-voice";

export function ListeningPractice({
  batch,
  follow,
  onBack,
}: {
  batch: Batch;
  follow: boolean;
  onBack: () => void;
}) {
  const [language, setLanguage] = useState<"en" | "zh" | "both">(
    follow ? (batch.entries.some((e) => e.en) ? "en" : "zh") : "both",
  );
  const [shuffle, setShuffle] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [accent, setAccent] = useState<"us" | "uk">("us");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [ready, setReady] = useState(false);
  const [clip, setClip] = useState("");
  const [recording, setRecording] = useState(false);
  const [openingMic, setOpeningMic] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const queue = useMemo(
    () => listeningQueue(batch.entries, language, shuffle),
    [batch, language, shuffle],
  );
  const driver = useRef<BrowserAudio | null>(null);
  const playback = useRef<Playback | null>(null);
  const job = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const microphone = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipUrl = useRef("");
  const replay = useRef<HTMLAudioElement | null>(null);
  const mounted = useRef(false);
  const recordingEpoch = useRef(0);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  function stop() {
    generation.current++;
    playback.current?.stop();
    replay.current?.pause();
    setReplaying(false);
  }
  function clearClip() {
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    clipUrl.current = "";
    setClip("");
  }
  const stopRecording = useCallback((discard = false) => {
    if (discard) recordingEpoch.current++;
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
    microphone.current?.getTracks().forEach((track) => {
      track.stop();
    });
    microphone.current = null;
    setRecording(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const audio = new BrowserAudio();
    driver.current = audio;
    playback.current = new Playback(audio, (value, error) => {
      if (!mounted.current) return;
      setPlaying(value);
      if (error) {
        generation.current++;
        setMessage(error);
      }
    });
    const hidden = () => {
      if (follow && document.hidden) {
        generation.current++;
        playback.current?.stop();
        replay.current?.pause();
        setReplaying(false);
        stopRecording(true);
        setMessage("已暂停。回到页面后可以重新示范或录音。");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted.current = false;
      generation.current++;
      recordingEpoch.current++;
      job.current?.abort();
      audio.dispose();
      replay.current?.pause();
      stopRecording(true);
      if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [follow, stopRecording]);
  useEffect(() => {
    const controller = new AbortController();
    job.current = controller;
    setReady(false);
    setVoices([]);
    setIndex(0);
    setMessage("");
    setBusy(true);
    driver.current?.clearCache();
    driver.current?.setAccent(accent);
    async function prepare() {
      const result: Voice[] = [];
      try {
        for (let offset = 0; offset < queue.length; offset += 3) {
          const group = await Promise.all(
            queue.slice(offset, offset + 3).map(async (item) => {
              const prepared = await prepareVoice(
                {
                  text: item.audioText,
                  lang: item.lang,
                  reading: item.reading,
                  pinyin: item.entry.pinyin,
                  accent,
                },
                controller.signal,
              );
              if (!controller.signal.aborted && prepared.blob)
                driver.current?.cache(item.audioText, item.lang, prepared.blob, item.audioKey);
              return prepared.voice;
            }),
          );
          result.push(...group);
        }
        if (!controller.signal.aborted) {
          setVoices(result);
          setReady(true);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setMessage(error instanceof Error ? error.message : "声音准备失败，请重新进入");
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void prepare();
    return () => {
      controller.abort();
      generation.current++;
      playback.current?.stop();
    };
  }, [queue, accent]);
  async function play() {
    stop();
    const run = generation.current;
    let start = index;
    do {
      setIndex(start);
      await playback.current?.play(
        queue,
        start,
        {
          ...defaultSettings,
          auto: !follow,
          repeat: 1,
          interval: 1,
          speed,
          groupSize: 0,
          adaptiveInterval: false,
        },
        setIndex,
      );
      if (generation.current !== run) return;
      start = 0;
    } while (!follow && loopRef.current);
  }
  async function record() {
    stop();
    clearClip();
    setMessage("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("当前浏览器无法录音，请使用 HTTPS 或本机地址，并允许麦克风；仍可播放示范。");
      return;
    }
    const epoch = ++recordingEpoch.current;
    setOpeningMic(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || epoch !== recordingEpoch.current || document.hidden) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      microphone.current = stream;
      const capture = new MediaRecorder(stream);
      recorder.current = capture;
      const chunks: Blob[] = [];
      capture.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      capture.onerror = () => {
        stopRecording(true);
        setMessage("录音失败，请重新录制。");
      };
      capture.onstop = () => {
        if (mounted.current && epoch === recordingEpoch.current && chunks.length) {
          const url = URL.createObjectURL(new Blob(chunks, { type: capture.mimeType }));
          clipUrl.current = url;
          setClip(url);
        }
      };
      capture.start();
      setRecording(true);
      timer.current = setTimeout(() => stopRecording(), 30000);
    } catch {
      microphone.current?.getTracks().forEach((track) => {
        track.stop();
      });
      microphone.current = null;
      if (mounted.current && epoch === recordingEpoch.current)
        setMessage("未能开启麦克风，请检查浏览器权限；仍可播放示范。");
    } finally {
      if (mounted.current) setOpeningMic(false);
    }
  }
  const locked = recording || openingMic;
  const voice = voices[index];
  return (
    <main className="practice-page">
      <button type="button" onClick={onBack}>
        返回词表
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{batch.title}</p>
          <h1>{follow ? "听一听，跟着读" : "放下屏幕，听一听"}</h1>
          <p>
            {follow
              ? "先听示范，再录下自己的声音，回放比较。录音仅留在当前页面。"
              : "选好内容后连续播放。锁屏和后台播放取决于浏览器与系统。"}
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="form-grid">
          <label className="field">
            英语口音
            <select
              disabled={locked}
              value={accent}
              onChange={(event) => {
                stop();
                setAccent(event.target.value as "us" | "uk");
              }}
            >
              <option value="us">美音</option>
              <option value="uk">英音</option>
            </select>
          </label>
          <label className="field">
            播放语言
            <select
              disabled={locked}
              value={language}
              onChange={(event) => {
                stop();
                clearClip();
                setLanguage(event.target.value as typeof language);
              }}
            >
              <option value="en">英语</option>
              <option value="zh">普通话</option>
              {!follow && <option value="both">中英交替</option>}
            </select>
          </label>
          <label className="field">
            语速
            <select
              disabled={locked || playing}
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              {[0.75, 1, 1.25].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
          {!follow && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={shuffle}
                  onChange={(event) => {
                    stop();
                    setShuffle(event.target.checked);
                  }}
                />
                打乱词序
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={loop}
                  onChange={(event) => setLoop(event.target.checked)}
                />
                循环播放
              </label>
            </>
          )}
        </div>
        {busy && <p role="status">正在准备声音…</p>}
        {!busy && !queue.length && <p role="status">词表没有这种语言，请切换语言。</p>}
        {message && <p role="alert">{message}</p>}
        <p className="eyebrow" aria-live="polite">
          {queue.length ? `${index + 1} / ${queue.length}` : "0 / 0"}
        </p>
        <h2 className="practice-word">{queue[index]?.audioText}</h2>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={!ready || !queue.length || locked || playing}
            onClick={() => void play()}
          >
            {follow ? "播放示范" : "开始播放"}
          </button>
          <button type="button" disabled={!playing && !replaying} onClick={stop}>
            暂停播放
          </button>
          {follow && (
            <>
              <button
                type="button"
                disabled={openingMic || !queue.length}
                onClick={() => (recording ? stopRecording() : void record())}
              >
                {recording ? "结束录音" : "录下我的跟读"}
              </button>
              <button
                type="button"
                disabled={!clip || locked || replaying}
                onClick={() => {
                  stop();
                  const audio = new Audio(clip);
                  replay.current = audio;
                  setReplaying(true);
                  audio.onended = () => setReplaying(false);
                  audio.onerror = () => {
                    setReplaying(false);
                    setMessage("录音无法回放，请重新录制。");
                  };
                  void audio.play().catch(() => {
                    setReplaying(false);
                    setMessage("回放失败，请再点一次。");
                  });
                }}
              >
                回放我的录音
              </button>
            </>
          )}
        </div>
        {recording && <p role="status">正在录音，最长 30 秒；读完后点“结束录音”。</p>}
        {openingMic && <p role="status">请在浏览器中允许麦克风…</p>}
        <div className="row">
          <button
            type="button"
            disabled={locked || index === 0}
            onClick={() => {
              stop();
              clearClip();
              setIndex(index - 1);
            }}
          >
            上一个
          </button>
          <button
            type="button"
            disabled={locked || index >= queue.length - 1}
            onClick={() => {
              stop();
              clearClip();
              setIndex(index + 1);
            }}
          >
            下一个
          </button>
        </div>
        {voice && (
          <div className="notice">
            <p>
              {voice.source} {voice.warning}
            </p>
            {voice.kind === "human" && (
              <p className="small">
                {voice.author} ·{" "}
                <a href={voice.sourceUrl} target="_blank" rel="noreferrer">
                  录音来源
                </a>{" "}
                ·{" "}
                <a href={voice.licenseUrl} target="_blank" rel="noreferrer">
                  {voice.licenseName}
                </a>{" "}
                · 原文件未修改，播放可调速
              </p>
            )}
          </div>
        )}
        <p className="small muted">
          {follow
            ? "离开页面会清除录音。这里不自动评分，也不改变掌握状态。"
            : "纯听不计入听写记录或掌握状态。"}
        </p>
      </section>
    </main>
  );
}
