import { KeyRound } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import type { Account } from "../../../packages/contract/src/index";
import { ApiError, request } from "./api";
import { localKey } from "./storage";

async function pinHash(pin: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(bytes))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
function deviceId() {
  const key = "ownclass:dictation:parent-device";
  let id = localStorage.getItem(key);
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, id);
  }
  return id;
}
const okSchema = z.object({ ok: z.boolean() });
function savePin(pin: string) {
  return request("api/auth/device-pin", okSchema, { method: "POST", body: JSON.stringify({ deviceId: deviceId(), pin }) });
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
  const [resetVerified, setResetVerified] = useState(false);
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
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            setBusy(true);
            setMessage("");
            try {
              if (reset) {
                await request("api/auth/verify-password", z.object({ ok: z.boolean() }), {
                  method: "POST",
                  body: JSON.stringify({ password: form.get("password") }),
                });
                formElement.reset();
                setStored(null);
                setResetVerified(true);
                setReset(false);
                return;
              }
              const pin = String(form.get("pin"));
              if (!stored && !resetVerified) {
                await request("api/auth/verify-password", z.object({ ok: z.boolean() }), {
                  method: "POST",
                  body: JSON.stringify({ password: form.get("password") }),
                });
              }
              const hashed = await pinHash(pin);
              if (stored && stored !== hashed) {
                setMessage("口令不正确，请重试");
                return;
              }
              if (stored) {
                try {
                  await request("api/auth/unlock-pin", okSchema, { method: "POST", body: JSON.stringify({ deviceId: deviceId(), pin }) });
                } catch (e) {
                  if (e instanceof ApiError && e.status === 409) {
                    setReset(true);
                    setMessage(e.message);
                    return;
                  }
                  throw e;
                }
              } else {
                await savePin(pin);
                localStorage.setItem(key, hashed);
              }
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
                  key="password"
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
                  key="pin"
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  minLength={4}
                  maxLength={4}
                  autoComplete="new-password"
                  required
                />
              </label>
            )}
            {!stored && !reset && !resetVerified && (
              <label className="field">
                账号密码（首次设置时验证）
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
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

export function ParentPinSettings({ account }: { account: Account }) {
  const key = localKey("parentPin", account.id);
  const [stored, setStored] = useState(() => !!localStorage.getItem(key));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details className="password-disclosure">
      <summary>
        <KeyRound size={16} aria-hidden="true" />
        家长 PIN 设置
      </summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const pin = String(data.get("pin"));
          if (pin !== data.get("confirmPin")) {
            setMessage("两次输入的 PIN 不一致");
            return;
          }
          setBusy(true);
          try {
            await savePin(pin);
            localStorage.setItem(key, await pinHash(pin));
            setStored(true);
            form.reset();
            setMessage("本机家长 PIN 已保存");
          } catch {
            setMessage("PIN 保存失败，请检查浏览器是否允许本地存储");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="small muted">
          {stored ? "修改" : "设置"}本设备的四位 PIN，学生端返回家长端时使用。
        </p>
        <label className="field">
          新 PIN
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
        <label className="field">
          确认 PIN
          <input
            name="confirmPin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            minLength={4}
            maxLength={4}
            autoComplete="off"
            required
          />
        </label>
        {message && <p role="status">{message}</p>}
        <button type="submit" disabled={busy}>
          保存 PIN
        </button>
      </form>
    </details>
  );
}
