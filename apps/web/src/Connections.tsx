import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  type ServerDraft,
  serverDraftListSchema,
  type TokenInfo,
  type TokenScope,
  tokenCreatedSchema,
  tokenListSchema,
} from "../../../packages/contract/src/index";
import { request } from "./api";

export function Connections({ onDraft }: { onDraft: (id: string) => void }) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [drafts, setDrafts] = useState<ServerDraft[]>([]);
  const [message, setMessage] = useState("");
  const [rawToken, setRawToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [scopes, setScopes] = useState<TokenScope[]>(["wordlists:read", "drafts:write"]);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [list, pending] = await Promise.all([
        request("api/tokens", tokenListSchema, { signal }),
        request("api/drafts", serverDraftListSchema, { signal }),
      ]);
      setTokens(list.tokens);
      setDrafts(pending.drafts);
    } catch (e) {
      if (!signal?.aborted) setMessage(e instanceof Error ? e.message : "读取失败");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">用自己的 AI 准备材料</p>
          <h1>AI 连接与草稿</h1>
          <p>AI 只整理和建草稿，正式词表由你核对保存。</p>
        </div>
        <button type="button" onClick={() => void refresh()}>
          刷新草稿与令牌
        </button>
      </div>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="panel">
        <h2>待确认草稿</h2>
        {!drafts.length && (
          <p className="muted">还没有 AI 草稿，也可以在词库复制提示词，粘贴整理结果。</p>
        )}
        {drafts.map((draft) => (
          <article className="word-row" key={draft.id}>
            <div>
              <h3>{draft.wordlist.title}</h3>
              <p>{draft.wordlist.entries.length} 项</p>
              {draft.notes && <p>{draft.notes}</p>}
            </div>
            <div className="row">
              <button type="button" onClick={() => onDraft(draft.id)}>
                核对并编辑
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await request(`api/drafts/${draft.id}`, z.object({ ok: z.boolean() }), {
                      method: "DELETE",
                    });
                    setDrafts((previous) => previous.filter((item) => item.id !== draft.id));
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "删除失败");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                删除草稿
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>创建 AI 令牌</h2>
        <p>令牌对应当前账号，默认只能读词表和建草稿，不能改任务、记录或掌握状态。</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            setMessage("");
            try {
              const created = await request("api/tokens", tokenCreatedSchema, {
                method: "POST",
                body: JSON.stringify({
                  name: form.get("name"),
                  scopes,
                  expiresInDays: Number(form.get("days")),
                }),
              });
              setTokens((previous) => [...previous, created.info]);
              setRawToken(created.token);
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "令牌创建失败");
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="plain-fields">
            <div className="form-grid">
              <label className="field">
                连接名称
                <input name="name" maxLength={60} defaultValue="我的 Agent" required />
              </label>
              <label className="field">
                有效天数
                <input name="days" type="number" min={1} max={365} defaultValue={30} required />
              </label>
            </div>
            <div className="row">
              {(
                [
                  ["wordlists:read", "读取自己的词表"],
                  ["drafts:write", "校验与创建草稿"],
                ] as const
              ).map(([scope, label]) => (
                <label className="check" key={scope}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(e) =>
                      setScopes((previous) =>
                        e.target.checked
                          ? [...previous, scope]
                          : previous.filter((item) => item !== scope),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <button type="submit" disabled={!scopes.length}>
              创建令牌
            </button>
          </fieldset>
        </form>
        {rawToken && (
          <div className="notice">
            <p>令牌只在本次创建后显示，请保存到 Agent 的本机环境配置。</p>
            <label className="field">
              新令牌
              <input readOnly type={showToken ? "text" : "password"} value={rawToken} />
            </label>
            <div className="row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={showToken}
                  onChange={(e) => setShowToken(e.target.checked)}
                />
                显示令牌
              </label>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(rawToken);
                    setMessage("令牌已复制");
                  } catch {
                    setMessage("无法自动复制，请显示后手动复制令牌");
                  }
                }}
              >
                复制令牌
              </button>
              <button type="button" onClick={() => setRawToken("")}>
                关闭令牌显示
              </button>
            </div>
          </div>
        )}
        {tokens.map((token) => (
          <article className="word-row" key={token.id}>
            <div>
              <strong>{token.name}</strong>
              <p className="small muted">
                {token.scopes
                  .map((scope) => (scope === "wordlists:read" ? "读词表" : "建草稿"))
                  .join("、")}{" "}
                · {new Date(token.expiresAt).toLocaleDateString("zh-CN")} 到期
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await request(`api/tokens/${token.id}`, z.object({ ok: z.boolean() }), {
                    method: "DELETE",
                  });
                  setTokens((previous) => previous.filter((item) => item.id !== token.id));
                  setRawToken("");
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "撤销失败");
                } finally {
                  setBusy(false);
                }
              }}
            >
              撤销令牌
            </button>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>连接本地 MCP</h2>
        <p>
          构建项目后，让支持本地 stdio MCP 的客户端启动 <code>node /项目绝对路径/dist/mcp.js</code>
          ，环境变量设置 <code>DICTATION_URL</code> 和 <code>DICTATION_TOKEN</code>
          。服务地址应包含部署子路径。
        </p>
        <p>
          四项工具：获取词表格式、校验词表、创建草稿、查询自己的词表。具体配置见仓库
          docs/AI接入.md；只支持远程 HTTP MCP 的客户端本轮需使用 JSON 或 API。
        </p>
      </section>
    </main>
  );
}
