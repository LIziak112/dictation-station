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
  const [mcpTab, setMcpTab] = useState<"http" | "stdio">("http");

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
  const tokenPlaceholder = rawToken || "<在此粘贴上方创建的令牌>";
  const httpMcpConfig = JSON.stringify(
    {
      mcpServers: {
        "ownclass-dictation": {
          type: "http",
          url: mcpUrl,
          headers: { Authorization: `Bearer ${tokenPlaceholder}` },
        },
      },
    },
    null,
    2,
  );
  const stdioMcpConfig = JSON.stringify(
    {
      mcpServers: {
        "ownclass-dictation": {
          command: "node",
          args: ["dist/mcp.js"],
          env: {
            DICTATION_URL: serverUrl,
            DICTATION_TOKEN: tokenPlaceholder,
          },
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
          <p className="eyebrow">用自己的 AI 准备材料 · 标准 MCP 接入</p>
          <h1>AI 连接与 MCP 配置</h1>
          <p>
            一键生成专属令牌与 MCP 配置文件，让 Claude、Cursor 或本地 Agent 直接为您整理词表草稿。
          </p>
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
      <div className="connections-grid">
        <section className="panel">
          <h2>01 / 创建 AI 令牌</h2>
          <p className="muted">
            令牌对应当前账号，默认仅限读取词表和创建待确认草稿，不能修改听写任务、记录或掌握状态。创建后将自动填入右侧
            MCP 配置。
          </p>
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
              <button type="submit" className="primary" disabled={!scopes.length}>
                创建令牌
              </button>
            </fieldset>
          </form>
          {rawToken && (
            <div className="notice token-created-box">
              <p>
                <strong>令牌已生成并自动填入 MCP 配置！</strong>令牌只在本次显示，请及时复制保存。
              </p>
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
          {tokens.length > 0 && (
            <div className="token-list">
              <h3>已授权令牌（{tokens.length}）</h3>
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
            </div>
          )}
        </section>

        <section className="panel">
          <h2>02 / MCP 客户端配置（即复制即用）</h2>
          <p className="muted">
            先在左侧点击“创建令牌”，下方 JSON 配置会自动代入您的专属令牌和当前站点地址。
          </p>
          <div className="row mcp-tabs">
            <button
              type="button"
              aria-pressed={mcpTab === "http"}
              onClick={() => setMcpTab("http")}
            >
              远程 HTTP MCP（推荐）
            </button>
            <button
              type="button"
              aria-pressed={mcpTab === "stdio"}
              onClick={() => setMcpTab("stdio")}
            >
              本地 stdio 桥接
            </button>
          </div>
          {mcpTab === "http" ? (
            <ConfigBlock
              label="Streamable HTTP MCP 配置（Claude Code / Cursor / 通用 mcpServers）"
              text={httpMcpConfig}
              ariaLabel="复制通用 MCP 配置 JSON"
              example={!rawToken}
            />
          ) : (
            <ConfigBlock
              label="本地 Node stdio MCP 配置（适用于仅支持 stdio 的桌面客户端）"
              text={stdioMcpConfig}
              ariaLabel="复制本地 stdio MCP 配置 JSON"
              example={!rawToken}
            />
          )}
          <p className="small muted">
            {rawToken
              ? "✓ 已自动代入刚创建的令牌与当前服务地址，可直接粘贴到客户端的 mcpServers 配置文件。"
              : "提示：在左侧点击“创建令牌”后，配置中的 Authorization 占位符会自动替换为真实令牌。"}
          </p>
          <div className="mcp-tools-box">
            <h3>内置 MCP 工具一览</h3>
            <ul className="mcp-tool-list">
              <li>
                <code>get_wordlist_schema</code>：读取标准听写词表 JSON 结构与字段规范
              </li>
              <li>
                <code>validate_wordlist</code>：校验词表格式、多音字与缺漏提醒（不保存）
              </li>
              <li>
                <code>create_wordlist_draft</code>：创建待家长确认的词表草稿并返回网页核对链接
              </li>
              <li>
                <code>list_wordlists</code>：查询当前账号已有的词表列表或单份词表详情
              </li>
            </ul>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="row between">
          <div>
            <h2>03 / 待确认 AI 草稿</h2>
            <p className="small muted">
              AI 通过 MCP 创建的草稿会出现在这里，由您核对无误后保存为正式词表。
            </p>
          </div>
          <span className="count">{drafts.length} 份待核对</span>
        </div>
        {!drafts.length && (
          <p className="muted">
            暂时没有待确认的 AI 草稿。您也可以在“词库 → 新建听写”中复制整理提示词使用。
          </p>
        )}
        {drafts.map((draft) => (
          <article className="word-row" key={draft.id}>
            <div>
              <h3>{draft.wordlist.title}</h3>
              <p>
                {draft.wordlist.entries.length} 项词条
                {draft.wordlist.grade ? ` · ${draft.wordlist.grade}` : ""}
                {draft.wordlist.unit ? ` · ${draft.wordlist.unit}` : ""}
              </p>
              {draft.notes && <p className="small muted">AI 备注：{draft.notes}</p>}
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
