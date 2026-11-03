import { Check, Copy } from "lucide-react";
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
  const serverUrl = new URL(".", location.href).href;
  const mcpUrl = new URL("mcp", serverUrl).href;
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        "ownclass-dictation": {
          type: "http",
          url: mcpUrl,
          headers: { Authorization: `Bearer ${rawToken || "<在此粘贴刚创建的令牌>"}` },
        },
      },
    },
    null,
    2,
  );
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
        <h2>连接远程 MCP</h2>
        <p>
          支持 Streamable HTTP 的 MCP
          客户端可以直接连接本站，读取词表格式、校验词表、创建待确认草稿并查询自己的词表。正式词表仍需由你在网页核对保存。
        </p>
        <ol className="mcp-steps">
          <li>在上方创建令牌；只需要建草稿时可只勾选“校验与创建草稿”。</li>
          <li>
            复制下面的配置到客户端，地址已包含当前部署路径和 <code>/mcp</code>。
          </li>
          <li>连接后应能看到获取格式、校验词表、创建草稿、查询词表四项工具。</li>
        </ol>
        <ConfigBlock
          label="通用 MCP 配置（mcpServers）"
          text={mcpConfig}
          ariaLabel="复制通用 MCP 配置 JSON"
          example={!rawToken}
        />
        <p className="small muted">
          {rawToken
            ? "配置已代入刚创建的令牌和当前服务地址；令牌只在本次创建后显示，请保存到客户端配置。"
            : "尚未创建令牌，配置中的 Authorization 是占位符；创建后会自动代入。"}
        </p>
        <details>
          <summary>连接说明与排查</summary>
          <p>
            地址由当前页面地址加 <code>mcp</code> 组成；子路径部署时是 <code>/tingxie/mcp</code>
            。令牌撤销或过期后，客户端需要更新 Authorization 头。
          </p>
          <p>
            只支持本地 stdio 的客户端，可以运行构建出的 <code>dist/mcp.js</code>，并用{" "}
            <code>DICTATION_URL</code>、<code>DICTATION_TOKEN</code> 环境变量接入，说明见仓库
            docs/AI接入.md。令牌不要提交到仓库或发给模型聊天。
          </p>
        </details>
      </section>
    </main>
  );
}

function ConfigBlock({
  label,
  text,
  ariaLabel,
  example,
}: {
  label: string;
  text: string;
  ariaLabel: string;
  example: boolean;
}) {
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const copied = result?.text === text && result.ok;
  const failed = result?.text === text && !result.ok;
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{label}</span>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setResult({ text, ok: true });
            } catch {
              setResult({ text, ok: false });
            }
          }}
        >
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {copied ? "已复制" : example ? "复制示例" : "复制"}
        </button>
      </div>
      <pre>{text}</pre>
      <p className="sr-only" role="status">
        {copied ? "配置已复制" : ""}
      </p>
      {failed && (
        <p role="alert" className="small error-text">
          复制失败，请选中内容手动复制。
        </p>
      )}
    </div>
  );
}
