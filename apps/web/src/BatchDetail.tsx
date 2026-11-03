import { ArrowLeft, Send, Volume2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import {
  type Batch,
  type Entry,
  MODES,
  type Mode,
  type Settings,
  voiceResponseSchema,
} from "../../../packages/contract/src/index";
import { createQueue } from "../../../packages/core/src/player";
import { localDate } from "../../../packages/core/src/scheduling";
import { selectRange } from "../../../packages/core/src/tasks";
import { loadAudio } from "./AudioPreparation";
import { api, exportBatch, request } from "./api";
import { BrowserAudio } from "./audio";
import { RepeatInterval } from "./RepeatInterval";
import { taskApi } from "./task-api";

interface Props {
  batch: Batch;
  mode: Mode;
  setMode: (m: Mode) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  onEdit: () => void;
  onTask?: () => void;
  onDispatched?: (taskId: string) => void;
  onPractice?: (follow: boolean) => void;
  onBack: () => void;
  onNotice: (s: string) => void;
}
export function BatchDetail({
  batch,
  mode,
  setMode,
  settings,
  setSettings,
  onEdit,
  onTask,
  onDispatched,
  onPractice,
  onBack,
  onNotice,
}: Props) {
  const [qr, setQr] = useState("");
  const [share, setShare] = useState("");
  const [range, setRange] = useState(`1-${batch.entries.length}`);
  const [reviewCount, setReviewCount] = useState(3);
  const [allowSelfReview, setAllowSelfReview] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const audioRef = useRef<BrowserAudio | null>(null);

  useEffect(() => {
    setRange(`1-${batch.entries.length}`);
  }, [batch.entries.length]);

  useEffect(() => {
    audioRef.current = new BrowserAudio(settings.accent);
    return () => audioRef.current?.dispose();
  }, [settings.accent]);

  async function previewEntryVoice(entry: Entry) {
    const lang: "en" | "zh" = entry.en ? "en" : "zh";
    const text = entry[lang];
    if (!text) return;
    try {
      const { voice } = await request("api/pronunciation/preview", voiceResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          wordId: entry.wordId,
          text,
          lang,
          accent: settings.accent,
          reading: entry.readings[lang] || entry.reading,
          pinyin: lang === "zh" ? entry.pinyin : undefined,
        }),
      });
      if (voice.url) {
        const blob = await loadAudio(voice.url);
        audioRef.current?.cache(text, lang, blob, entry.id);
      }
      await audioRef.current?.speak(text, lang, 1, entry.id);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "试听失败");
    }
  }

  async function dispatchToChild() {
    setDispatching(true);
    try {
      const picked = selectRange(batch.entries, range);
      const validEntries = picked.filter((entry) => entry.modes.includes(mode));
      if (!validEntries.length) {
        onNotice("所选范围内没有支持当前练法的词条，请调整范围或练法");
        return;
      }
      const today = localDate(new Date(), "Asia/Shanghai");
      const { task } = await taskApi.create({
        title: batch.title,
        date: today,
        mode,
        settings,
        selections: [{ batchId: batch.id, entryIds: validEntries.map((e) => e.id) }],
        wordIds: [],
        reviewCount,
        allowSelfReview,
        reviewOnly: false,
      });
      if (onDispatched) {
        onDispatched(task.id);
      } else {
        location.hash = `task=${task.id}`;
      }
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "派发任务失败，请重试");
    } finally {
      setDispatching(false);
    }
  }

  return (
    <>
      <button type="button" className="back-link subtle" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        全部词表
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {batch.entries.length} 词 ·{" "}
            {[batch.grade, batch.unit].filter(Boolean).join(" · ") || "听写词表"}
          </p>
          <h1>{batch.title}</h1>
          <p>核对读音后，选择练法与范围，一键派发到孩子听写区。</p>
        </div>
        <div className="row">
          <button type="button" onClick={() => onEdit()}>
            编辑词表
          </button>
          {onTask && (
            <button type="button" onClick={onTask}>
              多词表组合排课
            </button>
          )}
        </div>
      </div>
      <section className="panel">
        <div className="row between section-head">
          <div>
            <h2>01 / 派发到孩子听写区</h2>
            <p className="small muted">
              派发后任务将直接进入孩子端「今日待听写」队列，同时自动锁定词表快照与发音。
            </p>
          </div>
          {onPractice && (
            <div className="row">
              <button type="button" onClick={() => onPractice(false)}>
                纯听这份词表
              </button>
              <button type="button" onClick={() => onPractice(true)}>
                跟读练口语
              </button>
            </div>
          )}
        </div>
        <div className="mode-grid">
          {(Object.keys(MODES) as Mode[])
            .filter((m) => batch.entries.some((e) => e.modes.includes(m)))
            .map((m) => (
              <button
                type="button"
                className="mode-card"
                aria-pressed={mode === m}
                key={m}
                onClick={() => setMode(m)}
              >
                <strong>{MODES[m].label}</strong>
                {mode === m && <span className="selected-label">✓ 已选择</span>}
                <span>
                  {MODES[m].description} · {createQueue(batch.entries, m).length} 词
                </span>
              </button>
            ))}
        </div>
        <div className="form-grid">
          <div className="field">
            <div className="row between">
              <label htmlFor="dispatch-range-input">本次派发编号范围</label>
              <button
                type="button"
                className="subtle small-btn"
                onClick={() => setRange(`1-${batch.entries.length}`)}
              >
                全选（1-{batch.entries.length}）
              </button>
            </div>
            <input
              id="dispatch-range-input"
              value={range}
              placeholder={`1-${batch.entries.length} 或 1,3,5`}
              onChange={(e) => setRange(e.target.value)}
            />
          </div>
          <label className="field">
            穿插待巩固旧词上限
            <input
              type="number"
              min={0}
              max={20}
              value={reviewCount}
              onChange={(e) =>
                setReviewCount(Math.min(20, Math.max(0, Number(e.target.value) || 0)))
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={allowSelfReview}
              onChange={(e) => setAllowSelfReview(e.target.checked)}
            />
            允许孩子交卷后自主核对答案（家长抽查 1–2 词）
          </label>
        </div>
        <details className="setup-settings">
          <summary>调整重复、语速与顺序</summary>
          <div className="form-grid">
            <label className="field">
              重复次数
              <select
                value={settings.repeat}
                onChange={(e) => setSettings({ ...settings, repeat: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <RepeatInterval
              value={settings.repeatInterval}
              onChange={(repeatInterval) => setSettings({ ...settings, repeatInterval })}
            />
            <label className="field">
              写字间隔（秒）
              <input
                type="number"
                min={1}
                max={30}
                value={settings.interval}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    interval: Math.min(30, Math.max(1, Number(e.target.value) || 1)),
                  })
                }
              />
            </label>
            <label className="field">
              语速
              <select
                value={settings.speed}
                onChange={(e) => setSettings({ ...settings, speed: Number(e.target.value) })}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((n) => (
                  <option key={n} value={n}>
                    {n}×
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.shuffle}
                onChange={(e) => setSettings({ ...settings, shuffle: e.target.checked })}
              />
              打乱顺序
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.auto}
                onChange={(e) => setSettings({ ...settings, auto: e.target.checked })}
              />
              播完自动下一词
            </label>
          </div>
        </details>
        <div className="row start-row">
          <button
            type="button"
            className="primary"
            disabled={dispatching}
            onClick={() => void dispatchToChild()}
          >
            <Send size={16} aria-hidden="true" />
            {dispatching ? "正在派发…" : "派发到孩子听写区"}
          </button>
          <span className="small muted">
            {MODES[mode].audio
              ? "派发后自动预检真人/合成语音，孩子平板扫码即可开练"
              : "此模式看拼音默写，不播放语音"}
          </span>
        </div>
      </section>
      <section className="panel">
        <div className="row between">
          <h2>02 / 词表预览与导出</h2>
          <button type="button" onClick={() => exportBatch(batch)}>
            导出词表 JSON
          </button>
        </div>
        <div className="word-list">
          {batch.entries.map((e, i) => (
            <div key={e.id} className="word-list-row">
              <span className="entry-index">{i + 1}</span>
              <strong>{e.en || e.zh}</strong>
              <span>{e.en ? e.zh : e.pinyin}</span>
              {e.en && e.pinyin && <span className="small muted">{e.pinyin}</span>}
              {e.hint && <span className="small muted">提示：{e.hint}</span>}
              <span className="small muted voice-tag">
                {e.readings.en || e.readings.zh || e.reading
                  ? `指定读音：${e.readings.en || e.readings.zh || e.reading}`
                  : "自动匹配真人/合成读音"}
              </span>
              <button
                type="button"
                className="subtle icon-btn"
                aria-label={`试听第 ${i + 1} 词`}
                onClick={() => void previewEntryVoice(e)}
              >
                <Volume2 size={14} aria-hidden="true" />
                试听
              </button>
            </div>
          ))}
        </div>
      </section>
      <div className="row">
        <button
          type="button"
          onClick={async () => {
            const url = new URL(location.href);
            url.search = "";
            url.hash = `batch=${batch.id}`;
            setShare(url.href);
            setQr(await QRCode.toDataURL(url.href, { width: 220, margin: 2 }));
          }}
        >
          本账号链接 / 二维码
        </button>
        <button
          type="button"
          className="danger subtle"
          onClick={async () => {
            if (!confirm("确定删除这份词表？删除后本账号链接将失效，但已派发的任务不受影响。"))
              return;
            try {
              await api.remove(batch);
              onBack();
            } catch (e) {
              onNotice(e instanceof Error ? e.message : "删除失败，请重试");
            }
          }}
        >
          删除词表
        </button>
      </div>
      {share && (
        <section className="panel share-panel">
          <h2>在另一台设备打开</h2>
          <p>此链接仅当前账号登录后可打开。</p>
          {qr && <img src={qr} width={220} height={220} alt="本账号听写二维码" />}
          <label className="field">
            本账号链接
            <input readOnly value={share} />
          </label>
          <div className="row">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(share);
                  onNotice("本账号链接已复制");
                } catch {
                  onNotice("复制失败，请手动选择本账号链接");
                }
              }}
            >
              复制链接
            </button>
            <button
              type="button"
              onClick={() => {
                setShare("");
                setQr("");
              }}
            >
              关闭链接
            </button>
          </div>
        </section>
      )}
    </>
  );
}
