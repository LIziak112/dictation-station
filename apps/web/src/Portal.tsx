import { useEffect, useState } from "react";
import type { Account, Batch, Task } from "../../../packages/contract/src/index";
import { App } from "./App";
import { History } from "./History";
import { Learning } from "./Learning";
import { ParentGate } from "./ParentGate";
import { PasswordForm } from "./PasswordForm";
import { localKey } from "./storage";
import { TaskEditor } from "./TaskEditor";
import { TaskPlayer } from "./TaskPlayer";
import { TaskReview } from "./TaskReview";
import { Today } from "./Today";
import { taskApi } from "./task-api";

type Panel = "today" | "library" | "compose" | "task" | "review" | "learning" | "history";
export function Portal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [child, setChild] = useState(
    () => localStorage.getItem(localKey("childMode", account.id)) === "true",
  );
  const [panel, setPanel] = useState<Panel>("today");
  const [taskId, setTaskId] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [initialTask, setInitialTask] = useState<Task>();
  const [editExisting, setEditExisting] = useState(false);
  const [initialBatch, setInitialBatch] = useState<Batch>();
  const [gate, setGate] = useState<"parent" | "child" | "review" | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const route = () => {
      const params = new URLSearchParams(location.hash.slice(1));
      const id = params.get("task");
      if (id) {
        setTaskId(id);
        setPanel("task");
      } else
        setPanel(!child && (params.has("library") || params.has("batch")) ? "library" : "today");
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
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
    if (next === "library") location.hash = "library";
    else if (next === "today") location.hash = "";
    setPanel(next);
  }
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <button className="brand subtle" type="button" onClick={() => navigate("today")}>
            <strong>OwnClass</strong>
            <span>听写小站</span>
          </button>
          {!child && (
            <nav className="row" aria-label="主要导航">
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
              <button type="button" onClick={() => navigate("learning")}>
                待巩固
              </button>
              <button type="button" onClick={() => navigate("history")}>
                记录
              </button>
            </nav>
          )}
          <button
            type="button"
            onClick={() => {
              if (!canLeave()) return;
              if (child) setGate("parent");
              else if (!localStorage.getItem(localKey("parentPin", account.id))) setGate("child");
              else {
                localStorage.setItem(localKey("childMode", account.id), "true");
                setChild(true);
                location.hash = "";
              }
            }}
          >
            {child ? "家长区" : "进入孩子区"}
          </button>
          {!child && (
            <>
              <span className="account-name">{account.username}</span>
              <details className="access">
                <summary>账号</summary>
                <PasswordForm disabled={false} beforeChange={canLeave} onChanged={onLogout} />
              </details>
              <button
                type="button"
                onClick={() => {
                  if (canLeave()) onLogout();
                }}
              >
                退出登录
              </button>
            </>
          )}
        </div>
      </header>
      {message && (
        <p role="alert" className="notice">
          {message}
        </p>
      )}
      {gate ? (
        <ParentGate
          account={account}
          onCancel={() => setGate(null)}
          onUnlocked={() => {
            if (gate === "child") {
              localStorage.setItem(localKey("childMode", account.id), "true");
              setChild(true);
              location.hash = "";
            } else if (gate === "parent") {
              localStorage.setItem(localKey("childMode", account.id), "false");
              setChild(false);
            } else {
              setPanel("review");
            }
            setGate(null);
          }}
        />
      ) : (
        <>
          {panel === "learning" && !child && (
            <Learning
              onPublished={(id) => {
                location.hash = `task=${id}`;
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
            />
          )}
          {panel === "library" && !child && (
            <App
              account={account}
              onLogout={onLogout}
              embedded
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
          {panel === "task" && !child && (
            <div className="row task-actions">
              <button
                type="button"
                onClick={async () => {
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
                }}
              >
                修改待开始任务
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!canLeave()) return;
                  try {
                    const { task } = await taskApi.get(taskId);
                    setInitialTask(task);
                    setEditExisting(false);
                    setPanel("compose");
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "读取失败");
                  }
                }}
              >
                复制再练
              </button>
            </div>
          )}
          {panel === "task" && (
            <TaskPlayer
              key={taskId}
              taskId={taskId}
              child={child}
              accountId={account.id}
              onReview={(id) => {
                if (!canLeave()) return;
                setAttemptId(id);
                if (child) setGate("review");
                else setPanel("review");
              }}
              onBack={() => navigate("today")}
            />
          )}
          {panel === "review" && (
            <TaskReview
              attemptId={attemptId}
              accountId={account.id}
              onBack={() => navigate("today")}
            />
          )}
        </>
      )}
      <footer>
        <strong>OwnClass</strong>
        <span>Your data. Your way. All for learning.</span>
      </footer>
    </>
  );
}
