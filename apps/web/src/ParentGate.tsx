import { useState } from "react";
import { z } from "zod";
import type { Account } from "../../../packages/contract/src/index";
import { request } from "./api";
import { localKey } from "./storage";

async function pinHash(pin: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(bytes))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
export function ParentGate({
  account,
  onUnlocked,
  onCancel,
}: {
  account: Account;
  onUnlocked: () => void;
  onCancel: () => void;
}) {
  const key = localKey("parentPin", account.id);
  const [stored, setStored] = useState(() => localStorage.getItem(key));
  const [reset, setReset] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main>
      <section className="panel gate">
        <h1>{reset ? "重设本机口令" : stored ? "请家长确认" : "设置本机家长口令"}</h1>
        <p>口令只用于本设备防误入，不是考试防作弊功能。重设时验证账号密码。</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            setMessage("");
            try {
              if (reset) {
                await request("api/auth/verify-password", z.object({ ok: z.boolean() }), {
                  method: "POST",
                  body: JSON.stringify({ password: form.get("password") }),
                });
                localStorage.removeItem(key);
                setStored(null);
                setReset(false);
                return;
              }
              const pin = String(form.get("pin"));
              const hashed = await pinHash(pin);
              if (stored && stored !== hashed) {
                setMessage("口令不正确，请重试");
                return;
              }
              if (!stored) localStorage.setItem(key, hashed);
              onUnlocked();
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "本机口令无法保存，请重试");
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            {reset ? (
              <label className="field">
                账号密码
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </label>
            ) : (
              <label className="field">
                四位数字口令
                <input
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  minLength={4}
                  maxLength={4}
                  autoComplete="off"
                  required
                />
              </label>
            )}
            {message && <p role="alert">{message}</p>}
            <div className="row">
              <button className="primary" type="submit">
                {reset ? "验证并重设" : "确认"}
              </button>
              <button type="button" onClick={onCancel}>
                返回
              </button>
              {stored && !reset && (
                <button type="button" onClick={() => setReset(true)}>
                  忘记本机口令
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </section>
    </main>
  );
}
