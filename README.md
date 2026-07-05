# TodayOps 工作台

TodayOps 是一个面向研发个人的 AI 工作驾驶舱：把天气、禅道任务 / Bug、本地待办、知识库、wbscf-web 本地 dev 服务和 Git 仓库状态收进同一个首页，由「小吴」主动判断今天最该处理什么，并在需要时接手查询、规划和执行受控操作。

它不是传统导航页。首页的主角是统一收件箱和 AI 主动洞察：打开工作台后，你应该能快速知道「现在有什么事」「哪几件最急」「为什么它们重要」「下一步可以让小吴帮我做什么」。

## 核心能力

- **统一收件箱**：聚合指派给我的禅道任务、禅道 Bug 和本地待办，按紧急程度、优先级、截止日期统一排序。
- **AI 风险判断**：确定性识别逾期、临期、停滞、同需求线任务与 Bug 并存、Bug 集中、负载过重等模式，给出可解释的「小吴的洞察」。
- **每日晨报**：小吴每天基于真实工作台快照生成今日简报，点名今天先抓什么，并缓存到本地，避免反复调用 LLM。
- **命令面板助手**：通过 `Alt+K` / `Cmd+K` 唤起小吴，支持流式对话、工具调用、多轮 agent 循环、图片输入、重新生成和反馈。
- **工具调用体系**：天气、禅道、知识库、本地待办、wbscf 本地服务、Git、Claude Code 启动能力按配置动态暴露给模型。
- **本地待办**：纯前端持久化，支持创建、编辑、完成、删除、附件、截图粘贴和 LLM 管理。
- **知识库检索**：通过 `VITE_KB_SOURCE` 接入项目外 Markdown 文档或远程 manifest，小吴可检索内部流程、环境地址和笔记。
- **外部调研**：通过 Agent Reach 在本地 dev 场景为小吴补充公开互联网搜索、网页阅读、GitHub 仓库分析、YouTube/B站视频信息与字幕读取能力。
- **wbscf-web dev 服务**：状态栏可查看并启动账号、买家、卖家、运营、ERP 等子应用本地服务。
- **Git 仪表盘**：查看 wbscf-web 仓库分支、同步状态、改动、提交、diff、blame、reflog、tag、stash，并支持受控 Git 操作。
- **天气状态栏**：展示实时天气、预报、生活指数、AQI、预警等信息，并作为小吴规划上下文的一部分。

## 产品形态

首页分为两块：

- 左侧情报柱：今日状态、天气概览、每日晨报。
- 右侧工作面：统一收件箱、风险徽标、需求线分组、AI 洞察、清单 / 星图视图。

小吴不是单独的聊天装饰，而是嵌在工作流里：

- 风险状态条可直接让小吴排处理顺序。
- 行内风险徽标可把单项工作交给小吴分析。
- 晨报底部可继续深聊今天安排。
- Git diff、仓库健康、冲突状态等位置可把上下文交给小吴解释。

## 技术栈

Vue 3（Composition API + `<script setup>`） / TypeScript / Vite / Pinia / Vue Router 4 / Tailwind CSS 4 / unplugin-icons（Iconify）/ markdown-it / Three.js。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

`npm install` 只安装前端依赖。Agent Reach、wbscf/Git、Claude Code 等本机 CLI 能力属于可选增强，需要按下方说明单独安装或配置。

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，按需填入真实配置：

```bash
cp .env.example .env
```

最小可用配置是天气和禅道；要启用小吴、知识库、wbscf/Git 等能力，需要继续配置对应变量。所有敏感配置都只放在本地 `.env`，不要提交。

### 3. 可选：安装外部调研能力

如果需要让小吴搜索公开互联网、读网页、分析 GitHub 仓库、总结 YouTube/B站视频，运行：

```bash
npm run setup:reach
```

这个脚本会检查/安装 Python 3.12、pipx、Agent Reach、`yt-dlp`、`bili` 等本机 CLI，并提示 `.env` 是否已开启 `VITE_AGENT_REACH_ENABLED=true`。不需要外部调研时可以跳过，不影响基础工作台启动。

### 4. 启动开发服务器

```bash
npm run dev
```

默认地址：http://localhost:5173

### 5. 构建与预览

```bash
npm run build
npm run preview
```

当前没有配置测试框架。

## 环境变量

