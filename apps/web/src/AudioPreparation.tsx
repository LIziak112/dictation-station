import { useEffect, useRef, useState } from "react";
import {
  audioManifestSchema,
  type TaskAudio,
  type TaskPlay,
} from "../../../packages/contract/src/index";
import { request } from "./api";

export interface PreparedAudio {
  clips: { audio: TaskAudio; blob: Blob }[];
  audio: TaskAudio[];
  ready: boolean;
  needsConfirmation: boolean;
}
export async function loadAudio(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("音频读取失败");
  const blob = await response.blob(),
    temporary = URL.createObjectURL(blob),
    probe = new Audio();
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        probe.onloadeddata = null;
        probe.onerror = null;
        signal?.removeEventListener("abort", aborted);
        if (error) reject(error);
        else resolve();
      };
      const aborted = () => finish(new Error("声音准备已取消"));
      const timer = setTimeout(() => finish(new Error("音频检查超时")), 10000);
      probe.onloadeddata = () => finish();
      probe.onerror = () => finish(new Error("本设备无法播放这个音频格式"));
      signal?.addEventListener("abort", aborted, { once: true });
      probe.preload = "auto";
      probe.src = temporary;
      probe.load();
    });
    return blob;
  } finally {
    probe.pause();
    probe.removeAttribute("src");
    probe.load();
    URL.revokeObjectURL(temporary);
  }
}

