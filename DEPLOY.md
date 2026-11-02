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
| WRITE_TOKEN                           | 空值为开放写入；设置后所有写接口要求 Bearer 口令 |
| TRUST_PROXY                           | false；仅当可信反代覆盖 x-real-ip 时启用         |
| PADDLEOCR_TOKEN                       | 留空不启用图片识别                               |
| PADDLEOCR_URL / PADDLEOCR_MODEL       | 参见 .env.example；端点由部署者配置              |
| ENABLE_SERVER_TTS                     | false；默认仅设备朗读，无需 Python               |
| EDGE_TTS_PYTHON / EDGE_TTS_PYTHONPATH | 可选服务器语音使用的 Python 可执行文件及模块路径 |
| VOICE_ZH / VOICE_EN                   | 服务器语音中文/英文声音                          |

服务器语音启用时，在对应 Python 环境安装 edge-tts，并先验证网络和实际发音。相同文本/声音/速率复用原有 SHA-1 文件名；最多三个生成任务并发，相同任务合并，完整生成后才发布文件。队列有上限，失败可重试。页面显式点击“准备服务器语音”才调用生成接口，下载完后本次播放使用内存音频；刷新后需要重新准备，服务端复用缓存。

## nginx 子路径

两种配置择一：nginx 将 `/tingxie/` 剥离后转发到上游 `/` 时，应用设 `BASE_PATH=/`（兼容旧配置）；保留前缀时设 `BASE_PATH=/tingxie/`。

保留前缀示例：

```nginx
location /tingxie/ {
    proxy_pass http://127.0.0.1:8083;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 29m;
    proxy_read_timeout 240s;
}
```

要启用 TRUST_PROXY，反代必须覆盖用户提供的 x-real-ip。多用户部署应在反代另设 IP 限流、连接数/超时及磁盘配额；应用不信任客户端任意转发头。

同域主应用若有 scope=/ 的 Service Worker，需要在主应用 navigateFallbackDenylist 中排除 `/tingxie/` 并等待旧 SW 更新，或使用独立子域。本仓库不会修改线上主应用 SW。

## 首次迁移与备份

1. 停止旧服务，备份整个 data 目录，包含 batches.json 和 audio。
2. 先用备份副本作为 DATA_DIR 启动新程序，核对词表数量、内容、旧分享链接和已有音频。
3. 新程序创建 dictation.db，运行生成的迁移，在一个事务中一次性导入 batches.json。原 JSON 不修改；坏 JSON、坏词条或重复 ID 会阻止启动，需要修复副本后再迁移。
4. 确认后切换新服务，不将两个版本同时指向同一份旧数据运行。
5. 停服务后备份整个 data（含 SQLite db/wal/shm 文件），或使用 SQLite 在线备份工具。不能在运行时只复制 db 而忽略 WAL。

回退需停止新服务，恢复旧程序及升级前对应数据备份。新版本写入 SQLite 的内容不会自动回写 batches.json；回退前先导出新增/变更词表，避免丢失升级后的业务数据。

## 人工验收

- 在目标手机、iPad、电脑上确认五种模式、实际声音、多音字、0.5×/2×语速、自动下一词、暂停与系统后台行为。
- 手机竖屏、横屏及键盘弹出后编辑长词、中文、拼音；页面可缩放，按钮可达。
- 不承诺断网刷新后整个应用离线打开；草稿和进度在网络恢复后仍可读取。原图不在服务器或本机持久化。
- 验证口令有无配置、OCR 缺配置/失败、服务器语音关闭/失败，提示应可恢复。
- 尚无自动音频清理或定时备份，需要监控 data 容量。