| 变量 | 说明 | 是否必填 |
|---|---|---|
| `VITE_QWEATHER_API_KEY` | 和风天气 API Key | 使用天气时必填 |
| `VITE_QWEATHER_API_HOST` | 和风天气专用 API Host，新版账户通常需要 | 可选 |
| `VITE_ZENTAO_BASE` | 禅道服务地址 | 使用禅道时必填 |
| `VITE_ZENTAO_ACCOUNT` | 禅道账号 | 使用禅道时必填 |
| `VITE_ZENTAO_PASSWORD` | 禅道密码 | 使用禅道时必填 |
| `VITE_ASSISTANT_NAME` | 助手名称，默认「小吴」 | 可选 |
| `VITE_ASSISTANT_TAGLINE` | 助手一句话定位 | 可选 |
| `VITE_KB_SOURCE` | 知识库来源，本地 Markdown 目录或远程 JSON manifest | 使用知识库时必填 |
| `VITE_WBSCF_WEB_ROOT` | wbscf-web 仓库根目录，用于 dev 服务和 Git 仪表盘 | 使用 wbscf/Git 时必填 |
| `VITE_WBSCF_PKG_MGR` | 启动 wbscf-web dev 脚本的包管理器，默认 `pnpm` | 可选 |
| `VITE_AGENT_REACH_ENABLED` | 是否启用 Agent Reach 外部调研工具，仅 dev 生效，设为 `true` 后暴露 `reach.*` 工具 | 使用外部调研时必填 |
| `VITE_AGENT_REACH_CMD` | Agent Reach CLI 命令或路径，默认 `agent-reach` | 可选 |

开发环境下，天气、禅道、LLM、wbscf 和 Git 相关能力通过 Vite 代理或 Vite 插件完成。改动 `.env` 后通常需要重启 dev server。

### Agent Reach 外部调研

第一期只接低风险的公开只读能力，不接小红书、Twitter、Reddit 等需要登录态的平台，也不做后台自动监控。

启用步骤：

```bash
npm run setup:reach
```

然后在 `.env` 中开启：

```env
VITE_AGENT_REACH_ENABLED=true
# VITE_AGENT_REACH_CMD=agent-reach
```

开启后，小吴会在用户明确要求“查一下 / 调研 / 读链接 / 分析 GitHub 仓库 / 总结视频”时使用这些工具：

- `reach.status`：检查 Agent Reach 与上游工具是否可用。
- `reach.search`：公开互联网搜索，优先走 Agent Reach 配置的 Exa/mcporter，失败时 dev server 尝试公开搜索兜底。
- `reach.read_url`：通过 Jina Reader 读取公开网页正文。
- `reach.github_repo`：读取公开 GitHub 仓库元信息、README、最近提交和近期 issue。
- `reach.video_summary`：读取 YouTube/B站视频信息；优先读取字幕，缺字幕时返回标题、简介、UP 主、互动数据等元数据并说明限制。
- `reach.markdown_note`：把调研结论整理成 Markdown，便于复制到知识库、任务备注或周报。

所有返回都会裁剪长度并带来源链接。若本机未安装对应 CLI，工具会返回明确错误，不影响小吴其它能力。

第二期体验增强：

- 调研类回复遵循「结论 / 关键发现 / 对本项目的影响 / 风险 / 下一步 / 来源」模板。
- 搜索、网页、GitHub、视频、诊断结果会自动渲染 UI 卡片，并把来源做成可点击链接。
- GitHub 仓库评估固定输出适配点、集成成本、维护风险和引入建议。
- 视频无字幕时会明确说明限制，并给出 OpenCLI 或 `agent-reach transcribe` 的兜底路径。
- 用户说“沉淀一下 / 整理成文档 / 生成 Markdown”时，小吴可生成 Markdown 调研记录。

## AI 助手与工具

小吴的工具由 `src/features/chat/tools.ts` 聚合，并按真实配置动态启用：

- 天气工具始终随天气模块可用。
- 禅道工具只读，用于查询我的任务 / Bug 及详情。
- 本地待办工具可写，可创建、修改、完成和删除本地任务。
- 知识库工具在 `VITE_KB_SOURCE` 有效时启用。
- wbscf 和 Git 工具仅在 dev 环境且配置 `VITE_WBSCF_WEB_ROOT` 后启用。
- Claude Code 启动工具按 Claude 模块配置启用。
- Agent Reach 外部调研工具仅在 dev 环境且 `VITE_AGENT_REACH_ENABLED=true` 后启用。

