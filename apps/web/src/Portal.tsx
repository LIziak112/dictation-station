import { ExternalLink, Headphones, QrCode, RefreshCw } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  Account,
  Attempt,
  Batch,
  ChildTokenInfo,
  Task,
} from "../../../packages/contract/src/index";
import { App } from "./App";
import { Connections } from "./Connections";
import { FocusControls } from "./FocusControls";
import { History } from "./History";
import { Learning } from "./Learning";
import { ListeningPractice } from "./ListeningPractice";
import { PasswordForm } from "./PasswordForm";
import { PrintView } from "./PrintView";
import { TaskEditor } from "./TaskEditor";
import { TaskPlayer } from "./TaskPlayer";
import { TaskReview } from "./TaskReview";
import { Today } from "./Today";
import { taskApi } from "./task-api";

type Panel =
  | "today"
  | "library"
  | "compose"
  | "task"
  | "review"
  | "learning"
  | "history"
  | "connections"
  | "print"
  | "listen"
  | "follow";

export function Portal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const child = new URLSearchParams(location.search).get("child") === "1";
  const [panel, setPanel] = useState<Panel>("today");
  const [taskId, setTaskId] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [initialTask, setInitialTask] = useState<Task>();
  const [initialAttempt, setInitialAttempt] = useState<Attempt>();
  const [editExisting, setEditExisting] = useState(false);
  const [initialBatch, setInitialBatch] = useState<Batch>();
  const [lockedWordIds, setLockedWordIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [childShare, setChildShare] = useState<{
    url: string;
    qr: string;
    targetTaskId?: string;
    info?: ChildTokenInfo;
  } | null>(null);
  const lastHash = useRef(location.hash);

  useEffect(() => {
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof HTMLElement)) return;
      const disclosure = event.target.closest<HTMLDetailsElement>(".site-header details");
      if (disclosure?.open) {
        disclosure.open = false;
        disclosure.querySelector("summary")?.focus();
      }
    };
    window.addEventListener("keydown", closeMenu);
    return () => window.removeEventListener("keydown", closeMenu);
  }, []);

  useLayoutEffect(() => {
    if (panel === "library") return;
    const titles: Record<Panel, string> = {
      today: child ? "孩子听写区" : "今日任务",
      library: "词库",
      compose: "安排任务",
      task: "听写任务",
      review: "核对听写",
      learning: "待巩固",
      history: "听写记录",
      connections: "AI 连接",
      print: "打印练习纸",
      listen: "纯听",
      follow: "跟读",
    };
    document.title = `${titles[panel]} · 听写小站 · OwnClass`;
    const main = document.querySelector("main");
    if (main) {
      main.tabIndex = -1;
      main.id = "main";
      main.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [panel, child]);

  useEffect(() => {
    const route = (event?: Event) => {
      if (
        event &&
        !window.dispatchEvent(new Event("dictation:before-leave", { cancelable: true }))
      ) {
        history.replaceState(null, "", `${location.pathname}${location.search}${lastHash.current}`);
        event.stopImmediatePropagation();
        setMessage("有尚未保存或同步的内容，请先恢复保存或导出备份。");
        return;
      }
      lastHash.current = location.hash;
      const params = new URLSearchParams(location.hash.slice(1));
      const id = params.get("task");
      const reviewId = params.get("review");
      if (reviewId) {
        setAttemptId(reviewId);
        setPanel("review");
      } else if (id) {
        setTaskId(id);
        setPanel("task");
      } else if (!child && ["history", "learning", "connections"].some((key) => params.has(key))) {
        setPanel(
          params.has("history") ? "history" : params.has("learning") ? "learning" : "connections",
        );
      } else {
        setPanel(
          !child && (params.has("library") || params.has("batch") || params.has("draft"))
            ? "library"
            : "today",
        );
      }
    };
    route();
    window.addEventListener("hashchange", route, true);
    return () => window.removeEventListener("hashchange", route, true);
  }, [child]);

  function canLeave() {
    if (!window.dispatchEvent(new Event("dictation:before-leave", { cancelable: true }))) {
      setMessage("有尚未保存或同步的内容，请先恢复保存或导出备份。");
      return false;
    }
    setMessage("");
    return true;
  }

  function navigate(next: Panel) {
    if (!canLeave()) return;
    setChildShare(null);
    if (next === "library") location.hash = "library";
    else if (next === "today") location.hash = "";
    else if (["history", "learning", "connections"].includes(next)) location.hash = next;
    setPanel(next);
  }

  async function openChildShare(targetTaskId?: string, forceRotate = false) {
    if (!canLeave()) return;
    const storageKey = `ownclass:parent-ct:${account.id}`;
    let token = "";
    let info: ChildTokenInfo | undefined;
    try {
      token = localStorage.getItem(storageKey) ?? "";
    } catch {
      /* 忽略存储异常 */
    }
    try {
      if (forceRotate) {
        const rotated = await taskApi.rotateChildToken();
        token = rotated.token;
        info = rotated.info;
        try {
          localStorage.setItem(storageKey, token);
        } catch {
          /* 忽略存储异常 */
        }
        setMessage("已重置孩子区专属免密链接，旧二维码和链接已立即失效");
      } else {
        const status = await taskApi.childTokens();
        if (!token || !status.active.length) {
          const created = await taskApi.createChildToken();
          token = created.token;
          info = created.info;
          try {
            localStorage.setItem(storageKey, token);
          } catch {
            /* 忽略存储异常 */
          }
        } else {
          info = status.active[0];
        }
      }
    } catch {
      /* 测试环境如果拦截了接口，仍可回退生成 ?child=1 链接 */
    }
    const url = new URL(location.href);
    url.search = token ? `child=1&ct=${encodeURIComponent(token)}` : "child=1";
    url.hash = targetTaskId ? `task=${encodeURIComponent(targetTaskId)}` : "";
    const qr = await QRCode.toDataURL(url.href, { width: 220, margin: 2 });
    setChildShare({ url: url.href, qr, targetTaskId, info });
  }

  return (
    <>
      <button
        type="button"
        className="skip-link"
        onClick={() => {
          document.querySelector<HTMLElement>("main")?.focus();
        }}
      >
        跳到正文
      </button>
      <header className="site-header">
        <div className="header-inner">
          <button className="brand subtle" type="button" onClick={() => navigate("today")}>
            <span className="brand-mark">
              <Headphones size={20} aria-hidden="true" />
            </span>
            <span>
              <strong>OwnClass</strong>
              <span className="brand-sub">{child ? "孩子听写区" : "听写小站"}</span>
            </span>
          </button>
          {!child && (
            <nav className="row main-nav" aria-label="主要导航">
              <button
                type="button"
                aria-current={panel === "today" ? "page" : undefined}
                onClick={() => navigate("today")}
              >
                今日任务
              </button>
              <button
                type="button"
                aria-current={panel === "library" ? "page" : undefined}
                onClick={() => navigate("library")}
              >
                词库
              </button>
              <button
                type="button"
                aria-current={panel === "learning" ? "page" : undefined}
                onClick={() => navigate("learning")}
              >
                待巩固
              </button>
              <button
                type="button"
                aria-current={panel === "history" ? "page" : undefined}
                onClick={() => navigate("history")}
              >
                记录
              </button>
              <button
                type="button"
                aria-current={panel === "connections" ? "page" : undefined}
                onClick={() => navigate("connections")}
              >
                AI 连接
              </button>
            </nav>
          )}
          <div className="header-tools">
            {child ? (
              <div className="row child-header-actions">
                <span className="child-badge">学生独立听写模式</span>
                <button
                  type="button"
                  className="subtle return-parent-button"
                  onClick={() => {
                    if (canLeave()) {
                      const url = new URL(location.href);
                      url.searchParams.delete("child");
                      url.searchParams.delete("ct");
                      location.href = url.pathname + (url.hash ? url.hash : "");
                    }
                  }}
                >
                  返回家长管理端
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="child-entry-button"
                onClick={() => void openChildShare(panel === "task" ? taskId : undefined)}
              >
                <QrCode size={16} aria-hidden="true" />
                进入孩子区
              </button>
            )}
            <FocusControls accountId={account.id} />
            {!child && (
              <details className="access">
                <summary>账号</summary>
                <div className="account-menu">
                  <p className="account-name">{account.username}</p>
                  <PasswordForm disabled={false} beforeChange={canLeave} onChanged={onLogout} />
                  <button
                    type="button"
                    onClick={() => {
                      if (canLeave()) onLogout();
                    }}
                  >
                    退出登录
                  </button>
                </div>
              </details>
            )}
          </div>
        </div>
      </header>
      {message && (
        <aside className="top-alert-wrap" aria-label="系统提示">
          <p role="alert" className="notice">
            {message}
          </p>
        </aside>
      )}
      {childShare && !child && (
        <aside className="child-share-wrap" aria-label="孩子区入口">
          <section className="panel child-share-panel" aria-labelledby="child-share-title">
            <div className="page-heading compact">
              <div>
                <p className="eyebrow">学生专属免密通道</p>
                <h2 id="child-share-title">孩子听写区专属链接与二维码</h2>
                <p>
                  适合平板或手机扫码直接打开。学生端界面专注纯粹，支持报词听写、自主交卷与错词订正。
                </p>
              </div>
              <button type="button" onClick={() => setChildShare(null)}>
                关闭
              </button>
            </div>
            <div className="child-share-content">
              <div className="qr-box">
                <img src={childShare.qr} width={180} height={180} alt="孩子区入口二维码" />
                <span className="small muted">平板或手机扫码免密打开</span>
              </div>
              <div className="child-share-details">
                <label className="field">
                  孩子区独立链接
                  <input
                    readOnly
                    value={childShare.url}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </label>
                {childShare.info && (
                  <p className="small muted">
                    最近访问状态：
                    {childShare.info.lastAccessAgent && childShare.info.lastAccessedAt
                      ? `${childShare.info.lastAccessAgent} · ${new Date(childShare.info.lastAccessedAt).toLocaleString("zh-CN")}`
                      : "尚无其他设备扫码访问记录"}{" "}
                    · 有效期至 {new Date(childShare.info.expiresAt).toLocaleDateString("zh-CN")}
                  </p>
                )}
                <div className="row">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      location.href = childShare.url;
                    }}
                  >
                    在当前浏览器打开
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      window.open(childShare.url, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    新窗口打开孩子区
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(childShare.url);
                        setMessage("孩子区链接已复制，可发送到孩子的设备打开");
                      } catch {
                        setMessage("复制失败，请手动选中上方链接复制");
                      }
                    }}
                  >
                    复制链接
                  </button>
                  <button
                    type="button"
                    className="danger subtle"
                    onClick={() => {
                      if (confirm("确定重置孩子区链接吗？重置后之前的二维码和链接将立即失效。")) {
                        void openChildShare(childShare.targetTaskId, true);
                      }
                    }}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    重置孩子区链接
                  </button>
                </div>
              </div>
            </div>
          </section>
        </aside>
      )}
      {(panel === "listen" || panel === "follow") && initialBatch && (
        <ListeningPractice
          batch={initialBatch}
          lockedWordIds={lockedWordIds}
          follow={panel === "follow"}
          onBack={() => navigate(child ? "today" : "library")}
        />
      )}
      {panel === "print" && !child && initialTask && (
        <main>
          <PrintView
            task={initialTask}
            attempt={initialAttempt}
            onClose={() => navigate("today")}
          />
        </main>
      )}
      {panel === "connections" && !child && (
        <Connections
          onDraft={(id) => {
            if (canLeave()) location.hash = `draft=${id}`;
          }}
        />
      )}
      {panel === "learning" && !child && (
        <Learning
          onPublished={(id) => {
            location.hash = `task=${id}`;
            void openChildShare(id);
          }}
        />
      )}
      {panel === "history" && !child && (
        <History
          onOpen={(id) => {
            setAttemptId(id);
            setPanel("review");
          }}
        />
      )}
      {panel === "today" && (
        <Today
          child={child}
          onCreate={() => {
            setInitialBatch(undefined);
            setInitialTask(undefined);
            navigate("compose");
          }}
          onLibrary={() => navigate("library")}
          onOpen={(id) => {
            location.hash = `task=${id}`;
          }}
          onReview={(id) => {
            if (!canLeave()) return;
            location.hash = `review=${encodeURIComponent(id)}`;
            setAttemptId(id);
            setPanel("review");
          }}
          onShareChild={!child ? (id) => void openChildShare(id) : undefined}
          onChildPractice={
            child
              ? async (batchId, follow) => {
                  if (!canLeave()) return;
                  try {
                    const res = await taskApi.childListenBatch(batchId);
                    setInitialBatch(res.batch);
                    setLockedWordIds(res.lockedWordIds);
                    setPanel(follow ? "follow" : "listen");
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "词表读取失败");
                  }
                }
              : undefined
          }
        />
      )}
      {panel === "library" && !child && (
        <App
          account={account}
          onLogout={onLogout}
          embedded
          onPractice={(batch, follow) => {
            setInitialBatch(batch);
            setLockedWordIds([]);
            navigate(follow ? "follow" : "listen");
          }}
          onDispatched={(id) => {
            location.hash = `task=${id}`;
            void openChildShare(id);
          }}
          onTask={(batch) => {
            setInitialBatch(batch);
            setInitialTask(undefined);
            navigate("compose");
          }}
        />
      )}
      {panel === "compose" && !child && (
        <main>
          <TaskEditor
            accountId={account.id}
            initialBatch={initialBatch}
            initialTask={initialTask}
            editExisting={editExisting}
            onPublished={(id) => {
              location.hash = `task=${id}`;
            }}
            onAddContent={() => navigate("library")}
            onBack={() => navigate("today")}
          />
        </main>
      )}
      {panel === "task" && (
        <TaskPlayer
          key={taskId}
          taskId={taskId}
          child={child}
          accountId={account.id}
          onShareChild={!child ? () => void openChildShare(taskId) : undefined}
          onPrint={
            !child
              ? async () => {
                  if (!canLeave()) return;
                  try {
                    const [{ task }, playData] = await Promise.all([
                      taskApi.get(taskId),
                      taskApi.play(taskId).catch(() => ({ attempt: null })),
                    ]);
                    setInitialTask(task);
                    setInitialAttempt(playData.attempt ?? undefined);
                    setPanel("print");
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "读取失败");
                  }
                }
              : undefined
          }
          onEditTask={
            !child
              ? async () => {
                  if (!canLeave()) return;
                  try {
                    const { task } = await taskApi.get(taskId);
                    if (task.status !== "pending") {
                      setMessage("已开始的任务请使用复制再练");
                      return;
                    }
                    setInitialTask(task);
                    setEditExisting(true);
                    setPanel("compose");
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "读取失败");
                  }
                }
              : undefined
          }
          onCloneTask={
            !child
              ? async () => {
                  if (!canLeave()) return;
                  try {
                    const { task } = await taskApi.get(taskId);
                    setInitialTask(task);
                    setEditExisting(false);
                    setPanel("compose");
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "读取失败");
                  }
                }
              : undefined
          }
          onReview={(id, stayInChild) => {
            if (!canLeave()) return;
            setAttemptId(id);
            if (child && !stayInChild) {
              navigate("today");
            } else {
              location.hash = `review=${encodeURIComponent(id)}`;
              setPanel("review");
            }
          }}
          onBack={() => navigate("today")}
        />
      )}
      {panel === "review" && (
        <TaskReview
          attemptId={attemptId}
          accountId={account.id}
          child={child}
          onRedispatched={(id) => {
            location.hash = `task=${id}`;
            void openChildShare(id);
          }}
          onBack={() => navigate("today")}
        />
      )}
      <footer>
        <strong>OwnClass</strong>
        <span>Your data. Your way. All for learning.</span>
      </footer>
    </>
  );
}
