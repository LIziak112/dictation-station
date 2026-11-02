import { Headphones } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type Account,
  type Batch,
  type BatchSummary,
  defaultSettings,
  draftSchema,
  MODES,
  type Mode,
  type Progress,
  progressSchema,
  type Settings,
  serverDraftResponseSchema,
} from "../../../packages/contract/src/index";
import { createQueue } from "../../../packages/core/src/player";
import { api, download, request } from "./api";
import { BatchDetail } from "./BatchDetail";
import { blankDraft, Editor } from "./Editor";
import { Home } from "./Home";
import { PasswordForm } from "./PasswordForm";
import { Player } from "./Player";
import { loadSettings, rememberSettings } from "./preferences";
import { localKey, useLocal } from "./storage";

type View = "home" | "batch" | "editor" | "player";
export function App({
  account,
  onLogout,
  embedded = false,
  onTask,
  onPractice,
}: {
  account: Account;
  onLogout: () => void;
  embedded?: boolean;
  onTask?: (batch: Batch) => void;
  onPractice?: (batch: Batch, follow: boolean) => void;
}) {
  const [view, setView] = useState<View>("home");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [list, setList] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState({ ocr: false, tts: false, allowRegistration: false });
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Mode>("en2en");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [startImmediately, setStartImmediately] = useState(false);
  const draft = useLocal(localKey("draft", account.id), draftSchema);
  const progress = useLocal(localKey("progress", account.id), progressSchema);
  const draftRef = useRef({ draft, progress });
  draftRef.current = { draft, progress };
  const screenKey = view === "player" ? `${view}-${progress.value?.phase ?? "player"}` : view;
  const screenTitle =
    view === "editor"
      ? draft.value?.batchId
        ? "编辑词表"
        : "新建听写"
      : view === "player"
        ? progress.value?.phase === "result"
          ? "核对答案"
          : MODES[progress.value?.mode ?? mode].label
        : view === "batch"
          ? (batch?.title ?? "听写词表")
          : "听写词表";
  useEffect(() => {
    document.title = `${screenTitle} · 听写小站 · OwnClass`;
  }, [screenTitle]);
  useLayoutEffect(() => {
    if (loading) return;
    const target = document.querySelector<HTMLElement>(`[data-screen="${screenKey}"]`);
    target?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [screenKey, loading]);
  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => {});
  }, []);
  useEffect(() => {
    function protect(event: Event) {
      if (draftRef.current.draft.error || draftRef.current.progress.error) {
        event.preventDefault();
      }
    }
    window.addEventListener("beforeunload", protect);
    window.addEventListener("dictation:before-leave", protect);
    return () => {
      window.removeEventListener("beforeunload", protect);
      window.removeEventListener("dictation:before-leave", protect);
    };
  }, []);
  useEffect(() => {
    let active: AbortController | null = null;
    function route() {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      setLoading(true);
      setError("");
      const params = new URLSearchParams(location.hash.slice(1));
      const draftId = params.get("draft");
      const id = params.get("batch");
      if (draftId) {
        request(`api/drafts/${encodeURIComponent(draftId)}`, serverDraftResponseSchema, {
          signal: controller.signal,
        })
          .then(({ draft: imported }) => {
            if (controller.signal.aborted) return;
            const previous = draftRef.current.draft.value;
            if (previous && previous.sourceDraftId !== imported.id) {
              setError("本机还有一份草稿，请先返回词库恢复、保存或导出，再打开 AI 草稿。");
              return;
            }
            if (!previous) {
              const value = imported.wordlist;
              if (
                !draftRef.current.draft.write({
                  ...blankDraft(),
                  title: value.title,
                  grade: value.grade,
                  unit: value.unit,
                  stage: value.stage,
                  textbook: value.textbook,
                  entries: value.entries,
                  sourceDraftId: imported.id,
                  reviewNotes: imported.notes,
                })
              )
                return;
            }
            setView("editor");
          })
          .catch((e: Error) => {
            if (!controller.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      } else if (id) {
        api
          .batch(id, controller.signal)
          .then(({ batch: b }) => {
            if (controller.signal.aborted) return;
            setBatch(b);
            setSettings(loadSettings(b.id, account.id));
            setView("batch");
            const first = (Object.keys(MODES) as Mode[]).find((m) =>
              b.entries.some((e) => e.modes.includes(m)),
            );
            if (first) setMode(first);
          })
          .catch((e) => {
            if (!controller.signal.aborted && e.name !== "AbortError") setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      } else {
        setView("home");
        setBatch(null);
        api
          .list(controller.signal)
          .then((r) => {
            if (!controller.signal.aborted) setList(r.batches);
          })
          .catch((e) => {
            if (!controller.signal.aborted && e.name !== "AbortError") setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      }
    }
    route();
    window.addEventListener("hashchange", route);
    window.addEventListener("dictation:refresh", route);
    return () => {
      active?.abort();
      window.removeEventListener("hashchange", route);
      window.removeEventListener("dictation:refresh", route);
    };
  }, [account.id]);
  function home() {
    if (embedded) {
      location.hash = "library";
      setView("home");
      window.dispatchEvent(new Event("dictation:refresh"));
      return;
    }
    if (location.hash) location.hash = "";
    else {
      setView("home");
      window.dispatchEvent(new Event("dictation:refresh"));
    }
  }
  function open(id: string) {
    if (location.hash === `#batch=${id}`) {
      setView("batch");
      window.dispatchEvent(new Event("dictation:refresh"));
    } else location.hash = `batch=${id}`;
  }
  function edit(b?: Batch) {
    if (draft.value) {
      if (!confirm("本机还有一份未保存的草稿。确定用当前词表替换？建议先恢复或导出原草稿。"))
        return;
    }
    if (draft.write(blankDraft(b))) setView("editor");
  }
  function start(onlyWrong = false) {
    if (!batch) return;
    if (progress.blocked) {
      setNotice("本机进度尚未恢复，请先处理顶部提示");
      return;
    }
    let entries = batch.entries;
    if (onlyWrong) {
      const previous = progress.value;
      const ids = previous?.batchId === batch.id ? previous.wrongIds : [];
      entries = entries.filter((e) => ids.includes(e.id));
    }
    let ids = createQueue(entries, mode).map((q) => q.entry.id);
    if (!ids.length) {
      setNotice("这个模式下没有可用词条，请选择其他模式");
      return;
    }
    if (settings.shuffle) {
      ids = [...ids];
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    }
    const next: Progress = {
      version: 1,
      batchId: batch.id,
      revision: batch.revision,
      mode,
      settings,
      ids,
      index: 0,
      results: {},
      wrongIds: progress.value?.batchId === batch.id ? progress.value.wrongIds : [],
      phase: "player",
    };
    if (progress.write(next)) {
      setStartImmediately(true);
      setView("player");
      setNotice("");
    }
  }
  const compatible =
    !!batch &&
    progress.value?.batchId === batch.id &&
    progress.value.revision === batch.revision &&
    progress.value.ids.every((id) =>
      batch.entries.some((e) => e.id === id && e.modes.includes(progress.value?.mode ?? "en2en")),
    );
  const wrongCount =
    progress.value?.batchId === batch?.id ? (progress.value?.wrongIds.length ?? 0) : 0;
  const filtered = list.filter((b) =>
    `${b.title} ${b.grade} ${b.unit}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <button
        type="button"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        跳到正文
      </button>
      {!embedded && (
        <header className="site-header">
          <div className="header-inner">
            <button type="button" className="brand subtle" onClick={home}>
              <span className="brand-mark">
                <Headphones size={22} aria-hidden="true" />
              </span>
              <span>
                <strong>OwnClass</strong>
                <span className="brand-sub">听写小站</span>
              </span>
            </button>
            <span className="header-note">把时间，留给学习。</span>
            <span className="account-name">{account.username}</span>
            <details className="access">
              <summary>账号</summary>
              <PasswordForm onChanged={onLogout} disabled={!!draft.error || !!progress.error} />
            </details>
            <button
              type="button"
              onClick={() => {
                if (draft.error || progress.error) {
                  setNotice("请先导出或恢复保存失败的本机内容，再退出登录");
                  return;
                }
                onLogout();
              }}
            >
              退出登录
            </button>
          </div>
        </header>
      )}
      <main id="main" data-screen={screenKey} tabIndex={-1}>
        {draft.error && (
          <section className="notice error" role="alert">
            <p>{draft.error}</p>
            <div className="row">
              <button
                type="button"
                disabled={draft.value === null && draft.raw === null}
                onClick={() => download("本机草稿备份.json", draft.value ?? draft.raw)}
              >
                导出本机稿
              </button>
              <button type="button" onClick={draft.retry}>
                重试保存
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm("请确认已经导出备份。清理后无法恢复本机原稿。")) draft.reset();
                }}
              >
                清理本机草稿
              </button>
            </div>
          </section>
        )}
        {progress.error && (
          <section className="notice error" role="alert">
            <p>{progress.error}</p>
            <div className="row">
              <button
                type="button"
                disabled={progress.value === null && progress.raw === null}
                onClick={() => download("听写进度备份.json", progress.value ?? progress.raw)}
              >
                导出进度备份
              </button>
              <button type="button" onClick={progress.retry}>
                重试保存
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm("确定清理本机进度？请先导出备份。")) progress.reset();
                }}
              >
                清理本机进度
              </button>
            </div>
          </section>
        )}
        <div role="status" aria-atomic="true">
          {notice && (
            <p className="notice">
              {notice}
              <button type="button" className="subtle" onClick={() => setNotice("")}>
                关闭提示
              </button>
            </p>
          )}
        </div>
        {loading ? (
          <div className="empty" role="status">
            正在读取词表…
          </div>
        ) : error ? (
          <div className="panel empty" role="alert">
            <h1>暂时无法读取</h1>
            <p>{error}</p>
            <div className="row center">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("dictation:refresh"))}
              >
                重试
              </button>
              <button type="button" onClick={home}>
                返回首页
              </button>
            </div>
          </div>
        ) : (
          <>
            {view === "home" && (
              <Home
                list={list}
                filtered={filtered}
                query={query}
                setQuery={setQuery}
                draft={draft}
                progress={progress}
                edit={() => edit()}
                open={open}
                onResume={() => setView("editor")}
              />
            )}
            {view === "batch" && batch && (
              <BatchDetail
                key={`${batch.id}:${batch.revision}`}
                batch={batch}
                mode={mode}
                setMode={setMode}
                settings={settings}
                setSettings={(s) => {
                  setSettings(s);
                  rememberSettings(batch.id, s, account.id);
                }}
                progress={progress.value}
                compatible={compatible}
                wrongCount={wrongCount}
                onEdit={() => edit(batch)}
                onTask={() => onTask?.(batch)}
                onPractice={onPractice ? (follow) => onPractice(batch, follow) : undefined}
                onResume={() => {
                  setStartImmediately(false);
                  setView("player");
                }}
                onStart={start}
                onBack={home}
                onNotice={setNotice}
              />
            )}
            {view === "editor" && draft.value && (
              <Editor
                draft={draft.value}
                onChange={draft.write}
                onSaved={(b) => {
                  draft.write(null);
                  setBatch(b);
                  open(b.id);
                  setNotice("词表已保存");
                }}
                onBack={() => (batch ? setView("batch") : home())}
                ocrEnabled={health.ocr}
                blocked={draft.blocked}
              />
            )}
            {view === "player" && batch && progress.value && compatible && (
              <Player
                batch={batch}
                progress={progress.value}
                onChange={(p) => {
                  rememberSettings(p.batchId, p.settings, account.id);
                  return progress.write(p);
                }}
                onBack={() => setView("batch")}
                ttsEnabled={health.tts}
                autoStart={startImmediately}
              />
            )}
          </>
        )}
      </main>
      {!embedded && (
        <footer>
          <strong>OwnClass</strong>
          <span>Your data. Your way. All for learning.</span>
          <p>纸笔作答 · 自主核对 · 本机保留练习进度</p>
        </footer>
      )}
    </>
  );
}