Git 写操作、删除任务等高风险动作在产品上应要求用户确认。当前 prompt 已要求小吴先说明影响并获得确认，后续建议继续把确认机制下沉到工具执行层。

## 数据与持久化

项目没有业务后端。持久化主要在浏览器本地：

- `localStorage`：天气城市、禅道 session、本地任务元数据、聊天历史、反馈统计、每日晨报、收件箱洞察缓存等。
- `IndexedDB`：本地任务附件二进制内容。
- 图片消息：只在当前会话内存中保留，不写入 localStorage，避免撑爆浏览器存储。

常见 localStorage key（历史上使用 `hao123-*` 前缀；为兼容已有本地数据，当前仍保留这些 key）：

- `hao123-weather-city-coord`
- `hao123-weather-city-name`
- `hao123-weather-mode`
- `hao123-zentao-sid`
- `hao123-chat-history`
- `hao123-chat-feedback`
- `hao123-local-tasks`
- `hao123-local-clear-celebrated-date`
- `hao123-morning-briefing`
- `hao123-inbox-insight`
- `hao123-onboarding-done`

更改默认数据或调试缓存问题时，可能需要清理对应 key。

## 项目结构

```text
src/
├─ components/                 # 首页、布局、状态栏、公共弹窗、统一收件箱、Git 仪表盘
│  ├─ inbox/                   # 收件箱星图等子组件
│  └─ status/                  # 顶部状态栏、导航、天气/Git/Claude 入口
├─ composables/                # useStorage、useTime 等通用组合式函数
├─ features/
│  ├─ chat/                    # 小吴：LLM provider、agent loop、工具聚合、晨报、洞察文案、命令面板
│  ├─ insights/                # 确定性风险预测和深度洞察检测
│  ├─ weather/                 # 和风天气 API、store、工具、组件
│  ├─ zentao/                  # 禅道任务 / Bug / session / 只读工具
│  ├─ local-tasks/             # 本地待办、附件 IndexedDB、LLM 工具、表单弹窗
│  ├─ kb/                      # 知识库来源、切片、搜索、LLM 工具
│  ├─ wbscf/                   # wbscf-web dev 服务状态、启动、工具
│  ├─ git/                     # Git 仪表盘、API、LLM 工具
│  ├─ reach/                   # Agent Reach 外部调研：搜索、读网页、GitHub 仓库、视频信息/字幕、报告模板、UI 卡片
│  └─ claude/                  # Claude Code 启动入口与工具
├─ router/
├─ App.vue
└─ main.ts
```

根目录 Vite 插件：

- `vite-plugin-kb.ts`：读取本地知识库 Markdown 并注入虚拟模块。
- `vite-plugin-wbscf.ts`：探测 / 启动 wbscf-web 本地 dev 服务。
- `vite-plugin-git.ts`：在 dev server 侧执行 Git 查询与受控操作。
- `vite-plugin-agent-reach.ts`：在 dev server 侧桥接 Agent Reach 只读外部调研能力。

## 开发约定

- 外部引用特性模块时优先走各模块 `index.ts` barrel，不直接触达内部实现路径。
- 持久状态统一优先使用 `useStorage<T>(key, default)`。
- 图标使用 `import IconXxx from '~icons/<collection>/<name>'`。
- 天气、禅道、本地待办、知识库、wbscf、Git 等模块都通过 `llm-tools.ts` 暴露 provider 无关工具声明和执行器。
- AI 相关能力优先区分「确定性判断」和「LLM 表达」：风险预测等稳定逻辑不要交给模型即兴发挥。

## 重要提醒

- `.env` 不要提交；小吴的大模型线路在页面内「模型线路控制台」管理，API Key / Base URL / 模型列表保存在本机 localStorage，dev 代理只负责转发请求。
- 视觉输入需要模型支持图片。默认模型如果不支持 vision，发送图片会返回模型错误，但应用不会崩溃。
- wbscf/Git/Claude 启动类能力只在本地 dev 场景有意义，生产构建会自动降级或隐藏入口。
- README 描述的是当前产品定位；更细的模块设计与约定请看 `AGENTS.md`。
