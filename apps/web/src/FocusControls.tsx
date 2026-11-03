import { Maximize, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { localKey } from "./storage";

export function FullscreenButton() {
  const [message, setMessage] = useState("");
  return (
    <span>
      <button
        type="button"
        onClick={async () => {
          try {
            setMessage("");
            if (document.fullscreenElement) await document.exitFullscreen();
            else if (document.documentElement.requestFullscreen)
              await document.documentElement.requestFullscreen();
            else setMessage("当前浏览器不支持网页全屏");
          } catch {
            setMessage("全屏未开启，请重试或使用系统专注设置");
          }
        }}
      >
        <Maximize size={16} aria-hidden="true" /> 切换全屏
      </button>
      {message && <span role="status">{message}</span>}
    </span>
  );
}

export function FocusControls({ accountId }: { accountId: string }) {
  const key = localKey("theme", accountId);
  const [dark, setDark] = useState(() => localStorage.getItem(key) === "dark");
  const [message, setMessage] = useState("");
  useEffect(() => {
    document.documentElement.classList.add("theme-changing");
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    // 先落定主题颜色，再恢复普通交互的过渡。
    void document.documentElement.offsetHeight;
    const frame = requestAnimationFrame(() =>
      document.documentElement.classList.remove("theme-changing"),
    );
    return () => {
      cancelAnimationFrame(frame);
      document.documentElement.classList.remove("theme-changing");
      delete document.documentElement.dataset.theme;
    };
  }, [dark]);
  return (
    <div className="focus-menu">
      <button
        type="button"
        onClick={() => {
          const next = !dark;
          setDark(next);
          try {
            localStorage.setItem(key, next ? "dark" : "light");
          } catch {
            setMessage("本次已切换，设备暂时无法记住显示偏好");
          }
        }}
      >
        {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        {dark ? "切换浅色" : "切换深色"}
      </button>
      <FullscreenButton />
      <p className="small muted">需要限制切换应用时，请用系统的引导式访问或屏幕固定。</p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
