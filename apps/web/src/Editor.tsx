import { useEffect, useRef, useState } from "react";
import {
  type Batch,
  batchInputSchema,
  type Draft,
  MODES,
  type Mode,
  normalizeEntry,
} from "../../../packages/contract/src/index";
import { editEntry } from "../../../packages/core/src/edit";
import {
  buildAgentPrompt,
  htmlToLines,
  parseList,
  validateEntries,
} from "../../../packages/core/src/import";
import { api, download } from "./api";
import { BrowserAudio } from "./audio";

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
  const [files, setFiles] = useState<File[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const audio = useRef<BrowserAudio | null>(null);
  const current = useRef(draft);
  current.current = draft;
  useEffect(() => {
    audio.current = new BrowserAudio();
    return () => {
      controller.current?.abort();
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
  function changeEntry(id: string, key: "en" | "zh" | "pinyin" | "hint", value: string) {
    patch({
      entries: entries.map((e) => (e.id === id ? editEntry(e, key, value) : e)),
    });
  }
  function parse() {
    try {
      const parsed = parseList(draft.input || draft.raw);
      patch({ ...parsed.meta, entries: parsed.entries });
      setMessage(`已整理 ${parsed.entries.length} 条，请核对后保存`);
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
  async function save() {
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
      setMessage("词表尚不能保存，请检查空词条、模式要求或字段长度");
      return;
    }
    if (!onChange({ ...draft, title: checked.data.title })) {
      setMessage("本机草稿尚未保存，请先处理保存提示或导出备份");
      return;
    }
    setBusy(true);
    try {
      const { batch } = await api.save({ ...draft, title: checked.data.title });
      onSaved(batch);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，草稿仍保留");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">准备词表</p>
          <h1>{draft.batchId ? "编辑听写" : "新建听写"}</h1>
          <p>先确认每一个词，再安心交给孩子。</p>
        </div>
        <button type="button" onClick={onBack}>
          返回词表
        </button>
      </div>
      <div className="editor-layout">
        <section className="panel source-panel" aria-labelledby="source-title">
          <h2 id="source-title">01 / 导入原文</h2>
          <p className="muted">直接粘贴文字或 JSON 就能开始，AI 整理是可选步骤。</p>
          <label className="field">
            选择作业图片
            <input
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
          <p className="small muted">原图只在本次页面保留；点击识别时才发送到配置的 OCR 服务。</p>
          <button type="button" disabled={!ocrEnabled || !files.length || busy} onClick={recognize}>
            {busy ? "处理中…" : "识别图片"}
          </button>
          {!ocrEnabled && <p className="small muted">图片识别尚未配置，可以直接粘贴文字。</p>}
          <label className="field">
            作业原文
            <textarea
              rows={7}
              maxLength={20000}
              value={draft.raw}
              onChange={(e) => patch({ raw: e.target.value })}
              placeholder={"apple  苹果\nlibrary  图书馆"}
            />
          </label>
          <details>
            <summary>使用自己的 AI 整理</summary>
            <p className="small">复制提示词给您选择的 AI，返回后粘贴在下方。</p>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(buildAgentPrompt(draft.raw));
                  setMessage("提示词已复制");
                } catch {
                  setMessage("复制失败，请在下方选择并手动复制");
                }
              }}
            >
              复制整理提示词
            </button>
            <textarea
              aria-label="整理提示词"
              readOnly
              rows={4}
              value={buildAgentPrompt(draft.raw)}
            />
          </details>
          <label className="field">
            整理后的文字或 JSON
            <textarea
              rows={5}
              value={draft.input}
              maxLength={1000000}
              onChange={(e) => patch({ input: e.target.value })}
              placeholder="可以留空，直接整理上方原文"
            />
          </label>
          <label className="field">
            导入 JSON 文件
            <input
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
          <button type="button" className="primary" disabled={busy} onClick={parse}>
            整理并预览词表
          </button>
        </section>
        <section className="panel" aria-labelledby="entries-title">
          <h2 id="entries-title">
            02 / 核对词表 <span className="count">{entries.length} 词</span>
          </h2>
          <div className="form-grid">
            <label className="field">
              词表名称
              <input
                value={draft.title}
                maxLength={80}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="例如：Unit 3 单词听写"
              />
            </label>
            <label className="field">
              年级
              <input
                value={draft.grade}
                maxLength={40}
                onChange={(e) => patch({ grade: e.target.value })}
                placeholder="小学三年级"
              />
            </label>
            <label className="field">
              单元
              <input
                value={draft.unit}
                maxLength={60}
                onChange={(e) => patch({ unit: e.target.value })}
              />
            </label>
            <label className="field">
              教材或来源
              <input
                value={draft.textbook}
                maxLength={60}
                onChange={(e) => patch({ textbook: e.target.value })}
              />
            </label>
          </div>
          {!entries.length && (
            <div className="empty">
              <h3>词表还空着</h3>
              <p>整理原文，或手动添加第一个词。</p>
            </div>
          )}
          <div className="entry-list">
            {entries.map((e, i) => (
              <article className="entry-editor" key={e.id}>
                <div className="row between">
                  <h3>第 {i + 1} 词</h3>
                  <button
                    type="button"
                    className="danger subtle"
                    disabled={busy}
                    onClick={() => patch({ entries: entries.filter((x) => x.id !== e.id) })}
                    aria-label={`删除第 ${i + 1} 词`}
                  >
                    删除
                  </button>
                </div>
                <div className="form-grid">
                  {(["en", "zh", "pinyin", "hint"] as const).map((key) => (
                    <label key={key} className="field">
                      {{ en: "英文", zh: "中文", pinyin: "拼音", hint: "语境提示" }[key]}
                      <input
                        value={e[key]}
                        maxLength={key === "hint" ? 500 : 300}
                        onChange={(event) => changeEntry(e.id, key, event.target.value)}
                        autoCapitalize={key === "en" ? "none" : undefined}
                      />
                    </label>
                  ))}
                </div>
                <div className="row">
                  <button
                    type="button"
                    onClick={() => {
                      audio.current
                        ?.speak(e.en || e.zh, e.en ? "en" : "zh", 1)
                        .then(() => setMessage("试听结束，请按语境确认读音"))
                        .catch((error) => setMessage(error.message));
                    }}
                  >
                    试听{e.en ? "英文" : "中文"}
                  </button>
                  <details>
                    <summary>适用模式与其他写法</summary>
                    <div className="mode-checks">
                      {(Object.keys(MODES) as Mode[]).map((mode) => (
                        <label key={mode}>
                          <input
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
                                entries: entries.map((x) => (x.id === e.id ? { ...x, modes } : x)),
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
                        rows={2}
                        value={e.alt.join("\n")}
                        onChange={(event) =>
                          patch({
                            entries: entries.map((x) =>
                              x.id === e.id ? { ...x, alt: event.target.value.split("\n") } : x,
                            ),
                          })
                        }
                      />
                    </label>
                  </details>
                </div>
                {issues
                  .filter((x) => x.id === e.id)
                  .map((x) => (
                    <p
                      key={x.message}
                      className={x.level === "error" ? "error-text" : "warning-text"}
                    >
                      {x.level === "error" ? "需修改：" : "请核对："}
                      {x.message}
                    </p>
                  ))}
              </article>
            ))}
          </div>
          <button
            type="button"
            disabled={entries.length >= 500 || busy}
            onClick={() =>
              patch({
                entries: [...entries, normalizeEntry({ id: crypto.randomUUID() }, entries.length)],
              })
            }
          >
            ＋ 手动添加词条
          </button>
          <div className="save-bar">
            <p className="small muted">
              {errors.length
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
                disabled={busy || blocked || !entries.length || !!errors.length}
                onClick={save}
              >
                {busy ? "保存中…" : "保存词表"}
              </button>
            </div>
          </div>
        </section>
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </>
  );
}
