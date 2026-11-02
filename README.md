# 听写小站 · OwnClass

一份词表，多种练法。网页报词，孩子用纸笔写，结束后自主核对并重练错词。

支持读汉语写英语、读英语写英语、读英语写汉语、语文听写、看拼音写词语五种模式。可以直接粘贴文字、导入 JSON，或上传图片识别后人工核对；也可以复制提示词交给自己的 AI 整理。图片识别、服务器语音均为可选项，基础听写默认使用设备朗读。

## 本地运行

需要 Node.js 24+、pnpm 12.6.0。

```sh
pnpm install
pnpm build
pnpm start
```

打开 `http://127.0.0.1:8083/`。可复制 `.env.example` 为 `.env` 配置 OCR、端口、数据目录等。首次打开创建账号，之后登录使用。一个账号一个词库，读写均按账号隔离；设置 ALLOW_REGISTRATION=false 可关闭注册。

开发用两个终端分别运行 `pnpm dev`（API，8083）与 `pnpm dev:web`（前端，5198）。前端使用相对资源和 API 地址，支持 `/tingxie/` 子路径，配置见 [部署说明](DEPLOY.md)。

## 使用流程

1. 新建听写，粘贴原文或 JSON，也可选择 PNG/JPEG/WebP 原图。原图在本次页面提供放大核对；仅点击识别时会发送至配置的 OCR 服务，刷新后需要重新选择图片。
2. 整理并预览，逐词修改、试听。错误阻止保存；重复、多音字等提醒不自动改写。导入/编辑草稿保存在本机，可恢复和导出。
3. 保存词表，选择模式、顺序、语速、重复次数与写字间隔。听音模式点击开始即朗读；拼音模式手动切词。
4. 停止、重播、切词、临时查看答案，或暂存返回。刷新后从词表详情继续上次进度；切到后台会暂停，回来需手动继续。
5. 结束后标记正确/错误/未核对，只练错词。词表编辑后旧进度不会混入新版本，可先导出旧进度备份。
6. 导出版本化 JSON，或使用本账号链接／二维码在另一台设备打开（需登录相同账号）。JSON 可再次导入。草稿和当前听写进度仍只在本机按账号保存，跨设备任务进度将在后续阶段实现。

## 技术结构

- `packages/contract`：Zod 数据契约及推导类型，`schema/wordlist.schema.json` 是生成的交换格式 schema。
- `packages/core`：纯 TypeScript 导入解析、校验提醒、播放生命周期和错词合并。
- `apps/server`：Hono + Drizzle + better-sqlite3；OCR/TTS 由服务端适配器调用。
- `apps/web`：React + Vite + TypeScript，移动端逐词编辑、本机草稿和听写进度。
- `apps/server/drizzle`：drizzle-kit 生成的迁移；`pnpm db:generate` 生成结构变更。

数据默认存放在 `data/dictation.db` 与 `data/audio/`。本轮不迁移旧版数据：使用空 DATA_DIR 开始，不导入旧 JSON。写入落盘后才确认成功，编辑和删除通过 revision 防止陈旧覆盖。

## 验证

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm schema:export
pnpm build
pnpm exec playwright install chromium webkit
pnpm e2e
```

单元/接口测试使用临时目录，浏览器测试使用独立临时数据库与 8898 端口。OCR/TTS 测试使用合成适配器；浏览器测试模拟朗读事件，不能替代目标设备的真实发音和 iOS 播放验收。

## 与 OwnClass 的关系

本轮是独立工具重构，尚未接入主项目账号、课程布置或学情记录。未来先用入口跳转和版本化 JSON 关联，再迁入主项目现有契约、路由与权限体系，详见[重构方案](docs/TypeScript重构方案.md)。

词表与答案仅本账号可读写，OCR 原文不在词表响应或导出中下发。它仍是自主练习工具，不能直接充当主项目的考试接口。后续任务与复习安排见[开发计划](docs/听写小站开发计划.md)，当前进度见[实施记录](docs/实施进度.md)。

Your data. Your way. All for learning.
