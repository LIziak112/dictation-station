# 使用自己的 AI 与 MCP

AI 只负责材料整理。网站不代调用模型，不扩展图片识别入口。流程是「获取格式 → 整理／校验 → 创建草稿 → 网页核对保存 → 选今日范围」。保持老师作业的顺序和词义，中文补充按语境确认的带调拼音；不猜测教材内容，不提供任意音频地址。

## 创建连接

在家长区打开“AI 连接”，创建长期有效的令牌。可选择读取词表、读取听写记录和创建草稿的权限。令牌本次创建后仅显示一次，服务端只保存摘要，随时可撤销。旧令牌仍按原有效期和权限使用。

一个令牌属于一个账号。它不能发布词表、建任务、改记录、改掌握状态或管理其他令牌；也不读取 OCR 原文。确认和发布入口只接受网页登录会话。

## HTTP MCP（服务器部署）

登录后打开“AI 连接”→“连接远程 MCP”，页面会按当前部署地址生成可复制的通用配置；在本次会话中刚创建的令牌会直接代入。客户端需要支持 Streamable HTTP：

```json
{
  "mcpServers": {
    "ownclass-dictation": {
      "type": "http",
      "url": "https://www.example.com/tingxie/mcp",
      "headers": {
        "Authorization": "Bearer 在本机填写你的令牌"
      }
    }
  }
}
```

根路径部署时地址为 `https://站点/mcp`，子路径部署时为 `https://站点/tingxie/mcp`。服务端对每个 MCP 请求重新校验 Bearer 令牌与 scope，撤销后客户端立即无法调用。令牌不要提交到仓库或发给模型聊天。

## 本地 stdio（可选）

需要 Node.js 24+。在项目中 pnpm install 和 pnpm build 后，使用只支持本地 stdio MCP 的客户端运行构建出的 dist/mcp.js。通用配置形状如下，实际文件位置以所用客户端说明为准：

```json
{
  "mcpServers": {
    "ownclass-dictation": {
      "command": "node",
      "args": ["C:/项目绝对路径/dictation-station/dist/mcp.js"],
      "env": {
        "DICTATION_URL": "http://127.0.0.1:8083/tingxie/",
        "DICTATION_TOKEN": "在本机填写你的令牌"
      }
    }
  }
}
```

DICTATION_URL 是网站服务地址，必须包含真实子路径；根路径部署用 http://127.0.0.1:8083/。客户端不需要共享网站 Cookie。stdout 保留给 MCP 协议，不通过 pnpm 脚本横插日志。

五项工具：

| 工具                  | 行为                                     |
| --------------------- | ---------------------------------------- |
| get_wordlist_schema   | 读取服务端由 Zod 导出的当前词表格式      |
| validate_wordlist     | 返回错误／提醒，不写数据                 |
| create_wordlist_draft | 建草稿，返回含 #draft= 的核对链接        |
| list_wordlists        | 不传 id 列出自己的词表，传 id 读取该词表 |
| list_dictation_history | 不传 attemptId 列出已完成的听写记录，传 attemptId 查看词条与判分详情 |

网站使用 opaque Bearer token，而非 OAuth。HTTP 端点与本地桥接共用同一套工具和权限校验，不冒充远程 OAuth MCP。仅支持远程连接的客户端使用上面的 HTTP 配置，或使用下面的 API。

## API 入口

请求头 Authorization: Bearer 令牌；POST 同时带 Content-Type: application/json。

- GET api/agent/schema：任何有效令牌。
- POST api/agent/validate：drafts:write；请求 {"wordlist": {...}}。
- POST api/agent/drafts：drafts:write；请求 {"wordlist": {...}, "notes": "待家长核对事项"}。
- GET api/agent/wordlists、GET api/agent/wordlists/:id：wordlists:read。
- GET api/agent/history、GET api/agent/history/:id：history:read，后者的 id 为听写记录中的 attempt.id。

Agent 入口按路径和操作明确放行，没有匹配到允许范围的请求返回 403；不会把一个全站口令转成任意接口权限。草稿发布和保存是同一数据库事务，失效确认链接不会再次复制正式词表。无效内容仍保留原草稿。

## 验证与依赖

test/mcp.test.ts 使用官方 MCP 客户端，启动真实子进程，通过 stdio 协议完成格式、校验、建草稿和撤销测试；不是用模拟函数代替协议。浏览器回归覆盖网页创建令牌、Agent API 建草稿、网页核对发布和撤销。未让外部大模型读取真实家庭材料，不宣称每种第三方客户端均已验证。

新增 @modelcontextprotocol/server 2.4.0 作为运行依赖，@modelcontextprotocol/client 2.4.0 仅用于测试。理由：使用当前稳定官方协议实现，避免手写 JSON-RPC、传输与版本协商。替代方案是仅保留已有 JSON／HTTP API，但无法满足本轮本地 MCP 需求。不引入远程 OAuth 服务或第二套 Web 框架。SDK 文档和类型来自官方包，版本锁定。
