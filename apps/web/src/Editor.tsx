import { CheckCircle2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Batch,
  batchInputSchema,
  type Draft,
  type Entry,
  MODES,
  type Mode,
  normalizeEntry,
  type Voice,
  voiceResponseSchema,
} from "../../../packages/contract/src/index";
import { editEntry } from "../../../packages/core/src/edit";
import {
  buildAgentPrompt,
  htmlToLines,
  parseList,
  validateEntries,
} from "../../../packages/core/src/import";
import { loadAudio } from "./AudioPreparation";
import { api, download, request } from "./api";
import { BrowserAudio } from "./audio";
import { VoicePicker } from "./VoicePicker";

export function blankDraft(batch?: Batch): Draft {
  return batch
    ? {
        version: 1,
        batchId: batch.id,
        revision: batch.revision,
        title: batch.title,
        grade: batch.grade,
        unit: batch.unit,
        stage: batch.stage,
        textbook: batch.textbook,
        raw: "",
        input: "",
        entries: batch.entries,
      }
    : {
        version: 1,
        title: "",
        grade: "",
        unit: "",
        stage: "",
        textbook: "",
        raw: "",
        input: "",
        entries: [],
      };
}

function missingFields(entry: Entry) {
  const fields = new Set<keyof Entry>();
  if (!entry.en && !entry.zh) fields.add("zh");
  for (const mode of entry.modes) {
    const m = MODES[mode];
    for (const field of [m.show, m.answer, m.audio]) if (field && !entry[field]) fields.add(field);
  }
  return fields;
}

function base64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择"));
    reader.readAsDataURL(file);
  });
}

