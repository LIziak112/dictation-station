# 部署与回退

## 构建与启动

需要 Node.js 24+、pnpm 12.6.0。先安装再构建，不能再只上传旧的 server.js/public。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

运行时须保留 `dist/`、`apps/server/drizzle/`、`package.json`、`server.js`、锁文件、依赖和数据目录。systemd 的 WorkingDirectory 指向项目根目录，入口可以继续 `node server.js`。凭据放在受限读取的 EnvironmentFile 中，不提交真实值。

## 环境变量

| 变量                                  | 缺省值与用途                                     |
| ------------------------------------- | ------------------------------------------------ |
| PORT / HOST                           | 8083 / 127.0.0.1                                 |
| DATA_DIR                              | 根目录 data；可使用绝对路径                      |
| BASE_PATH                             | `/`；保留前缀转发时设 `/tingxie/`                |
| PUBLIC_URL                            | 可选固定公网入口，含子路径；覆盖自动获取的地址   |
| ALLOW_REGISTRATION                    | true；设 false 关闭注册，已有账号仍可登录        |
| TRUST_PROXY                           | false；仅当可信反代覆盖 x-real-ip 时启用         |
| PADDLEOCR_TOKEN                       | 留空不启用图片识别                               |
| PADDLEOCR_URL / PADDLEOCR_MODEL       | 参见 .env.example；端点由部署者配置              |
| ENABLE_SERVER_TTS                     | false；默认仅设备朗读，无需 Python               |
| EDGE_TTS_PYTHON / EDGE_TTS_PYTHONPATH | 可选服务器语音使用的 Python 可执行文件及模块路径 |
| VOICE_ZH / VOICE_EN                   | 服务器语音中文/英文声音                          |

服务器语音启用时，在对应 Python 环境安装 edge-tts，并先验证网络和实际发音。相同文本/声音/速率复用原有 SHA-1 文件名；最多三个生成任务并发，相同任务合并，完整生成后才发布文件。队列有上限，失败可重试。今日任务进入准备页时解析声音并预加载，真人未命中时使用配置的合成兜底；旧的本机自由练习保留显式“准备服务器语音”按钮。下载完后本次播放使用内存音频，服务端复用缓存。

## nginx 子路径

两种配置择一：nginx 将 `/tingxie/` 剥离后转发到上游 `/` 时，应用设 `BASE_PATH=/`（兼容旧配置）；保留前缀时设 `BASE_PATH=/tingxie/`。

`BASE_PATH` 只控制内部路由，不用来猜测已被反代删除的公网路径。网页生成的 HTTP MCP 配置会自动携带 `X-Dictation-Site-Url`（浏览器中的完整入口）；stdio 根据 `DICTATION_URL` 自动发送相同信息。因此使用网页生成的配置时，独立域名、根路径和反代剥离子路径部署均无需另填 `PUBLIC_URL`。升级后重新复制 HTTP 配置；stdio 需使用新构建。

自建 REST 客户端也可发送该头，例如 `X-Dictation-Site-Url: https://dictation.example.org/practice/`，域名及端口必须与服务请求的公网主机一致。客户端未提供入口时，应用按请求地址与 `BASE_PATH` 生成链接；启用 `TRUST_PROXY` 后，也可从反代覆盖的 `X-Forwarded-Host`、`X-Forwarded-Proto`、`X-Forwarded-Prefix` 还原公网入口。`X-Forwarded-Prefix` 应为完整公网前缀（如 `/practice/`），不会与 `BASE_PATH` 重复拼接。

可选设置 `PUBLIC_URL=https://dictation.example.org/practice/`，明确固定所有确认链接的入口；它优先于客户端及反代信息，支持公网与内部主机不同的部署。公网路径被删除且客户端、可信反代和 `PUBLIC_URL` 均未提供它时，后端没有信息可以还原该路径。

保留前缀示例：

```nginx
location /tingxie/ {
    proxy_pass http://127.0.0.1:8083;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-Prefix /tingxie/;
    client_max_body_size 29m;
    proxy_read_timeout 240s;
}
```

要启用 TRUST_PROXY，反代必须覆盖用户提供的 x-real-ip 和 x-forwarded-proto，并覆盖或清除 x-forwarded-host、x-forwarded-prefix；应用才会在 HTTPS 响应上发送 HSTS，并信任这些公网地址信息。示例使用 `$http_host` 保留非标准公网端口；前缀按实际公网路径设置。多用户部署应在反代另设 IP 限流、连接数/超时及磁盘配额；未启用 TRUST_PROXY 时忽略上述转发头。新版本部署时应保留旧哈希资源，直到可能仍打开的旧页面关闭，避免按需加载旧文件时出现 404。认证限流保存在进程内，多进程部署需在反代增加共享限流。