export function AudioPreparation({
  task,
  compact,
  onPrepared,
}: {
  task: TaskPlay;
  compact: boolean;
  onPrepared: (value: PreparedAudio | null) => void;
}) {
  const [audio, setAudio] = useState<TaskAudio[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [checked, setChecked] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const previewPlayer = useRef<HTMLAudioElement | null>(null);
  async function run() {
    controller.current?.abort();
    const job = new AbortController();
    controller.current = job;
    setBusy(true);
    setMessage("");
    setChecked(0);
    onPrepared(null);
    try {
      let manifest: TaskAudio[];
      if (task.status === "pending")
        manifest = (
          await request(`api/tasks/${task.id}/audio`, audioManifestSchema, {
            method: "POST",
            body: JSON.stringify({}),
            signal: job.signal,
          })
        ).audio;
      else
        manifest = task.audio.length
          ? task.audio
          : task.items
              .filter((item) => item.lang)
              .map((item) => ({
                wordId: item.wordId,
                text: item.audioText,
                lang: item.lang as "en" | "zh",
                id: "device",
                kind: "device",
                url: null,
                source: "设备合成语音",
                sourceUrl: "",
                author: "",
                licenseName: "",
                licenseUrl: "",
                title: "",
                reading: "",
                accent: task.settings.accent,
                warning: "",
              }));
      const clips: PreparedAudio["clips"] = [],
        failed: string[] = [];
      async function check(voices: TaskAudio[]) {
        const result: TaskAudio[] = [];
        for (let offset = 0; offset < voices.length; offset += 3) {
          result.push(
            ...(await Promise.all(
              voices.slice(offset, offset + 3).map(async (voice): Promise<TaskAudio> => {
                if (job.signal.aborted) throw new Error("声音准备已取消");
                try {
                  if (voice.url) {
                    const cached = clips.find(
                      (clip) => clip.audio.wordId === voice.wordId && clip.audio.url === voice.url,
                    );
                    if (!cached)
                      clips.push({ audio: voice, blob: await loadAudio(voice.url, job.signal) });
                  } else if (!("speechSynthesis" in window) && voice.kind !== "unavailable")
                    throw new Error("设备不支持朗读");
                  return voice;
                } catch (e) {
                  failed.push(voice.wordId);
                  return {
                    ...voice,
                    kind: "unavailable",
                    warning: e instanceof Error ? e.message : "声音不可用",
                  };
                } finally {
                  if (!job.signal.aborted) setChecked((value) => value + 1);
                }
              }),
            )),
          );
        }
        return result;
      }
      let verified = await check(manifest);
      if (failed.length && task.status === "pending" && !job.signal.aborted) {
        const fallback = await request(`api/tasks/${task.id}/audio`, audioManifestSchema, {
          method: "POST",
          body: JSON.stringify({ fallbackIds: failed }),
          signal: job.signal,
        });
        manifest = fallback.audio;
        setChecked(0);
        verified = await check(manifest);
      }
      if (job.signal.aborted) return;
      setAudio(verified);
      const ready = verified.every((voice) => voice.kind !== "unavailable");
      if (!ready) setMessage("部分声音暂不可用，请重试；已开始的任务可复制后重新准备。");
      onPrepared({
        audio: verified,
        clips: clips.filter((clip) =>
          verified.some(
            (voice) =>
              voice.wordId === clip.audio.wordId &&
              voice.url === clip.audio.url &&
              voice.kind !== "unavailable",
          ),
        ),
        ready,
        needsConfirmation: verified.some((voice) => voice.warning.includes("指定读音")),
      });
    } catch (e) {
      if (!job.signal.aborted) setMessage(e instanceof Error ? e.message : "声音准备失败，请重试");
    } finally {
      if (!job.signal.aborted) setBusy(false);
    }
  }
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    void latest.current();
    return () => {
      controller.current?.abort();
      previewPlayer.current?.pause();
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    };
  }, []);
  useEffect(() => {
    if (task.status === "in_progress") {
      previewPlayer.current?.pause();
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    }
  }, [task.status]);
  const visible = audio.filter((voice) => task.items.some((item) => item.wordId === voice.wordId));
  return (
    <section className="panel audio-preparation">
      <h2>准备声音</h2>
      {busy ? (
        <p role="status">
          正在检查声音 {checked}/{task.items.filter((item) => item.lang).length}…
        </p>
      ) : (
        <p role="status">
          真人 {visible.filter((voice) => voice.kind === "human").length} · 合成{" "}
          {visible.filter((voice) => voice.kind === "server" || voice.kind === "device").length} ·
          不可用 {visible.filter((voice) => voice.kind === "unavailable").length}
        </p>
      )}
      {message && <p role="alert">{message}</p>}
      {!busy && (
        <button type="button" onClick={() => void run()}>
          重新准备声音
        </button>
      )}
      {!compact && !!visible.length && (
        <details>
          <summary>查看每项的发音来源</summary>
          <div className="source-audio-list">
            {visible.map((voice) => (
              <article className="word-row" key={voice.wordId}>
                <div>
                  <strong>{voice.text}</strong>
                  <p>
                    {voice.source} ·{" "}
                    {voice.accent === "uk"
                      ? "英音"
                      : voice.accent === "us"
                        ? "美音"
                        : voice.accent === "zh"
                          ? "普通话"
                          : voice.accent}{" "}
                    {voice.reading}
                  </p>
                  {voice.warning && <p>{voice.warning}</p>}
                  {voice.kind === "human" && (
                    <p className="small muted">
                      {voice.author} · {voice.title} ·{" "}
                      <a href={voice.sourceUrl} target="_blank" rel="noreferrer">
                        来源
                      </a>{" "}
                      ·{" "}
                      <a href={voice.licenseUrl} target="_blank" rel="noreferrer">
                        {voice.licenseName}
                      </a>{" "}
                      · 原文件未修改，播放可调速
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={voice.kind === "unavailable" || task.status === "in_progress"}
                  onClick={() => {
                    previewPlayer.current?.pause();
                    if ("speechSynthesis" in window) speechSynthesis.cancel();
                    if (voice.url) {
                      const player = new Audio(voice.url);
                      previewPlayer.current = player;
                      player.play().catch(() => setMessage("试听失败，请再点一次"));
                    } else if ("speechSynthesis" in window) {
                      speechSynthesis.cancel();
                      const utterance = new SpeechSynthesisUtterance(voice.text);
                      utterance.lang =
                        voice.lang === "zh" ? "zh-CN" : voice.accent === "uk" ? "en-GB" : "en-US";
                      speechSynthesis.speak(utterance);
                    }
                  }}
                >
                  试听
                </button>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
