# 开发与交付流程

适用于听写小站的人工开发、本地代理、云端代理和多个对话并行协作。代理入口为 [AGENTS.md](AGENTS.md)，部署操作见 [DEPLOY.md](DEPLOY.md)。

## 1. 一项改动如何完成

默认流程：**明确目标 → 同步基线 → 独立分支／工作区 → 实现 → 验证 → commit → push → PR → CI／审查 → 合并 → 同步主分支 → 按需部署**。

“一项”指可独立解释、验证和回退的需求或修复，不是每改一个文件就开 PR。同一任务的修正继续提交到同一 PR；无关功能另开任务。较长任务在已有可交接提交时推送并开 Draft PR，写清剩余工作，避免全部成果只留在某台机器。

实施任务默认包括提交、推送和创建／更新 PR；用户要求仅分析或仅本地修改时例外。合并和上线按照已有用户授权执行，没有授权时保持 PR 待审，不擅自合并或部署。

## 2. 开始前与并行协作

先检查，而不是直接编辑：

```sh
git status --short --branch
git branch -vv
git worktree list
git fetch origin
```

- 新任务以最新 `origin/main` 为基线；续做原任务先核对其远端分支和 PR。原 PR 已合并或关闭时，新工作从 main 新建分支。
- 当前目录干净且本任务独占时，可以直接创建分支，例如 `git switch -c codex/fix-player-retry origin/main`。
- 当前目录存在其他任务修改，或多个对话并行写入时，各用独立 worktree 和分支。在 Codex 中优先使用工作区管理工具；普通终端可使用 `git worktree add -b codex/fix-player-retry ../dictation-player-retry origin/main`。目录名、分支名必须唯一。
- 不把其他任务的未提交修改当成可用基线，不替别人 stash、reset、checkout 文件或提交。避免在混用目录执行自动格式化。
- 已有远端任务分支继续开发时，先检查本地与远端差异；干净且可快进时拉取。出现分叉先核对双方提交，再合并处理，不能用强推覆盖别人。
- 在任务说明或 PR 中记录目标、分支、涉及模块、依赖 PR。两个任务都需要改同一接口／模型时，先合并公共前置改动，再让后续任务同步。
- 必须提前依赖另一个未合并 PR 时，显式把该 PR 分支作为 base，并在说明中写清依赖；前置 PR 合并后调整 base 为 main，核对 diff 并重新验证。

worktree 隔离源码，不自动隔离端口和外部数据。每个工作区独立安装依赖；开发实例使用独立端口和 `DATA_DIR`，前后端代理地址须一致。当前浏览器测试默认占用 8898，未配置独立端口前串行运行。不得同时操作生产数据库或终止别的对话使用的服务。

## 3. 命名规范

分支：`codex/<type>-<short-topic>`，使用小写英文、数字和短横线；已有 issue 时可用 `codex/fix-42-player-retry`。不使用 `temp`、`new`、`final-v2` 等无法说明目的的名字。

提交与 PR 标题：`<type>(<scope>): <说明>`，scope 可省略，冒号后一个空格。说明可用中文，直接描述结果，不写“修改代码”“更新一下”或无意义的 `wip`。

| type | 用途 | 示例 |
| --- | --- | --- |
| feat | 新能力 | `feat(tasks): 支持错词重新派发` |
| fix | 缺陷修复 | `fix(player): 保留交卷失败后的进度` |
| docs | 文档与规范 | `docs(workflow): 规范提交与并行开发流程` |
| refactor | 不改变行为的重构 | `refactor(auth): 合并重复会话校验` |
| test | 测试 | `test(tasks): 覆盖重复交卷` |
| perf | 性能改进 | `perf(audio): 复用重复音频请求` |
| style | 不改变行为的代码格式调整 | `style(server): 统一导入格式` |
| build | 构建或依赖 | `build(deps): 更新构建依赖` |
| ci | 持续集成 | `ci: 补充 schema 一致性检查` |
| chore | 其他维护 | `chore: 清理过期配置` |
| revert | 回退 | `revert(player): 回退自动跳词改动` |

scope 尽量使用稳定模块名，如 `web`、`server`、`tasks`、`player`、`audio`、`auth`、`mcp`、`contract`、`workflow`。破坏兼容的修改使用 `feat(contract)!: ...` 等形式，并在提交正文和 PR 中写清兼容影响、迁移及回退方法。Git 自动生成的 merge 提交标题无需改写。

一个 commit 只处理一个逻辑目的，可以包含实现、对应测试和必要文档；独立目的拆开提交。PR 标题反映最终整体行为，范围改变后同步更新标题与正文。

## 4. 开发与验证

工具版本以 `.nvmrc`、`package.json` 和锁文件为准：当前 Node.js 24+、pnpm 12.6.0，安装执行 `pnpm install --frozen-lockfile`。只有有意变更依赖时才更新锁文件。

