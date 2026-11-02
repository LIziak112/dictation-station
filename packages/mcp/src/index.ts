import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createBridge } from "./server";

// stdout 只交给 MCP 协议，不输出日志或配置中的令牌。
const url = process.env.DICTATION_URL,
  token = process.env.DICTATION_TOKEN;
if (!url || !token) {
  console.error("请配置 DICTATION_URL 与 DICTATION_TOKEN");
  process.exitCode = 1;
} else {
  try {
    await createBridge(url, token).connect(new StdioServerTransport());
  } catch {
    console.error("MCP 启动失败，请检查服务地址与连接配置");
    process.exitCode = 1;
  }
}
