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

部署前配置随机高强度 `WRITE_TOKEN`，仅经 HTTPS 使用。未配置时写 API 返回 503（默认关闭），现有数据不变，读取仍公开。新建/修改/删除、OCR 和 TTS 均需 Bearer 管理口令；前端在首次操作时询问，仅保存在当前标签页 sessionStorage，关闭标签页后重新输入。错误口令被清除。不要把口令放入链接、截图或提交。该方案为单管理员口令，不是多用户账户隔离；公开批次含原文，勿导入隐私材料。仅本地演示可设 `ALLOW_UNSAFE_WRITES=true`，禁止公网启用。默认忽略客户端转发 IP；仅可信反向代理覆盖这些头时设 `TRUST_PROXY=true`。

测试：Node 18+ 执行 `node --test test/*.test.js`。上线前备份 data，设置口令并重启，验证未认证写入被拒、认证新建及删除成功；回滚时保留数据与口令配置。
