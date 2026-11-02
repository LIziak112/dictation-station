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
  useEffect(() => {
    document.title = "登录 · 听写小站 · OwnClass";
  }, []);
  return (
    <main className="login-page">
      <section className="panel">
        <p className="eyebrow">OwnClass · 听写小站</p>
        <h1>{register ? "创建账号" : "欢迎回来"}</h1>
        <p>一个账号，保存自己的词表。手机和平板都能打开。</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setBusy(true);
            setError("");
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
            <div className="field">
              <label htmlFor="login-username">用户名</label>
              <input
                id="login-username"
                aria-describedby="username-help"
                name="username"
                autoComplete="username"
                required
                minLength={2}
                maxLength={40}
                pattern="[A-Za-z0-9_-]+"
                autoCapitalize="none"
              />
              <span id="username-help" className="small muted">
                使用字母、数字、下划线或短横线
              </span>
            </div>
            <label className="field">
              密码
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={8}
                maxLength={128}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button className="primary" type="submit">
              {busy ? "请稍候…" : register ? "注册并登录" : "登录"}
            </button>
            {allowRegistration && (
              <button
                type="button"
                onClick={() => {
                  setRegister(!register);
                  setError("");
                }}
              >
                {register ? "已有账号，去登录" : "创建账号"}
              </button>
            )}
          </fieldset>
        </form>
      </section>
    </main>
  );
}
