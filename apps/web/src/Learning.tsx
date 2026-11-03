import { ChevronDown } from "lucide-react";
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
        if (list.items.length > 0 && !list.items.some((item) => item.state.mode === "en2en")) {
          setMode(list.items[0].state.mode);
        }
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
        allowSelfReview: false,
      });
      onPublished(task.id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "创建失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  const visible = items.filter((item) => item.state.mode === mode);
  const pendingItems = visible.filter((item) => item.state.status === "pending");
  const masteredItems = visible.filter((item) => item.state.status === "mastered");

  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">错词归集 · 按掌握程度复习</p>
          <h1>待巩固与阶段复习</h1>
          <p>不同练法分别记录掌握进度，单次订正不算作隔日独立通过。</p>
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy || !pendingItems.length}
          onClick={() =>
            void publish(
              pendingItems.map((item) => item.state.wordId),
              "待巩固复习",
            )
          }
        >
          生成待巩固练习（{pendingItems.length}）
        </button>
      </div>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="stat-cards">
        <div className="stat-card">
          <span className="small muted">当前练法待巩固</span>
          <strong>{pendingItems.length} 项</strong>
          <span className="small muted">下次安排任务时优先穿插复习</span>
        </div>
        <div className="stat-card">
          <span className="small muted">当前练法已掌握</span>
          <strong>{masteredItems.length} 项</strong>
          <span className="small muted">已达到连续独立通过要求</span>
        </div>
        <div className="stat-card">
          <span className="small muted">掌握判定标准</span>
          <strong>隔日通过 {preferences.masteryThreshold} 次</strong>
          <span className="small muted">每次新任务默认带 {preferences.reviewCount} 项旧词</span>
        </div>
      </div>

      <section className="panel">
        <div className="learning-toolbar">
          <div>
            <h2>待巩固词条列表</h2>
            <p className="small muted">按练法查看每项词语的独立通过次数与下次复习时间。</p>
          </div>
          <label className="field inline-field">
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
              {Object.entries(MODES).map(([key, value]) => {
                const modeCount = items.filter(
                  (item) => item.state.mode === key && item.state.status === "pending",
                ).length;
                return (
                  <option key={key} value={key}>
                    {value.label}（{modeCount} 项待巩固）
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        {visible.length > 0 ? (
          <div className="learning-list">
            <div className="learning-table-head" aria-hidden="true">
              <span>词条</span>
              <span>释义 / 拼音</span>
              <span>掌握进度</span>
              <span>复习排期与来源</span>
              <span>操作</span>
            </div>
            {visible.map(({ entry, state }) => (
              <article className="word-row learning-row" key={state.wordId}>
                <div className="learning-word-main">
                  <strong>{entry.en || entry.zh}</strong>
                </div>
                <div className="learning-word-sub">
                  <p>{entry.en ? entry.zh : entry.pinyin}</p>
                </div>
                <div className="learning-word-status">
                  <span
                    className={`status-pill ${
                      state.status === "mastered" ? "status-completed" : "status-in_progress"
                    }`}
                  >
                    {state.status === "mastered"
                      ? "已掌握"
                      : `独立通过 ${state.streak}/${preferences.masteryThreshold}`}
                  </span>
                </div>
                <div className="learning-word-meta">
                  <span className="small muted">
                    {state.manual ? "家长手动调整" : "按核对记录"}
                    {state.dueDate ? ` · ${state.dueDate} 起复习` : ""}
                  </span>
                </div>
                <div className="learning-word-action">
                  <button
                    type="button"
                    className="compact-btn"
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
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">
            <h3>当前练法还没有待巩固记录</h3>
            <p className="muted">
              完成一次听写任务并由家长核对后，标记为“未通过”或“待巩固”的词条会自动归集到这里。
            </p>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>阶段总复习（期中 / 期末考前汇总）</h2>
        <p className="muted">
          选择日期范围，一键汇总该阶段内练过但尚未完全掌握的词条（含待巩固与未核对项），生成考前复习任务。
        </p>
        <div className="exam-toolbar">
          <label className="field">
            开始日期
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            结束日期
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
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
        </div>
        {exam.length > 0 && (
          <div className="exam-results">
            <div className="word-selection">
              {exam.map((item, idx) => (
                <label className="check word-select-item" key={item.wordId}>
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
                  <span className="entry-index">{idx + 1}</span>
                  <strong>{item.entry.en || item.entry.zh}</strong>
                  <span className="muted">{item.entry.en ? item.entry.zh : item.entry.pinyin}</span>
                  <span className="status-pill status-pending">
                    {item.status === "unchecked" ? "尚未确认掌握" : "待巩固"}
                  </span>
                </label>
              ))}
            </div>
            <div className="row between">
              <p className="small muted">已选 {selected.length} 项；每份任务最多 500 项。</p>
              <button
                className="primary"
                type="button"
                disabled={busy || !selected.length || selected.length > 500}
                onClick={() => void publish(selected, `${from} 至 ${to} 阶段复习`)}
              >
                生成阶段复习任务
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <details className="review-preferences">
          <summary>
            <span>
              <strong>复习规则与偏好设置</strong>
              <span className="small muted">设置掌握标准、旧词数量和复习方式</span>
            </span>
            <ChevronDown size={20} aria-hidden="true" />
          </summary>
          <form
            className="prefs-form"
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
            <div className="row">
              <button type="submit" disabled={busy}>
                保存复习偏好
              </button>
            </div>
          </form>
        </details>
      </section>
    </main>
  );
}
