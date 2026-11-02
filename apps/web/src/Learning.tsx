import { useEffect, useState } from "react";
import { z } from "zod";
import {
  type AccountPreferences,
  accountPreferencesSchema,
  defaultSettings,
  type Entry,
  examResponseSchema,
  type LearningItem,
  learningResponseSchema,
  learningStateSchema,
  MODES,
  type Mode,
  preferencesResponseSchema,
} from "../../../packages/contract/src/index";
import { localDate } from "../../../packages/core/src/scheduling";
import { request } from "./api";
import { taskApi } from "./task-api";

export function Learning({ onPublished }: { onPublished: (id: string) => void }) {
  const [items, setItems] = useState<LearningItem[]>([]);
  const [preferences, setPreferences] = useState<AccountPreferences>(
    accountPreferencesSchema.parse({}),
  );
  const [mode, setMode] = useState<Mode>("en2en");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(
    () => `${localDate(new Date(), "Asia/Shanghai").slice(0, 7)}-01`,
  );
  const [to, setTo] = useState(() => localDate(new Date(), "Asia/Shanghai"));
  const [exam, setExam] = useState<{ wordId: string; entry: Entry; status: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      request("api/learning", learningResponseSchema, { signal: controller.signal }),
      request("api/preferences", preferencesResponseSchema, { signal: controller.signal }),
    ])
      .then(([list, prefs]) => {
        setItems(list.items);
        setPreferences(prefs.preferences);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setMessage(e.message);
      });
    return () => controller.abort();
  }, []);
  async function publish(wordIds: string[], title: string) {
    setBusy(true);
    setMessage("");
    try {
      const { task } = await taskApi.create({
        title,
        date: localDate(new Date(), preferences.timezone),
        mode,
        settings: defaultSettings,
        selections: [],
        wordIds,
        reviewOnly: true,
        reviewCount: 0,
      });
      onPublished(task.id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "创建失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  const visible = items.filter((item) => item.state.mode === mode);
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">每天带上一点点</p>
          <h1>待巩固</h1>
          <p>不同练法分别记录，订正不算作隔日独立通过。</p>
        </div>
      </div>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="panel">
        <label className="field">
          练法
          <select
            aria-label="复习练法"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode);
              setExam([]);
              setSelected([]);
            }}
          >
            {Object.entries(MODES).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <p>{visible.filter((item) => item.state.status === "pending").length} 项待巩固</p>
          <button
            type="button"
            disabled={busy || !visible.some((item) => item.state.status === "pending")}
            onClick={() =>
              void publish(
                visible
                  .filter((item) => item.state.status === "pending")
                  .map((item) => item.state.wordId),
                "待巩固复习",
              )
            }
          >
            生成待巩固练习
          </button>
        </div>
        <div className="learning-list">
          {visible.map(({ entry, state }) => (
            <article className="word-row" key={state.wordId}>
              <div>
                <strong>{entry.en || entry.zh}</strong>
                <p>{entry.en ? entry.zh : entry.pinyin}</p>
                <span className="small muted">
                  {state.status === "mastered"
                    ? "已掌握"
                    : `独立通过 ${state.streak}/${preferences.masteryThreshold}`}{" "}
                  · {state.manual ? "家长手动调整" : "按核对记录"}
                  {state.dueDate ? ` · ${state.dueDate} 起复习` : ""}
                </span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const response = await request(
                      `api/learning/${state.wordId}`,
                      z.object({ state: learningStateSchema }),
                      {
                        method: "PUT",
                        body: JSON.stringify({
                          mode,
                          status: state.status === "mastered" ? "pending" : "mastered",
                        }),
                      },
                    );
                    setItems((previous) =>
                      previous.map((item) =>
                        item.state.wordId === state.wordId && item.state.mode === mode
                          ? { ...item, state: response.state }
                          : item,
                      ),
                    );
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "调整失败");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {state.status === "mastered" ? "恢复复习" : "手动移出"}
              </button>
            </article>
          ))}
        </div>
        {!visible.length && (
          <p className="muted">这个练法还没有待巩固记录，完成一次任务核对后会自动记录。</p>
        )}
      </section>
      <section className="panel">
        <h2>阶段总复习</h2>
        <p>选一段时间，汇总期间练过、目前还未掌握的内容。不确定与未核对项也会列出。</p>
        <div className="form-grid">
          <label className="field">
            开始日期
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            结束日期
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage("");
            try {
              const result = await request("api/learning/exam", examResponseSchema, {
                method: "POST",
                body: JSON.stringify({ from, to, mode }),
              });
              setExam(result.items);
              setSelected(result.items.map((item) => item.wordId));
              if (!result.items.length) setMessage("这段时间没有需要复习的内容");
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "查询失败");
            } finally {
              setBusy(false);
            }
          }}
        >
          汇总这个阶段
        </button>
        {exam.length > 0 && (
          <>
            <div className="word-selection">
              {exam.map((item) => (
                <label className="check" key={item.wordId}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.wordId)}
                    onChange={(e) =>
                      setSelected((previous) =>
                        e.target.checked
                          ? [...previous, item.wordId]
                          : previous.filter((id) => id !== item.wordId),
                      )
                    }
                  />
                  {item.entry.en || item.entry.zh} ·{" "}
                  {item.status === "unchecked" ? "尚未确认掌握" : "待巩固"}
                </label>
              ))}
            </div>
            <p>已选 {selected.length} 项；每份任务最多 500 项。</p>
            <button
              className="primary"
              type="button"
              disabled={busy || !selected.length || selected.length > 500}
              onClick={() => void publish(selected, `${from} 至 ${to} 阶段复习`)}
            >
              生成阶段复习任务
            </button>
          </>
        )}
      </section>
      <section className="panel">
        <details>
          <summary>复习偏好</summary>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const response = await request("api/preferences", preferencesResponseSchema, {
                  method: "PUT",
                  body: JSON.stringify(preferences),
                });
                setPreferences(response.preferences);
                setMessage("复习偏好已保存，从下一次练习起使用新规则");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "保存失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label className="field">
                不同日期通过几次算掌握
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={preferences.masteryThreshold}
                  onChange={(e) =>
                    setPreferences({ ...preferences, masteryThreshold: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                每次带上几项旧词
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={preferences.reviewCount}
                  onChange={(e) =>
                    setPreferences({ ...preferences, reviewCount: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                复习位置
                <select
                  value={preferences.reviewPlacement}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      reviewPlacement: e.target.value as "interleave" | "end",
                    })
                  }
                >
                  <option value="interleave">每五项作业穿插一项</option>
                  <option value="end">全部放在作业后面</option>
                </select>
              </label>
              <label className="field">
                日期时区
                <input
                  value={preferences.timezone}
                  onChange={(e) => setPreferences({ ...preferences, timezone: e.target.value })}
                />
              </label>
            </div>
            <button type="submit" disabled={busy}>
              保存复习偏好
            </button>
          </form>
        </details>
      </section>
    </main>
  );
}
