import { CircleAlert, CircleCheck, Eye, EyeOff, Headphones } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { type Account, accountResponseSchema } from "../../../packages/contract/src/index";
import { ApiError, api, request } from "./api";
import { Portal } from "./Portal";

export function Session() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [allowRegistration, setAllowRegistration] = useState(false);
  useEffect(() => {
    Promise.all([
      api.health(),
      request("api/auth/me", accountResponseSchema).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }),
    ])
      .then(([health, session]) => {
        setAllowRegistration(health.allowRegistration);
        setAccount(session?.account ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    const expired = () => setAccount(null);
    window.addEventListener("dictation:session-expired", expired);
    return () => window.removeEventListener("dictation:session-expired", expired);
  }, []);
  async function logout() {
    try {
      await request("api/auth/logout", z.object({ ok: z.boolean() }), { method: "POST" });
      setAccount(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAccount(null);
      else setError(e instanceof Error ? e.message : "退出失败，请重试");
    }
  }
  if (loading)
    return (
      <main>
        <p role="status">正在读取账号…</p>
      </main>
    );
  if (error)
    return (
      <main>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => location.reload()}>
          重新载入
        </button>
      </main>
    );
  return account ? (
    <Portal key={account.id} account={account} onLogout={() => void logout()} />
  ) : (
    <Login allowRegistration={allowRegistration} onAccount={setAccount} />
  );
}

function Login({
  allowRegistration,
  onAccount,
}: {
  allowRegistration: boolean;
  onAccount: (account: Account) => void;
}) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  useEffect(() => {
    document.title = `${register ? "创建账号" : "登录"} · 听写小站 · OwnClass`;
  }, [register]);
  function switchMode() {
    setRegister(!register);
    setError("");
    setShowPassword(false);
    setShowConfirm(false);
  }
  return (
    <main className="login-page">
      <div className="auth-shell">
        <aside className="auth-intro">
          <div className="auth-brand">
            <span className="brand-mark">
              <Headphones size={26} aria-hidden="true" />
            </span>
            <span>
              <strong>OwnClass</strong>
              <span className="brand-sub">听写小站</span>
            </span>
          </div>
          <p className="auth-headline">今天的听写，自己也能完成。</p>
          <p className="auth-lede">网页报词，孩子用纸笔写。核对答案，再把错词练一遍。</p>
          <ul className="auth-points">
            <li>
              <CircleCheck size={18} aria-hidden="true" />
              一份词表，五种练法
            </li>
            <li>
              <CircleCheck size={18} aria-hidden="true" />
              错词归集，按掌握程度复习
            </li>
            <li>
              <CircleCheck size={18} aria-hidden="true" />
              词表与进度跟着账号走
            </li>
          </ul>
        </aside>
        <section className="panel auth-card">
          <div className="auth-mobile-brand">
            <span className="brand-mark">
              <Headphones size={22} aria-hidden="true" />
            </span>
            <span>
              <strong>OwnClass</strong>
              <span className="brand-sub">听写小站</span>
            </span>
          </div>
          <h1 className="auth-title">{register ? "创建账号" : "欢迎回来"}</h1>
          <p className="auth-sub">
            {register
              ? "创建后即可保存词表，在手机和平板上继续练习。"
              : "一个账号，保存自己的词表。手机和平板都能打开。"}
          </p>
          <form
            className="auth-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setError("");
              if (register && data.get("password") !== data.get("confirm")) {
                setError("两次输入的密码不一致，请重新输入");
                return;
              }
              setBusy(true);
              try {
                const result = await request(
                  `api/auth/${register ? "register" : "login"}`,
                  accountResponseSchema,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      username: data.get("username"),
                      password: data.get("password"),
                    }),
                  },
                );
                onAccount(result.account);
              } catch (e) {
                setError(e instanceof Error ? e.message : "登录失败，请重试");
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <div className="auth-field">
                <label htmlFor="auth-username">用户名</label>
                <input
                  id="auth-username"
                  name="username"
                  aria-describedby={register ? "auth-username-help" : undefined}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  minLength={register ? 2 : undefined}
                  maxLength={40}
                  pattern={register ? "[A-Za-z0-9_-]+" : undefined}
                />
                {register && (
                  <span id="auth-username-help" className="field-help">
                    2–40 个字符，可用字母、数字、下划线或短横线
                  </span>
                )}
              </div>
              <div className="auth-field">
                <label htmlFor="auth-password">密码</label>
                <div className="password-field">
                  <input
                    id="auth-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    aria-describedby={register ? "auth-password-help" : undefined}
                    autoComplete={register ? "new-password" : "current-password"}
                    required
                    minLength={register ? 8 : undefined}
                    maxLength={128}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff size={18} aria-hidden="true" />
                    ) : (
                      <Eye size={18} aria-hidden="true" />
                    )}
                  </button>
                </div>
                {register && (
                  <span id="auth-password-help" className="field-help">
                    8–128 个字符，区分大小写
                  </span>
                )}
              </div>
              {register && (
                <div className="auth-field">
                  <label htmlFor="auth-confirm">确认密码</label>
                  <div className="password-field">
                    <input
                      id="auth-confirm"
                      name="confirm"
                      type={showConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      maxLength={128}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      aria-label={showConfirm ? "隐藏确认密码" : "显示确认密码"}
                      aria-pressed={showConfirm}
                      onClick={() => setShowConfirm(!showConfirm)}
                    >
                      {showConfirm ? (
                        <EyeOff size={18} aria-hidden="true" />
                      ) : (
                        <Eye size={18} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              )}
              {error && (
                <p className="auth-error" role="alert">
                  <CircleAlert size={16} aria-hidden="true" />
                  {error}
                </p>
              )}
              <button className="primary auth-submit" type="submit">
                {busy ? "请稍候…" : register ? "注册并登录" : "登录"}
              </button>
              {allowRegistration && (
                <p className="auth-switch">
                  {register ? "已有账号？" : "还没有账号？"}
                  <button type="button" className="auth-switch-button" onClick={switchMode}>
                    {register ? "去登录" : "创建账号"}
                  </button>
                </p>
              )}
            </fieldset>
          </form>
        </section>
      </div>
    </main>
  );
}