export function Editor({
  draft,
  onChange,
  onSaved,
  onBack,
  ocrEnabled,
  blocked,
}: {
  draft: Draft;
  onChange: (d: Draft) => boolean;
  onSaved: (b: Batch) => void;
  onBack: () => void;
  ocrEnabled: boolean;
  blocked: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkingAudio, setCheckingAudio] = useState(false);
  const [voiceMap, setVoiceMap] = useState<Record<string, Voice>>({});
  const [attempted, setAttempted] = useState(false);
  const [removed, setRemoved] = useState<{ entry: Entry; index: number } | null>(null);
  const [source, setSource] = useState<"text" | "image" | "ai">(() =>
    draft.input ? "ai" : "text",
  );
  const [showImport, setShowImport] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const audioController = useRef<AbortController | null>(null);
  const audio = useRef<BrowserAudio | null>(null);
  const mounted = useRef(true);
  const undoButton = useRef<HTMLButtonElement | null>(null);
  const current = useRef(draft);
  current.current = draft;

  useEffect(() => {
    mounted.current = true;
    audio.current = new BrowserAudio();
    return () => {
      mounted.current = false;
      controller.current?.abort();
      audioController.current?.abort();
      audio.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setImages(urls);
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [files]);

  const entries = draft.entries.map((e, i) => ({ ...normalizeEntry(e, i), ...e }));
  const issues = validateEntries(entries);
  const errors = issues.filter((i) => i.level === "error");
  const patch = (p: Partial<Draft>) => onChange({ ...current.current, ...p });

  const checkPronunciations = useCallback(async (targetEntries: Entry[]) => {
    const valid = targetEntries.filter((e) => e.en.trim() || e.zh.trim());
    if (!valid.length) return;
    audioController.current?.abort();
    const job = new AbortController();
    audioController.current = job;
    setCheckingAudio(true);
    try {
      const updates: Record<string, Voice> = {};
      for (let offset = 0; offset < valid.length; offset += 4) {
        const chunk = valid.slice(offset, offset + 4);
        await Promise.all(
          chunk.map(async (entry) => {
            if (job.signal.aborted) return;
            const lang: "en" | "zh" = entry.en.trim() ? "en" : "zh";
            const text = entry[lang].trim();
            if (!text) return;
            try {
              const result = await request("api/pronunciation/preview", voiceResponseSchema, {
                method: "POST",
                body: JSON.stringify({
                  text,
                  pinyin: entry.pinyin,
                  lang,
                  accent: "us",
                  reading: entry.readings[lang] || entry.reading || "",
                }),
                signal: job.signal,
              });
              updates[entry.id] = result.voice;
            } catch {
              /* 单条查询失败保留未获取状态 */
            }
          }),
        );
      }
      if (!job.signal.aborted && mounted.current) {
        setVoiceMap((prev) => ({ ...prev, ...updates }));
      }
    } finally {
      if (!job.signal.aborted && mounted.current) {
        setCheckingAudio(false);
      }
    }
  }, []);

  const initialChecked = useRef(false);
  useEffect(() => {
    if (!initialChecked.current && entries.some((e) => e.en.trim() || e.zh.trim())) {
      initialChecked.current = true;
      void checkPronunciations(entries);
    }
  }, [entries, checkPronunciations]);

  function changeEntry(id: string, key: "en" | "zh" | "pinyin" | "hint", value: string) {
    patch({
      entries: entries.map((e) => (e.id === id ? editEntry(e, key, value) : e)),
    });
  }

  function parse() {
    try {
      const parsed = parseList(draft.input || draft.raw);
      const nextMeta = {
        title: parsed.meta.title || draft.title,
        grade: parsed.meta.grade || draft.grade,
        unit: parsed.meta.unit || draft.unit,
        stage: parsed.meta.stage || draft.stage,
        textbook: parsed.meta.textbook || draft.textbook,
      };
      patch({ ...nextMeta, entries: parsed.entries });
      setMessage(`已整理 ${parsed.entries.length} 条词条，正在检查读音状态，请核对后保存`);
      void checkPronunciations(parsed.entries);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "解析失败，请检查原文");
    }
  }

  async function recognize() {
    if (!files.length) return;
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setMessage("正在识别，您可以先核对已完成的内容");
    try {
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) throw new Error("单张图片不能超过 20MB");
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
          throw new Error("请使用 PNG、JPEG 或 WebP 图片");
        const result = await api.ocr(
          { name: file.name, type: file.type, data: await base64(file) },
          task.signal,
        );
        if (task.signal.aborted) return;
        patch({
          raw: [current.current.raw, htmlToLines(result.text)].filter(Boolean).join("\n\n"),
        });
      }
      setMessage("识别完成，请对照原图核对，再整理词表");
    } catch (error) {
      if (!task.signal.aborted)
        setMessage(error instanceof Error ? error.message : "识别失败，已完成的文字仍保留");
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }

  async function previewEntryAudio(entry: Entry) {
    const lang: "en" | "zh" = entry.en ? "en" : "zh";
    const text = entry[lang];
    if (!text) return;
    try {
      let voice = voiceMap[entry.id];
      if (!voice) {
        const result = await request("api/pronunciation/preview", voiceResponseSchema, {
          method: "POST",
          body: JSON.stringify({
            text,
            pinyin: entry.pinyin,
            lang,
            accent: "us",
            reading: entry.readings[lang] || entry.reading || "",
          }),
        });
        voice = result.voice;
        if (mounted.current) {
          setVoiceMap((prev) => ({ ...prev, [entry.id]: voice as Voice }));
        }
      }
      if (voice?.url) {
        const blob = await loadAudio(voice.url);
        if (!mounted.current) return;
        audio.current?.cache(text, lang, blob);
      }
      await audio.current?.speak(text, lang, 1);
      if (mounted.current) setMessage("试听结束，请按语境确认读音");
    } catch {
      audio.current
        ?.speak(text, lang, 1)
        .then(() => {
          if (mounted.current) setMessage("试听结束，请按语境确认读音");
        })
        .catch((error: Error) => {
          if (mounted.current) setMessage(error.message);
        });
    }
  }

  async function save() {
    if (busy) return;
    setAttempted(true);
    const invalid = entries.find((e) => missingFields(e).size > 0);
    if (invalid) {
      const field = [...missingFields(invalid)][0];
      setMessage("词表还没保存。请补充标出的词条内容，再保存。");
      requestAnimationFrame(() => document.getElementById(`entry-${invalid.id}-${field}`)?.focus());
      return;
    }
    const checked = batchInputSchema.safeParse({
      title: draft.title || "未命名听写",
      grade: draft.grade,
      unit: draft.unit,
      stage: draft.stage,
      textbook: draft.textbook,
      entries: draft.entries,
      sourceText: draft.raw,
    });
    if (!checked.success) {
      setMessage(
        entries.length
          ? "词表还没保存。每条最多 30 个其他写法，请检查字段长度后重试。"
          : "先粘贴并整理原文，或手动添加一个词，再保存。",
      );
      if (!entries.length) document.getElementById("source-text")?.focus();
      return;
    }
    if (!onChange({ ...draft, title: checked.data.title })) {
      setMessage("本机草稿尚未保存，请先处理保存提示或导出备份");
      return;
    }
    setBusy(true);
    setSaving(true);
    try {
      const { batch } = await api.save({ ...draft, title: checked.data.title });
      if (!mounted.current) return;
      onSaved(batch);
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : "保存失败，草稿仍保留");
    } finally {
      setBusy(false);
      setSaving(false);
    }
  }

  const humanCount = entries.filter(
    (e) => voiceMap[e.id]?.kind === "human" || e.readings.en || e.readings.zh || e.reading,
  ).length;
  const synthCount = entries.filter(
    (e) =>
      !e.readings.en &&
      !e.readings.zh &&
      !e.reading &&
      (voiceMap[e.id]?.kind === "server" || voiceMap[e.id]?.kind === "device"),
  ).length;
  const uncheckedCount = Math.max(0, entries.length - humanCount - synthCount);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">准备词表</p>
          <h1>{draft.batchId ? "编辑听写" : "新建听写"}</h1>
          <p>先确认每一个词与读音，再安心交给孩子。</p>
        </div>
        <button type="button" onClick={onBack}>
          返回词表
        </button>
      </div>
      {draft.reviewNotes && (
        <section className="notice">
          <strong>AI 整理待核对</strong>
          <p>{draft.reviewNotes}</p>
        </section>
      )}
      <div role="status" aria-atomic="true" className="feedback">
        {message && (
          <div className="notice">
            <p>{message}</p>
            {removed && (
              <button
                ref={undoButton}
                type="button"
                disabled={saving}
                onClick={() => {
                  const restored = [...entries];
                  if (!restored.some((e) => e.id === removed.entry.id))
                    restored.splice(Math.min(removed.index, restored.length), 0, removed.entry);
                  patch({ entries: restored });
                  const field = removed.entry.en ? "en" : "zh";
                  const id = removed.entry.id;
                  setRemoved(null);
                  setMessage("词条已恢复");
                  requestAnimationFrame(() =>
                    document.getElementById(`entry-${id}-${field}`)?.focus(),
                  );
                }}
              >
                撤销删除
              </button>
            )}
          </div>
        )}
      </div>
      <fieldset className="editor-stack" aria-busy={saving}>
        <legend className="sr-only">准备听写词表</legend>
        <section className="panel editor-step" aria-labelledby="import-title">
          <div className="step-head">
            <span className="step-num" aria-hidden="true">
              1
            </span>
            <div>
              <h2 id="import-title">放入作业内容</h2>
              <p className="small muted">粘贴文字最快；也可以拍照识别，或用自己的 AI 整理。</p>
            </div>
          </div>
          {draft.batchId && !showImport ? (
            <button type="button" className="subtle" onClick={() => setShowImport(true)}>
              再导入一些词
            </button>
          ) : (
            <>
              <div className="source-tabs" role="tablist" aria-label="内容来源">
                {(
                  [
                    ["text", "粘贴文字"],
                    ["image", "拍照识别"],
                    ["ai", "AI / JSON"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={source === key}
                    onClick={() => setSource(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="source-pane" hidden={source !== "text"}>
                <label className="field">
                  作业原文
                  <textarea
                    disabled={saving}
                    id="source-text"
                    rows={8}
                    maxLength={20000}
                    value={draft.raw}
                    onChange={(e) => patch({ raw: e.target.value })}
                    placeholder={"apple  苹果\nlibrary  图书馆"}
                  />
                </label>
              </div>
              <div className="source-pane" hidden={source !== "image"}>
                <div className="ocr-box">
                  <label className="field">
                    选择作业图片
                    <input
                      disabled={saving}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                    />
                  </label>
                  {!!images.length && (
                    <div className="source-images">
                      {images.map((url, i) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt={`作业原图 ${i + 1}，点击放大`} />
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="row">
                    <button
                      type="button"
                      disabled={!ocrEnabled || !files.length || busy}
                      onClick={recognize}
                    >
                      {busy ? "处理中…" : "识别图片"}
                    </button>
                    <span className="small muted">
                      {ocrEnabled
                        ? "原图仅留在本页，点击识别才发送至 OCR 服务"
                        : "图片识别尚未配置，可直接粘贴文字"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="source-pane source-ai" hidden={source !== "ai"}>
                <details className="ai-organize-box">
                  <summary>使用自己的 AI 整理</summary>
                  <p className="small muted">
                    提示词已分行写明<strong>词表名称、年级、单元、教材或来源</strong>及 JSON
                    结构要求。复制给任意 AI，将返回的 JSON 粘贴到下方即可。
                  </p>
                  <dl className="prompt-context" aria-label="AI 整理上下文">
                    <div>
                      <dt>词表名称</dt>
                      <dd>{draft.title || "待从原文识别"}</dd>
                    </div>
                    <div>
                      <dt>年级</dt>
                      <dd>{draft.grade || "待从原文识别"}</dd>
                    </div>
                    <div>
                      <dt>单元</dt>
                      <dd>{draft.unit || "待从原文识别"}</dd>
                    </div>
                    <div>
                      <dt>教材或来源</dt>
                      <dd>{draft.textbook || "待从原文识别"}</dd>
                    </div>
                  </dl>
                  <div className="row">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(buildAgentPrompt(draft.raw, draft));
                          setMessage("提示词已复制");
                        } catch {
                          setMessage("复制失败，请在下方选择并手动复制");
                        }
                      }}
                    >
                      复制整理提示词
                    </button>
                  </div>
                  <textarea
                    disabled={saving}
                    className="prompt-textarea"
                    aria-label="整理提示词"
                    readOnly
                    rows={8}
                    value={buildAgentPrompt(draft.raw, draft)}
                  />
                </details>
                <label className="field">
                  整理后的文字或 JSON
                  <textarea
                    disabled={saving}
                    rows={4}
                    value={draft.input}
                    maxLength={1000000}
                    onChange={(e) => patch({ input: e.target.value })}
                    placeholder="粘贴 AI 返回的 JSON，或留空直接整理左侧作业原文"
                  />
                </label>
                <label className="field">
                  导入 JSON 文件
                  <input
                    disabled={saving}
                    type="file"
                    accept=".json,application/json"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 1000000) {
                        setMessage("JSON 文件不能超过 1MB");
                        return;
                      }
                      try {
                        const input = await file.text();
                        patch({ input });
                      } catch {
                        setMessage("文件读取失败，请重新选择");
                      }
                    }}
                  />
                </label>
              </div>
              <div className="row import-actions">
                <button
                  type="button"
                  className={entries.length ? undefined : "primary"}
                  disabled={busy}
                  onClick={parse}
                >
                  整理并预览词表
                </button>
                <span className="small muted">
                  支持每行“英文 中文”、“词语 拼音”、单行多个中文词语或结构化
                  JSON。纯中文文本会自动补充拼音，请逐行核对，尤其留意多音字。
                </span>
              </div>
            </>
          )}
        </section>

        <section className="panel editor-step" aria-labelledby="meta-title">
          <div className="step-head">
            <span className="step-num" aria-hidden="true">
              2
            </span>
            <div>
              <h2 id="meta-title">起个名字</h2>
              <p className="small muted">名称必填，年级、单元和来源方便以后查找。</p>
            </div>
          </div>
          <div className="meta-grid">
            <label className="field">
              词表名称
              <input
                disabled={saving}
                value={draft.title}
                maxLength={80}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="例如：Unit 3 单词听写"
              />
            </label>
            <label className="field">
              年级
              <input
                disabled={saving}
                value={draft.grade}
                maxLength={40}
                onChange={(e) => patch({ grade: e.target.value })}
                placeholder="例如：小学三年级"
              />
            </label>
            <label className="field">
              单元
              <input
                disabled={saving}
                value={draft.unit}
                maxLength={60}
                onChange={(e) => patch({ unit: e.target.value })}
                placeholder="例如：第三单元 / Unit 3"
              />
            </label>
            <label className="field">
              教材或来源
              <input
                disabled={saving}
                value={draft.textbook}
                maxLength={60}
                onChange={(e) => patch({ textbook: e.target.value })}
                placeholder="例如：人教版 PEP / 课堂听写单"
              />
            </label>
          </div>
        </section>

        <section className="panel" aria-labelledby="entries-title">
          <div className="entries-toolbar">
            <div className="step-head">
              <span className="step-num" aria-hidden="true">
                3
              </span>
              <div>
                <h2 id="entries-title">
                  核对词表 <span className="count">{entries.length} 词</span>
                </h2>
                <p className="small muted">逐行确认词语和读音，可以直接修改、试听。</p>
              </div>
            </div>
            <div className="row">
              {entries.length > 0 && (
                <div className="voice-summary-pills" role="status" aria-label="读音获取状态统计">
                  <span className="voice-pill voice-pill-human">真人/指定 {humanCount}</span>
                  <span className="voice-pill voice-pill-synth">合成/本机 {synthCount}</span>
                  {uncheckedCount > 0 && (
                    <span className="voice-pill voice-pill-pending">未获取 {uncheckedCount}</span>
                  )}
                </div>
              )}
              {entries.length > 0 && (
                <button
                  type="button"
                  disabled={busy || checkingAudio}
                  onClick={() => void checkPronunciations(entries)}
                >
                  {checkingAudio ? "正在获取读音…" : "检查并获取读音"}
                </button>
              )}
              <button
                type="button"
                disabled={entries.length >= 500 || busy}
                onClick={() =>
                  patch({
                    entries: [
                      ...entries,
                      normalizeEntry({ id: crypto.randomUUID() }, entries.length),
                    ],
                  })
                }
              >
                ＋ 手动添加词条
              </button>
            </div>
          </div>

          {!entries.length ? (
            <div className="empty">
              <h3>词表还空着</h3>
              <p>在上方粘贴原文并点击“整理并预览词表”，或手动添加第一个词。</p>
            </div>
          ) : (
            <div className="entry-table-wrap">
              <div className="entry-table-head" aria-hidden="true">
                <span>序号</span>
                <span>类型</span>
                <span>英文</span>
                <span>中文</span>
                <span>拼音</span>
                <span>语境提示</span>
                <span>读音状态与操作</span>
              </div>
              <div className="entry-list">
                {entries.map((e, i) => {
                  const voice = voiceMap[e.id];
                  const customReading = e.readings.en || e.readings.zh || e.reading;
                  const rowIssues = issues.filter(
                    (x) => x.id === e.id && (x.level === "warn" || attempted),
                  );
                  let voiceBadgeLabel = "未获取";
                  let voiceBadgeClass = "voice-badge-pending";
                  if (customReading) {
                    voiceBadgeLabel = "已指定";
                    voiceBadgeClass = "voice-badge-human";
                  } else if (voice?.kind === "human") {
                    voiceBadgeLabel = "真人";
                    voiceBadgeClass = "voice-badge-human";
                  } else if (voice?.kind === "server") {
                    voiceBadgeLabel = "合成";
                    voiceBadgeClass = "voice-badge-synth";
                  } else if (voice?.kind === "device") {
                    voiceBadgeLabel = "本机";
                    voiceBadgeClass = "voice-badge-synth";
                  } else if (checkingAudio) {
                    voiceBadgeLabel = "获取中…";
                    voiceBadgeClass = "voice-badge-pending";
                  }

                  return (
                    <article className="entry-row" key={e.id}>
                      <div className="entry-row-main">
                        <div className="entry-index-cell">
                          <span className="entry-index" title={`第 ${i + 1} 词`}>
                            {i + 1}
                          </span>
                        </div>
                        <label className="entry-cell">
                          <span className="cell-label">内容类型</span>
                          <select
                            aria-label="内容类型"
                            value={e.kind}
                            onChange={(event) =>
                              patch({
                                entries: entries.map((x) =>
                                  x.id === e.id
                                    ? { ...x, kind: event.target.value as Entry["kind"] }
                                    : x,
                                ),
                              })
                            }
                          >
                            {Object.entries({
                              character: "生字",
                              word: "词语",
                              phrase: "短语",
                              sentence: "句子",
                            }).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {(["en", "zh", "pinyin", "hint"] as const).map((key) => (
                          <label key={key} className="entry-cell">
                            <span className="cell-label">
                              {{ en: "英文", zh: "中文", pinyin: "拼音", hint: "语境提示" }[key]}
                            </span>
                            <input
                              disabled={saving}
                              id={`entry-${e.id}-${key}`}
                              lang={
                                key === "en"
                                  ? "en"
                                  : key === "pinyin"
                                    ? "zh-Latn-pinyin"
                                    : undefined
                              }
                              aria-invalid={(attempted && missingFields(e).has(key)) || undefined}
                              aria-describedby={`entry-${e.id}-issues`}
                              value={e[key]}
                              maxLength={key === "hint" ? 500 : 300}
                              placeholder={
                                {
                                  en: "英文",
                                  zh: "中文",
                                  pinyin: "带调拼音",
                                  hint: "多音字或语境提示",
                                }[key]
                              }
                              onChange={(event) => changeEntry(e.id, key, event.target.value)}
                              autoCapitalize={key === "en" ? "none" : undefined}
                            />
                          </label>
                        ))}
                        <div className="entry-actions-cell">
                          <span className={`voice-badge ${voiceBadgeClass}`} title={voice?.source}>
                            <CheckCircle2 size={14} aria-hidden="true" />
                            {voiceBadgeLabel}
                          </span>
                          <button
                            type="button"
                            className="compact-btn"
                            aria-label={`试听第 ${i + 1} 词`}
                            onClick={() => void previewEntryAudio(e)}
                          >
                            <Volume2 size={15} aria-hidden="true" />
                            试听
                          </button>
                          <button
                            type="button"
                            className="danger subtle compact-btn"
                            disabled={busy}
                            onClick={() => {
                              setRemoved({ entry: e, index: i });
                              patch({ entries: entries.filter((x) => x.id !== e.id) });
                              setMessage(`已删除第 ${i + 1} 词，可以撤销。`);
                              requestAnimationFrame(() => undoButton.current?.focus());
                            }}
                            aria-label={`删除第 ${i + 1} 词`}
                          >
                            删除
                          </button>
                        </div>
                      </div>

                      <div className="entry-row-sub">
                        <div id={`entry-${e.id}-issues`} className="entry-issues">
                          {rowIssues.map((x) => (
                            <p
                              key={x.message}
                              className={x.level === "error" ? "error-text" : "warning-text"}
                            >
                              {x.level === "error" ? "需修改：" : "请核对："}
                              {x.message}
                            </p>
                          ))}
                        </div>
                        <div className="entry-drawers">
                          <VoicePicker
                            entry={e}
                            onSelect={(lang, reading) =>
                              patch({
                                entries: entries.map((x) =>
                                  x.id === e.id
                                    ? { ...x, readings: { ...x.readings, [lang]: reading } }
                                    : x,
                                ),
                              })
                            }
                            onPreview={async (lang, accent, previewVoice) => {
                              const blob = previewVoice.url
                                ? await loadAudio(previewVoice.url)
                                : null;
                              if (!mounted.current) return;
                              setVoiceMap((prev) => ({ ...prev, [e.id]: previewVoice }));
                              audio.current?.setAccent(accent);
                              if (blob) audio.current?.cache(e[lang], lang, blob);
                              await audio.current?.speak(e[lang], lang, 1);
                            }}
                          />
                          <details className="entry-more-details">
                            <summary>指定读音、模式与其他写法</summary>
                            <div className="entry-more-panel">
                              <label className="field">
                                指定读音标识
                                <input
                                  value={e.reading}
                                  maxLength={120}
                                  placeholder="拼音或词典读音标识，需试听确认"
                                  onChange={(event) =>
                                    patch({
                                      entries: entries.map((x) =>
                                        x.id === e.id ? { ...x, reading: event.target.value } : x,
                                      ),
                                    })
                                  }
                                />
                              </label>
                              <div className="mode-checks">
                                {(Object.keys(MODES) as Mode[]).map((mode) => (
                                  <label key={mode}>
                                    <input
                                      disabled={saving}
                                      type="checkbox"
                                      checked={e.modes.includes(mode)}
                                      onChange={(event) => {
                                        const modes = event.target.checked
                                          ? [...e.modes, mode]
                                          : e.modes.filter((m) => m !== mode);
                                        if (!modes.length) {
                                          setMessage("至少保留一种模式");
                                          return;
                                        }
                                        patch({
                                          entries: entries.map((x) =>
                                            x.id === e.id ? { ...x, modes } : x,
                                          ),
                                        });
                                      }}
                                    />
                                    {MODES[mode].label}
                                  </label>
                                ))}
                              </div>
                              <label className="field">
                                其他可接受写法（每行一项）
                                <textarea
                                  disabled={saving}
                                  rows={2}
                                  value={e.alt.join("\n")}
                                  onChange={(event) =>
                                    patch({
                                      entries: entries.map((x) =>
                                        x.id === e.id
                                          ? { ...x, alt: event.target.value.split("\n") }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                              </label>
                            </div>
                          </details>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          <div className="save-bar">
            <p className="small muted">
              {attempted && errors.length
                ? `${errors.length} 处内容需要修改`
                : "读音和词义请人工确认；提醒不会自动改写内容。"}
            </p>
            <div className="row">
              <button type="button" onClick={() => download("听写草稿.json", draft)}>
                导出草稿备份
              </button>
              <button
                type="button"
                className="primary"
                disabled={blocked}
                aria-disabled={busy}
                aria-busy={saving}
                onClick={save}
              >
                {saving ? "正在保存词表…" : "保存词表"}
              </button>
            </div>
          </div>
        </section>
      </fieldset>
    </>
  );
}
