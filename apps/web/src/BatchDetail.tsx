import { ArrowLeft } from "lucide-react";
import QRCode from "qrcode";
import { useState } from "react";
import {
  type Batch,
  MODES,
  type Mode,
  type Progress,
  type Settings,
} from "../../../packages/contract/src/index";
import { createQueue } from "../../../packages/core/src/player";
import { api, download, exportBatch } from "./api";

interface Props {
  batch: Batch;
  mode: Mode;
  setMode: (m: Mode) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  progress: Progress | null;
  compatible: boolean;
  wrongCount: number;
  onEdit: () => void;
  onResume: () => void;
  onStart: (wrong?: boolean) => void;
  onBack: () => void;
  onNotice: (s: string) => void;
}
export function BatchDetail({
  batch,
  mode,
  setMode,
  settings,
  setSettings,
  progress,
  compatible,
  wrongCount,
  onEdit,
  onResume,
  onStart,
  onBack,
  onNotice,
}: Props) {
  const [qr, setQr] = useState("");
  const [share, setShare] = useState("");
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
            {[batch.grade, batch.unit].filter(Boolean).join(" · ") || "听写练习"}
          </p>
          <h1>{batch.title}</h1>
          <p>选择练法，准备好纸笔，就可以开始。</p>
        </div>
        <button type="button" onClick={() => onEdit()}>
          编辑词表
        </button>
      </div>
      {compatible && (
        <section className="resume-banner">
          <div>
            <strong>继续上次进度</strong>
            <p>
              {progress?.phase === "result"
                ? "还有核对记录可以查看"
                : `从第 ${(progress?.index ?? 0) + 1} 词继续`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onResume();
            }}
          >
            继续上次听写
          </button>
        </section>
      )}
      {progress?.batchId === batch.id && !compatible && (
        <p className="notice">
          词表已经更新，上次进度已保留供导出，本次请重新开始。
          <button type="button" onClick={() => download("旧听写进度.json", progress)}>
            导出旧进度
          </button>
        </p>
      )}
      <section className="panel">
        <h2>01 / 今天怎么练</h2>
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
                <span>
                  {MODES[m].description} · {createQueue(batch.entries, m).length} 词
                </span>
              </button>
            ))}
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
          <button type="button" className="primary" onClick={() => onStart()}>
            开始听写
          </button>
          {wrongCount > 0 && (
            <button type="button" onClick={() => onStart(true)}>
              只练错词（{wrongCount}）
            </button>
          )}
          <span className="small muted">
            {MODES[mode].audio ? "设备朗读，无需准备服务器语音" : "此模式不播放语音"}
          </span>
        </div>
      </section>
      <section className="panel">
        <details>
          <summary>02 / 词表预览与导出</summary>
          <div className="word-list">
            {batch.entries.map((e, i) => (
              <div key={e.id}>
                <span className="small muted">{i + 1}</span>
                <strong>{e.en || e.zh}</strong>
                <span>{e.en ? e.zh : e.pinyin}</span>
                {e.hint && <span className="small muted">{e.hint}</span>}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => exportBatch(batch)}>
            导出词表 JSON
          </button>
        </details>
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
          分享链接 / 二维码
        </button>
        <button
          type="button"
          className="danger subtle"
          onClick={async () => {
            if (!confirm("确定删除这份词表？删除后分享链接将失效。")) return;
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
          <h2>分享这份听写</h2>
          <p>任何持有链接的人都能读取完整词表。请勿分享隐私内容。</p>
          {qr && <img src={qr} width={220} height={220} alt="听写分享二维码" />}
          <label className="field">
            分享链接
            <input readOnly value={share} />
          </label>
          <div className="row">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(share);
                  onNotice("分享链接已复制");
                } catch {
                  onNotice("复制失败，请手动选择分享链接");
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
              关闭分享
            </button>
          </div>
        </section>
      )}
    </>
  );
}
