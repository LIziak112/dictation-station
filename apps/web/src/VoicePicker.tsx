import { useState } from "react";
import {
  type Entry,
  type Voice,
  voiceResponseSchema,
  voicesResponseSchema,
} from "../../../packages/contract/src/index";
import { request } from "./api";

export function VoicePicker({
  entry,
  onSelect,
  onPreview,
}: {
  entry: Entry;
  onSelect: (lang: "en" | "zh", reading: string) => void;
  onPreview: (lang: "en" | "zh", accent: "us" | "uk", voice: Voice) => Promise<void>;
}) {
  const [lang, setLang] = useState<"en" | "zh">(entry.en ? "en" : "zh");
  const [accent, setAccent] = useState<"us" | "uk">("us");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = entry.readings[lang];
  return (
    <details>
      <summary>
        真人读音与来源 ·{" "}
        {selected ? `已指定 ${selected}` : voices.length ? "已找到候选" : "尚未查询"}
      </summary>
      <div className="form-grid">
        <label className="field">
          发音语言
          <select
            value={lang}
            onChange={(e) => {
              setLang(e.target.value as "en" | "zh");
              setVoices([]);
            }}
          >
            {entry.en && <option value="en">英语</option>}
            {entry.zh && <option value="zh">普通话</option>}
          </select>
        </label>
        {lang === "en" && (
          <label className="field">
            口音
            <select
              value={accent}
              onChange={(e) => {
                setAccent(e.target.value as "us" | "uk");
                setVoices([]);
              }}
            >
              <option value="us">美音</option>
              <option value="uk">英音</option>
            </select>
          </label>
        )}
      </div>
      <p className="small muted">
        仅把这个词发送给所选词典查询；中文按已确认拼音查词典录音，也支持部署者词书索引。
      </p>
      <button
        type="button"
        disabled={busy || !entry[lang]}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const result = await request("api/pronunciation/options", voicesResponseSchema, {
              method: "POST",
              body: JSON.stringify({
                text: entry[lang],
                pinyin: entry.pinyin,
                lang,
                accent,
                reading: "",
              }),
            });
            setVoices(result.voices);
            if (!result.voices.length)
              setMessage("没有匹配的真人录音，可试听合成兜底或检查本地词书索引。");
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "查询失败，请重试");
          } finally {
            setBusy(false);
          }
        }}
      >
        查找真人读音
      </button>
      {message && <p role="status">{message}</p>}
      {!!entry.readings[lang] && (
        <p className="small">
          当前指定：{entry.readings[lang]}{" "}
          <button type="button" onClick={() => onSelect(lang, "")}>
            恢复自动匹配
          </button>
        </p>
      )}
      {voices.map((voice) => (
        <div className="voice-option" key={voice.id}>
          <p>
            {voice.reading || voice.id} ·{" "}
            {voice.accent === "uk"
              ? "英音"
              : voice.accent === "us"
                ? "美音"
                : voice.accent === "zh"
                  ? "普通话"
                  : voice.accent}{" "}
            · {voice.author}
          </p>
          <p className="small">
            <a href={voice.sourceUrl} target="_blank" rel="noreferrer">
              来源
            </a>{" "}
            ·{" "}
            <a href={voice.licenseUrl} target="_blank" rel="noreferrer">
              {voice.licenseName}
            </a>
          </p>
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await request("api/pronunciation/preview", voiceResponseSchema, {
                    method: "POST",
                    body: JSON.stringify({
                      text: entry[lang],
                      pinyin: entry.pinyin,
                      lang,
                      accent,
                      reading: voice.id,
                    }),
                  });
                  await onPreview(lang, accent, result.voice);
                  setMessage(result.voice.warning || "试听结束，请按作业语境确认读音");
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "试听失败");
                } finally {
                  setBusy(false);
                }
              }}
            >
              试听这个读音
            </button>
            <button
              type="button"
              aria-pressed={entry.readings[lang] === voice.id}
              onClick={() => onSelect(lang, voice.id)}
            >
              使用这个读音
            </button>
          </div>
        </div>
      ))}
    </details>
  );
}
