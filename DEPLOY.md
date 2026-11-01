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
