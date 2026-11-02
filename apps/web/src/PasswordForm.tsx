import { useState } from "react";
import { z } from "zod";
import { request } from "./api";

export function PasswordForm({
  onChanged,
  disabled,
}: {
  onChanged: () => void;
  disabled: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setMessage("");
        try {
          await request("api/auth/password", z.object({ ok: z.boolean() }), {
            method: "POST",
            body: JSON.stringify({
              currentPassword: data.get("current"),
              newPassword: data.get("next"),
            }),
          });
          onChanged();
        } catch (e) {
          setMessage(e instanceof Error ? e.message : "修改失败，请重试");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || disabled}>
        <label className="field">
          当前密码
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
        <label className="field">
          新密码
          <input
            name="next"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
        </label>
        <p className="small muted">修改后所有设备需重新登录。本机草稿按账号保留。</p>
        {message && <p role="alert">{message}</p>}
        <button type="submit">修改密码并重新登录</button>
      </fieldset>
    </form>
  );
}
