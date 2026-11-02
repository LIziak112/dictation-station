# 部署说明

## 生产环境

| 项 | 值 |
|---|---|
| 目录 | `/opt/dictation/app` |
| 服务 | `dictation.service`（systemd） |
| 监听 | `127.0.0.1:8083` |
| 入口 | `https://ownclass.top/tingxie/`（nginx 反代） |
| 凭据 | `/etc/dictation.env`（root:root 600，通过 systemd `EnvironmentFile` 注入） |

## 发布

```bash
tar -czf /tmp/app.tgz server.js public WORDLIST-SPEC.md
scp /tmp/app.tgz luyou@47.116.99.166:/tmp/
ssh luyou@47.116.99.166 'cd /opt/dictation/app && tar -xzf /tmp/app.tgz && sudo systemctl restart dictation'
curl -s https://ownclass.top/tingxie/api/health
```

上传偶发断流时用 `rsync --partial --inplace --append-verify --timeout=15` 重试，传完比对 md5。

## 回滚

```bash
sudo systemctl stop dictation
# 用上一版文件覆盖 /opt/dictation/app
sudo systemctl start dictation
```

## 权限边界

- 受限账号 `luyou`：只写 `/opt/dictation/app`，只能操作 `dictation` 服务。
- nginx 与主应用 `/opt/simple-tutor-tool` 不在这个账号的权限内。

## 已知坑

`www.ownclass.top` 上注册了主应用 Workbox SW（scope=`/`，`navigateFallback: index.html`），
会把同 origin 的 `/tingxie/` 导航兜回主应用。线上已热修 `sw.js` 的 denylist；
代码级修复见 simple-tutor-tool PR #53。部署新路径前先确认这一点。

## 管理口令与迁移

`WRITE_TOKEN` 为空时写操作直接放行（2026-11-02 起，按主人要求去掉使用期口令），读取始终公开。配置了 `WRITE_TOKEN` 时，新建/修改/删除、OCR 和 TTS 需要 Bearer 管理口令：前端不再预先弹框，服务端返回 401 后才询问一次，口令仅保存在当前标签页 sessionStorage，错误口令会被清除。不要把口令放入链接、截图或提交。

安全提示：未配置口令时任何拿到站点地址的人都能修改词表，公开批次含原文，勿导入隐私材料；需要恢复保护时在 `/etc/dictation.env` 写回 `WRITE_TOKEN=<随机串>` 并重启 service 即可，前端无需改动。该方案为单管理员口令，不是多用户账户隔离。`ALLOW_UNSAFE_WRITES` 已不再使用。默认忽略客户端转发 IP；仅可信反向代理覆盖这些头时设 `TRUST_PROXY=true`。

测试：Node 18+ 执行 `node --test test/*.test.js`。上线前备份 data，设置口令并重启，验证未认证写入被拒、认证新建及删除成功；回滚时保留数据与口令配置。

## 分享与核对（第二轮）
词表详情页可生成当前站点的 `#batch=<id>` 分享链接与本地二维码，无第三方二维码请求。链接公开词表，不含管理口令；收到链接的人用设备语音播放，未登录不会请求收费 TTS。分享不等于访问控制，敏感词表不可公开导入。二维码依赖 qrcode-generator 1.4.4（MIT，许可头保留于 public/vendor/qrcode.js）。
结果页支持全部正确、全部错误、清空标记，逐项按钮显示 aria-pressed 状态；错词仅在当前浏览器 localStorage 保存，不跨设备同步。
浏览器测试：安装 playwright-core 后设置 PLAYWRIGHT_CORE 与 CHROMIUM_PATH，运行 `node test/browser-smoke.cjs`。测试采用合成数据和本地临时服务器；不代表 iOS/Android 真机语音质量、真实 OCR 或生产部署已验收。