| 改动 | 本地验证要求 |
| --- | --- |
| 仅 Markdown／PR 模板 | 核对内容、相对链接、示例命令，执行 `git diff --check`；说明不跑应用测试的原因 |
| 应用／共享代码、配置或依赖 | `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，按影响补充回归用例 |
| 数据契约／交换 schema | 以上检查，加 `pnpm schema:export`，核对并提交 `schema/` 中预期变更 |
| 页面交互／API 流程／权限 | 以上检查，加相关 Playwright 用例；跨模块流程运行完整 `pnpm e2e` |
| 音频／手机／打印 | 相关自动化加目标设备人工验收，记录设备、结果及未验证的边界 |

首次运行浏览器测试前执行 `pnpm exec playwright install chromium webkit`。本地可用 `pnpm exec playwright test e2e/tasks.spec.ts` 跑相关用例；完整 CI 仍须通过，不用局部测试替代合并门槛。

现有 [.github/workflows/ci.yml](.github/workflows/ci.yml) 在 PR、main 推送或手动触发时执行 lint、类型检查、单元／接口测试、schema 一致性、构建以及 Chromium／WebKit E2E。CI 的 schema 一致性命令为 `pnpm schema:export && git diff --exit-code -- schema`；本地修改契约后应先生成并审查 schema，再提交。

每次验证记录实际命令和结果。失败区分本次回归、已有问题、环境限制，保留复现信息；不靠删测试、改断言或无理由重跑掩盖失败。验证后的代码又改变时，补跑受影响检查。

## 5. 提交、推送和 PR

以下是示例，文件名与说明按实际任务替换。每步成功并核对结果后再继续：

```sh
git diff --check
git diff
git add -- AGENTS.md CONTRIBUTING.md .github/pull_request_template.md README.md
git diff --cached --check
git diff --cached
git commit -m "docs(workflow): 规范提交与并行开发流程"
git push -u origin HEAD
```

确认暂存区没有其他任务文件、密钥、数据库、音频、构建产物或截图等临时文件。同一文件包含多项任务时按补丁暂存，无法可靠拆分时换独立工作区处理，不能整包混交。

推送后创建／更新 PR，默认目标为 main；优先使用可用的 GitHub 集成，也可通过网页或 `gh pr create`。使用 [PR 模板](.github/pull_request_template.md)，至少说明：原问题及最终行为、改动范围、依赖、实际验证、风险和部署影响。未完成使用 Draft，验证／审查条件满足后再转为待审。

检查 PR 的提交列表和文件 diff 只包含本任务。随后确认远端已收到提交：

```sh
git rev-parse HEAD
git ls-remote origin refs/heads/codex/docs-development-workflow
```

将示例分支换成实际分支，两个 SHA 应相同。继续查看该 HEAD 对应的 CI；旧提交的绿色结果不能代表最新提交通过。CI 失败应定位并修复，已有 PR 直接追加提交，不重复开 PR。

若网络、认证或权限导致 push／建 PR 失败，保留本地提交，报告分支、SHA、具体失败及重试步骤；不得声称已同步。环境无法完成验证时同样明确标记，可以用 Draft PR 交接，但不能说已满足合并条件。

## 6. 合并与各端同步

三个状态分别记录：

| 状态 | 含义 | 获取方式 |
| --- | --- | --- |
| 已推送任务分支 | GitHub 有这项未合并工作 | 其他环境 fetch 后检出该分支／提交 |
| 已合并 main | 代码已进入团队集成基线 | 干净 main 工作区执行 `git pull --ff-only origin main` |
| 已部署线上 | 服务器已运行指定版本并验收 | 按 DEPLOY 发布并记录实际版本与健康检查 |

不在云端编辑器重新实现同一份修改。未合并工作只能从它的远端分支获得；main 不会自动包含所有 PR。当前 CI 没有自动部署步骤，push 或合并都不能报告为“线上已更新”。

合并前再次 `git fetch origin`。如果 main 已前移，在干净的任务分支执行 `git merge origin/main`，解决冲突，重新验证并 push；确认最新 HEAD 的 CI、diff 和审查结果。默认使用 **Squash and merge**，最终标题沿用 PR 命名规范；只有获得合并授权后才执行。

已推送或有人协作的分支默认保留历史，通过 merge 同步，不 rebase／force push。即使发生冲突，也不能把另一侧内容整段覆盖来“消除冲突”。

合并后：

1. 确认 PR 为 merged，并记录合并后的 main SHA（squash 后通常不同于任务分支 SHA）。
2. 在干净、无人写入的 main 工作区快进同步；活跃任务保持各自分支，在安全节点 merge 最新 `origin/main` 并重验，不跨对话操作别人的工作区。
3. 确认任务无剩余改动、无未推送提交、没有后续任务依赖该分支后，再清理任务分支／工作区。由 Codex 管理的 worktree 使用归档功能，不直接递归删除目录。
4. 已有线上发布授权时按 DEPLOY 发布、备份、验收和记录版本；没有部署动作则明确写“未部署”。

已有对话和旧 worktree 不会仅因新增规范就自动获得文件；需要在安全节点同步包含本规范的提交，并重新阅读 AGENTS 与本指南。未提交的历史功能修改应由所属任务按范围整理、验证并单独提交 PR，不得夹带进规范 PR。

## 7. 完成标准与交付说明

**默认开发交付完成**：实现及必要文档齐全；相关本地验证通过（或明确说明例外）；本任务已 commit、push，远端 SHA 已确认；PR 可审查且最新 HEAD 的 CI 已通过。CI 排队／执行中只能报告“等待 CI”；失败／阻塞报告真实状态。

**合并完成**与**上线完成**是后续独立状态：分别需要合并记录、部署版本及验收结果。发布范围包含数据库或配置变更时，说明备份、迁移、兼容性与回退方式。

最终交付说明应包含：

- 改了什么，以及用户能观察到的结果。
- 实际验证和未验证项。
- 分支名、commit SHA、PR 链接及当前 CI 状态。
- 是否已合并、是否已部署，以及剩余阻塞或风险。

本规范和模板是工作约定，不能替代 GitHub 分支保护。若要服务器强制执行，可在仓库 Rulesets／分支保护中要求 main 通过 PR 合并、`check` 状态通过并禁止强推；评审人数按实际协作人数设置。本次文档不代表这些远端保护已启用。
