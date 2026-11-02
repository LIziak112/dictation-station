# 听写小站

老师布置的听写任务，家长没空念、或发音不标准时，用网页自动报听写。孩子仍然用纸笔写。

在线地址：<https://ownclass.top/tingxie/>

> 入口请用 **apex 域名**（不带 www）。`www.ownclass.top` 上注册了学习端主应用的
> Service Worker（scope=/，Workbox `navigateFallback: index.html`），它会把该 origin
> 下所有导航兜回主应用，导致 `/tingxie/` 显示「页面不存在」。
> 根治方案：主应用 `navigateFallbackDenylist` 加入 `/\/tingxie\//`。

## 做什么

1. **导入**：拍作业照片 → 飞桨 OCR 识别原文；也可以直接粘贴文字。
2. **整理**：一键复制「整理提示词 + 原文」，交给用户自己的 AI 清洗成 JSON；服务端不跑大模型。
3. **校验**：粘贴回来后在网页里校验、对照原图逐条修改，缺项和重复只标红，不静默补全。
4. **听写**：五种模式，语音在开始前一次性生成并缓存，播放过程中不再请求；播放页可调语速（0.5×–2×，默认 1×，按批次记住）。
5. **对答案**：结束后逐条核对，标错的词可以只重练那些。

## 五种模式

| 模式 | 出题 | 写什么 |
|---|---|---|
| 读汉语写英语 | 显示中文 | 英文 |
| 读英语写英语 | 只听发音 | 英文 |
| 读英语写汉语 | 显示英文 | 中文 |
| 语文听写 | 听读音 | 汉字 |
| 看拼音写词语 | 显示拼音 | 汉字 |

词表设计见 [WORDLIST-SPEC.md](WORDLIST-SPEC.md)。

## 技术栈

- 服务端：Node.js（只用内置模块，零 npm 依赖）
- OCR：飞桨 PaddleOCR-VL（服务端持有 token；MinerU 作为链接识别备选）
- 语音：edge-tts（中文 `zh-CN-XiaoxiaoNeural`，英文 `en-US-AriaNeural`），按文本哈希缓存
- 存储：`data/batches.json` + `data/audio/*.mp3`
- 前端：原生 HTML/CSS/JS，无构建步骤，移动优先

## 本地运行

```bash
cp .env.example .env      # 填入 PADDLEOCR_TOKEN 等
PORT=8090 node server.js
```

需要本机可用的 `python3` 与 `edge-tts`（`pip install edge-tts`）。

## 部署

生产机：`/opt/dictation/app`，systemd 服务 `dictation.service`（127.0.0.1:8083），
nginx 把 `https://www.ownclass.top/tingxie/` 反代到该端口。

```bash
tar -czf /tmp/dict-app.tgz server.js public WORDLIST-SPEC.md
scp /tmp/dict-app.tgz ownclass:/tmp/
ssh ownclass 'tar -xzf /tmp/dict-app.tgz -C /opt/dictation/app && systemctl restart dictation'
```

## 已知限制（v0.1）

- 不做自动判分：孩子在纸上写，网页只报听写、对答案时人工打勾。
- 不做用户体系：批次链接只有随机 id，拿到链接即可打开。
- OCR 识别错误（如「语文」认成「吾文」）需要用户对照原图确认，这一步不自动化。
- 服务端不保存任何学生个人信息；批次里只有词表。
