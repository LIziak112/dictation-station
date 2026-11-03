import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export type AgentCall = (
  path: string,
  body?: unknown,
) => Promise<{
  isError?: boolean;
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
}>;

export function createMcpServer(call: AgentCall, linkBase: string) {
  const base = new URL(linkBase.endsWith("/") ? linkBase : `${linkBase}/`);
  const server = new McpServer({ name: "ownclass-dictation", version: "0.1.0" });
  server.registerTool(
    "get_wordlist_schema",
    {
      title: "获取听写词表格式",
      description:
        "整理材料前读取格式。保持作业原文、顺序、词义，中文补充按语境确认的带调拼音，不补造教材内容。",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => call("schema"),
  );
  server.registerTool(
    "validate_wordlist",
    {
      title: "校验听写词表",
      description: "检查格式与提醒，不保存、不发布。",
      inputSchema: z.object({ wordlist: z.unknown() }),
      annotations: { readOnlyHint: true },
    },
    async ({ wordlist }) => call("validate", { wordlist }),
  );
  server.registerTool(
    "create_wordlist_draft",
    {
      title: "创建待家长确认的草稿",
      description:
        "只建立草稿。返回网页链接，用户核对后自行保存正式词表；不能发布任务或修改学习状态。",
      inputSchema: z.object({ wordlist: z.unknown(), notes: z.string().max(2000).default("") }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ wordlist, notes }) => {
      const result = await call("drafts", { wordlist, notes });
      if (result.isError) return result;
      const parsed = z
        .object({ draft: z.object({ id: z.string() }) })
        .parse(result.structuredContent);
      const link = new URL(base);
      link.hash = `draft=${parsed.draft.id}`;
      return {
        ...result,
        content: [
          ...result.content,
          { type: "text" as const, text: `请在网页核对确认：${link.href}` },
        ],
      };
    },
  );
  server.registerTool(
    "list_wordlists",
    {
      title: "查询自己的词表",
      description:
        "不填 id 列出自己的词表，填写 id 读取该词表。需 wordlists:read 权限，不包含识别原文。",
      inputSchema: z.object({ id: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => call(id ? `wordlists/${encodeURIComponent(id)}` : "wordlists"),
  );
  return server;
}

export function createBridge(baseUrl: string, token: string) {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const call: AgentCall = async (path, body) => {
    try {
      const response = await fetch(new URL(`api/agent/${path}`, base), {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(result);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: failure.success ? failure.data.error : `请求失败（${response.status}）`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "无法连接听写小站，请检查服务地址和网络" }],
      };
    }
  };
  return createMcpServer(call, base.href);
}
