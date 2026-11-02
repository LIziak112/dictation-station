import { useEffect, useRef, useState } from "react";
import {
  type AccountPreferences,
  accountPreferencesSchema,
  type Batch,
  type BatchSummary,
  MODES,
  preferencesResponseSchema,
  type Task,
  type TaskInput,
  taskInputSchema,
} from "../../../packages/contract/src/index";
import { selectRange } from "../../../packages/core/src/tasks";
import { api, download, request } from "./api";
import { localKey, useLocal, useUnsavedProtection } from "./storage";
import { taskApi } from "./task-api";

export function TaskEditor({
  accountId,
  initialBatch,
  initialTask,
  editExisting = false,
  onPublished,
  onAddContent,
  onBack,
}: {
  accountId: string;
  initialBatch?: Batch;
  initialTask?: Task;
  editExisting?: boolean;
  onPublished: (id: string) => void;
  onAddContent: () => void;
  onBack: () => void;
}) {
  const local = useLocal(localKey("taskDraft", accountId), taskInputSchema);
  useUnsavedProtection(!!local.error);
  const [input, setInput] = useState<TaskInput>(() =>
    initialTask
      ? {
          title: editExisting ? initialTask.title : `${initialTask.title}（再练）`,
          date: initialTask.date,
          mode: initialTask.mode,
          settings: initialTask.settings,
          reviewOnly: false,
          reviewCount: 0,
          selections: [],
          wordIds: initialTask.items.map((item) => item.wordId),
        }
      : (local.value ?? {
          title: "今天的听写",
          date: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date()),
          mode: initialBatch?.entries.some((e) => e.modes.includes("en2en"))
            ? "en2en"
            : "zh_dictation",
          settings: { accent: "us", repeat: 2, interval: 4, speed: 1, auto: false, shuffle: false },
          wordIds: [],
          reviewOnly: false,
          selections: initialBatch
            ? [{ batchId: initialBatch.id, entryIds: initialBatch.entries.map((e) => e.id) }]
            : [],
        }),
  );
  const initialSelections = useRef(input.selections);
  const [list, setList] = useState<BatchSummary[]>([]);
  const [batches, setBatches] = useState<Batch[]>(initialBatch ? [initialBatch] : []);
  const [preview, setPreview] = useState<Task | null>(null);
  const [preferences, setPreferences] = useState<AccountPreferences>(
    accountPreferencesSchema.parse({}),
  );
  const [range, setRange] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    request("api/preferences", preferencesResponseSchema, { signal: controller.signal })
      .then((result) => setPreferences(result.preferences))
      .catch((e: Error) => {
        if (!controller.signal.aborted) setMessage(e.message);
      });
    api
      .list(controller.signal)
      .then(async ({ batches: summaries }) => {
        setList(summaries);
        const selected = await Promise.all(
          initialSelections.current.map((selection) =>
            api.batch(selection.batchId, controller.signal),
          ),
        );
        if (!controller.signal.aborted) setBatches(selected.map((item) => item.batch));
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setMessage(e.message);
      });
    return () => controller.abort();
    // 初次打开恢复范围，后续选择由表单事件更新。
  }, []);
  function patch(value: Partial<TaskInput>) {
    const next = { ...input, ...value };
    setPreview(null);
    setInput(next);
    local.write(next);
  }
  const count = new Set([
    ...input.wordIds,
    ...input.selections.flatMap(
      (selection) =>
        batches
          .find((b) => b.id === selection.batchId)
          ?.entries.filter((e) => selection.entryIds.includes(e.id))
          .map((e) => e.wordId) ?? [],
    ),
  ]).size;
  return (
    <section className="panel task-editor">
      <h1>安排今日任务</h1>
      <p>按作业顺序选择范围，确认后发布。内容会保留快照。</p>
      {message && <p role="alert">{message}</p>}
      {local.error && (
        <div role="alert">
          <p>{local.error}</p>
          <button type="button" onClick={() => download("任务草稿.json", local.value ?? local.raw)}>
            导出任务草稿
          </button>
          <button type="button" onClick={local.retry}>
            重试保存
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm("已导出备份？清理后无法恢复本机任务草稿。")) local.reset();
            }}
          >
            清理任务草稿
          </button>
        </div>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          if (!local.write(input)) return;
          setBusy(true);
          setMessage("");
          try {
            const { task } =
              initialTask && editExisting
                ? await taskApi.update(initialTask.id, initialTask.revision, input)
                : await taskApi.create(input);
            local.write(null);
            onPublished(task.id);
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "发布失败，请重试");
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label className="field">
              任务名称
              <input
                value={input.title}
                maxLength={80}
                required
                onChange={(e) => patch({ title: e.target.value })}
              />
            </label>
            <label className="field">
              作业日期
              <input
                type="date"
                required
                value={input.date}
                onChange={(e) => patch({ date: e.target.value })}
              />
            </label>
            <label className="field">
              练法
              <select
                value={input.mode}
                onChange={(e) =>
                  patch({ mode: e.target.value as TaskInput["mode"], selections: [], wordIds: [] })
                }
              >
                {Object.entries(MODES).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              添加词表
              <select
                value=""
                onChange={async (e) => {
                  const id = e.target.value;
                  if (!id || batches.some((b) => b.id === id)) return;
                  try {
                    const { batch } = await api.batch(id);
                    setBatches((previous) => [...previous, batch]);
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "词表读取失败");
                  }
                }}
              >
                <option value="">选择已有词表</option>
                {list.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            编号范围
            <input
              placeholder="例如 1-10,15"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            />
          </label>
          {initialTask && (
            <section className="task-source">
              <h2>从原任务复用</h2>
              <div className="word-selection">
                {initialTask.items.map((item, index) => (
                  <label key={item.wordId} className="check">
                    <input
                      type="checkbox"
                      checked={input.wordIds.includes(item.wordId)}
                      disabled={!item.entry.modes.includes(input.mode)}
                      onChange={(event) =>
                        patch({
                          wordIds: event.target.checked
                            ? [...input.wordIds, item.wordId]
                            : input.wordIds.filter((id) => id !== item.wordId),
                        })
                      }
                    />
                    {index + 1}. {item.entry.en || item.entry.zh}
                  </label>
                ))}
              </div>
            </section>
          )}
          {batches.map((batch) => {
            const chosen =
              input.selections.find((selection) => selection.batchId === batch.id)?.entryIds ?? [];
            const choose = (entryIds: string[]) => {
              const selections = input.selections.some(
                (selection) => selection.batchId === batch.id,
              )
                ? input.selections.map((selection) =>
                    selection.batchId === batch.id ? { batchId: batch.id, entryIds } : selection,
                  )
                : [...input.selections, { batchId: batch.id, entryIds }];
              patch({ selections: selections.filter((selection) => selection.entryIds.length) });
            };
            return (
              <section className="task-source" key={batch.id}>
                <h2>{batch.title}</h2>
                <div className="row">
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        choose(
                          selectRange(batch.entries, range)
                            .filter((e) => e.modes.includes(input.mode))
                            .map((e) => e.id),
                        );
                        setMessage("");
                      } catch (e) {
                        setMessage(e instanceof Error ? e.message : "范围无效");
                      }
                    }}
                  >
                    应用范围到此词表
                  </button>
                  <button type="button" onClick={() => choose([])}>
                    清空选择
                  </button>
                </div>
                <div className="word-selection">
                  {batch.entries.map((entry, index) => (
                    <label key={entry.id} className="check">
                      <input
                        type="checkbox"
                        disabled={!entry.modes.includes(input.mode)}
                        checked={chosen.includes(entry.id)}
                        onChange={(event) =>
                          choose(
                            event.target.checked
                              ? [...chosen, entry.id]
                              : chosen.filter((id) => id !== entry.id),
                          )
                        }
                      />
                      {index + 1}. {entry.en || entry.zh} {entry.en ? entry.zh : entry.pinyin}
                    </label>
                  ))}
                </div>
              </section>
            );
          })}
          <div className="form-grid">
            <label className="field">
              本次带上几项到期复习
              <input
                type="number"
                min={0}
                max={20}
                value={input.reviewCount ?? preferences.reviewCount}
                onChange={(e) => patch({ reviewCount: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              复习位置
              <select
                value={input.reviewPlacement ?? preferences.reviewPlacement}
                onChange={(e) => patch({ reviewPlacement: e.target.value as "interleave" | "end" })}
              >
                <option value="interleave">每五项作业穿插一项</option>
                <option value="end">放在作业后面</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={busy || !count}
            onClick={async () => {
              setBusy(true);
              setMessage("");
              try {
                const response = await taskApi.preview(input);
                setPreview(response.task);
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "预览失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            预览作业与复习
          </button>
          {preview && (
            <div className="notice">
              <p>
                {preview.items.filter((item) => item.source === "homework").length} 项作业 +{" "}
                {preview.items.filter((item) => item.source === "review").length} 项复习
              </p>
              <ol>
                {preview.items.map((item) => (
                  <li key={item.wordId}>
                    {item.entry.en || item.entry.zh} · {item.source === "review" ? "复习" : "作业"}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p>
            {count} 项作业，预计约 {Math.max(1, Math.ceil((count * 20) / 60))}{" "}
            分钟。相同内容只计一次。
          </p>
          <details>
            <summary>播放设置</summary>
            <div className="form-grid">
              <label className="field">
                英语口音
                <select
                  value={input.settings.accent}
                  onChange={(e) =>
                    patch({
                      settings: { ...input.settings, accent: e.target.value as "us" | "uk" },
                    })
                  }
                >
                  <option value="us">美音</option>
                  <option value="uk">英音</option>
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={input.settings.shuffle}
                  onChange={(e) =>
                    patch({ settings: { ...input.settings, shuffle: e.target.checked } })
                  }
                />
                打乱作业顺序
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={input.settings.auto}
                  onChange={(e) =>
                    patch({ settings: { ...input.settings, auto: e.target.checked } })
                  }
                />
                自动下一项
              </label>
            </div>
          </details>
          <div className="row">
            <button className="primary" disabled={!count || local.blocked} type="submit">
              {busy ? "正在发布…" : "发布任务"}
            </button>
            <button type="button" onClick={onAddContent}>
              添加今日内容
            </button>
            <button type="button" onClick={onBack}>
              返回任务
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