新 AI 令牌默认有效期为 90 天，接口允许设置 1–365 天。已有长期令牌不会自动失效，请在 AI 连接页面创建新令牌、更新客户端配置后撤销旧令牌。

远程 MCP 端点与网站同域：根路径部署为 `/mcp`，保留前缀时为 `/tingxie/mcp`，沿用现有 location 转发即可；客户端用「AI 连接」页生成的 Bearer 配置连接，不需要额外端口或 CORS 设置。

同域主应用若有 scope=/ 的 Service Worker，需要在主应用 navigateFallbackDenylist 中排除 `/tingxie/` 并等待旧 SW 更新，或使用独立子域。本仓库不会修改线上主应用 SW。

## 首次启用账号与备份

本版本不提供旧记录迁移。使用新的空 DATA_DIR；旧数据由部署者自行保留，不自动删除或分配给新账号。不要直接把已有词表的旧数据库作为账号版本的数据目录。

首次启动保持 ALLOW_REGISTRATION=true，在页面创建账号；需要限制注册时之后改为 false 并重启。网页使用同源 Cookie，生产部署采用 HTTPS。会话有效期 30 天；修改或重设密码会撤销全部家长会话和设备 PIN，需要用新密码重新登录、绑定 PIN。孩子链接和 AI 令牌独立管理，需要时分别重置或撤销。一个站点实例建议独立主机名，避免和另一套同名 Cookie 冲突。

学习记录新增交卷时固化的练习日期与批改时的掌握阈值，均存于现有 JSON 载荷，无需新增数据库表。已有学习状态作为计算基线保留，不自动重算旧记录；旧记录已有交卷时间时优先使用，缺失时沿用批改日期口径。手动掌握／恢复建立新的计算基线，之前已交卷的迟批结果不会覆盖该操作，同一任务退回后重新交卷仍计为新一轮练习。

忘记密码时，在同一 DATA_DIR、同一 .env 下执行（PowerShell）：

```powershell
$env:RESET_PASSWORD = Read-Host '输入新密码（至少 8 字符）' -MaskInput
pnpm account:reset-password 用户名
Remove-Item Env:RESET_PASSWORD
```

CLI 不提供账号查询或创建服务；用户名必须已存在，重设后全部会话失效。密码不作为命令行参数或日志输出。

部署后停服务备份整个 data（包含 db/wal/shm 文件和 audio），或使用 SQLite 在线备份工具；不能在运行时只复制 db 而忽略 WAL。回退时恢复对应程序与数据备份，不编写旧版回填逻辑。

## 人工验收

- 在目标手机、iPad、电脑上确认五种模式、实际声音、多音字、0.5×/2×语速、自动下一词、暂停与系统后台行为。
- 手机竖屏、横屏及键盘弹出后编辑长词、中文、拼音；页面可缩放，按钮可达。
- 不承诺断网刷新后整个应用离线打开；草稿和进度在网络恢复后仍可读取。原图不在服务器或本机持久化。
- 验证注册开关、登录、退出、修改密码、不同账号隔离，以及 OCR／服务器语音关闭或失败。
- 尚无自动音频清理或定时备份，需要监控 data 容量。

## 真人发音

默认 PUBLIC_DICTIONARY=true，英文通过 Free Dictionary API 定位 Wikimedia Commons 录音，中文以已确认的带调拼音定位同一录音库。只接受有作者／来源与可用 Creative Commons 许可的录音；不使用词典失效的中转音频。可关闭公开查询，仅用自己的词书索引与合成兜底。

WORD_AUDIO_DIR 指向可选本地词书目录，index.json 为数组，示例（示例并不附带音频）：

```json
[
  {
    "id": "music-zh",
    "text": "音乐",
    "lang": "zh",
    "accent": "zh",
    "reading": "yīn yuè",
    "file": "music.mp3",
    "source": "自己的获准词书",
    "sourceUrl": "https://example.org/book",
    "author": "实际录音作者",
    "licenseName": "实际使用许可",
    "licenseUrl": "https://example.org/license"
  }
]
```

文件名只使用字母、数字、短横线、下划线，格式为 mp3／ogg／wav，不支持任意路径和用户上传。文件与许可由部署者提供，不把未获准资源加入仓库。

合成兜底仍可选启用 ENABLE_SERVER_TTS；英音使用 VOICE_EN_UK，美音使用 VOICE_EN。每项显示实际采用的真人／服务端／设备来源。准备阶段下载到浏览器并检查解码，不能解码的格式改为合成；设备 TTS 只能检查 API 能力，不能提前保证每个词都能正确发声。指定读音未命中时需家长试听确认。

公开网络与录音覆盖会变化，不承诺每词真人或移动端后台播放。来源实测见 SOURCES.md 与 docs/音频验证记录.md。
