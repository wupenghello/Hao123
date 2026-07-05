# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start dev server (Vite, default port 5173)
- `npm run build` — Type-check (`vue-tsc -b`) then production build
- `npm run preview` — Preview production build locally

No test framework is configured yet.

## Architecture

**Tech stack:** Vue 3 (Composition API + `<script setup>`) / TypeScript / Vite / Pinia / Vue Router 4 / Tailwind CSS 4 / unplugin-icons (Iconify)

**Path alias:** `@` → `src/` (configured in `vite.config.ts` and `tsconfig.app.json`)

### Data flow

All persistent state uses `useStorage<T>(key, default)` (`src/composables/useStorage.ts`) — a reactive `ref` backed by `localStorage` with deep watch. Pinia stores wrap these refs.

**localStorage keys:** `hao123-weather-city-coord`, `hao123-weather-city-name`, `hao123-weather-mode`, `hao123-zentao-sid`（禅道会话 ID）, `hao123-chat-history`（对话历史）, `hao123-chat-feedback`（反馈统计 {up, down, regenerations}）, `hao123-local-tasks`（本地任务列表）, `hao123-morning-briefing`（每日晨报）, `hao123-inbox-insight`（收件箱洞察 LLM 文案，按日 + 检测签名缓存）. When changing default data, users may need to clear these keys to see updates.

### Component hierarchy

```
App.vue (router-view)
  └─ Layout.vue (single-page layout)
       ├─ status/StatusBar.vue   (顶部状态栏外壳：固定高度，三栏插槽)
       │    ↑ 通过具名插槽注入内容，Layout.vue 填充 #right(WeatherWidget + StatusTime)
       │    ↑ 可用插槽：#left / #center / #right
       └─ <main> 主内容区：渲染 <WelcomePage />（工作台首页，主角是统一收件箱 <UnifiedInbox />）

`WeatherWidget` 来自天气特性模块 `@/features/weather`；`UnifiedInbox` 是首页级组件（聚合禅道指派项 + 本地待办为一条清单，见下节）；外部只从各自 barrel 引入，不触达模块内部路径。
```

### 天气模块（`src/features/weather/`，自包含特性模块）

天气已整体收拢为一个自包含特性模块，外部统一从 `@/features/weather` 引入（barrel `index.ts`）：

| 文件 | 职责 |
|---|---|
| `types.ts` | 和风天气接口数据类型 |
| `api.ts` | 和风 API 客户端 `weatherApi`：`now` / `daily(3\|7\|10\|15)` / `hourly(24\|72\|168)` / `minutely` / `indices`（当前套餐可用的全部）；不可用的 `air` / `warnings` / `lookupByCoord` 保留封装、注明，开通后即用 |
| `store.ts` | Pinia 状态层 `useWeatherStore`：核心数据（now/daily）即时加载，富数据（hourly/indices/air/warnings）按需懒加载 |
| `llm-tools.ts` | **LLM 工具层**：`weatherToolDefs`（喂给大模型的工具声明，provider 无关）+ `callWeatherTool(name, params)`（执行）；城市解析走本地 `city-data.ts`，返回值已做 token 友好裁剪。接入 LLM 时直接用这两个导出 |
| `icons.ts` / `ui.ts` / `sun-times.ts` / `city-data.ts` | 图标映射 / AQI·预警配色 / 本地日出日落计算 / 中国城市坐标库 |
| `components/` | `WeatherWidget` 等 Vue 组件（对外只导出 `WeatherWidget`，其余为内部实现） |

**和风 API Host：** 新版账户需在 `.env` 配 `VITE_QWEATHER_API_HOST`（专用域名），dev 代理见 `vite.config.ts` 的 `/qweather`、`/qgeo`。

### 禅道模块（`src/features/zentao/`，自包含特性模块）

禅道集成同样收拢为自包含特性模块，外部统一从 `@/features/zentao` 引入（barrel `index.ts`）；`task/` 与 `bug/` 子模块互不依赖：

| 路径 | 职责 |
|---|---|
| `shared/` | 公共层：`http.ts`（鉴权 HTTP 核心，自动带 session cookie）、`session.ts`（会话 store，持久化 session ID 到 `hao123-zentao-sid`）、`types.ts` / `ui.ts` / `detail.css` |
| `task/` | 「我的任务」：`types.ts` · `api.ts` · `store.ts` · `ui.ts` · `components/TaskPanel`(+`TaskDetailModal`) |
| `bug/` | 「我的 Bug」：`types.ts` · `api.ts` · `store.ts` · `ui.ts` · `components/BugPanel`(+`BugDetailModal`) |
| `components/ZentaoPanel.vue` | 容器组件，把任务、Bug 两块并排组合；对外只导出 `ZentaoPanel` |

任务 / Bug 详情弹窗均复用项目级公共组件 `@/components/common/DetailModal.vue`。

**环境变量：** `.env` 需配 `VITE_ZENTAO_BASE` / `VITE_ZENTAO_ACCOUNT` / `VITE_ZENTAO_PASSWORD`；dev 代理见 `vite.config.ts` 的 `/zentao`（规避浏览器跨域与 `Set-Cookie` 丢失）。

### 知识库模块（`src/features/kb/`，自包含特性模块）

知识库以工具形式暴露给 LLM，与天气 / 禅道 / 本地待办工具层同构（`kbToolDefs` + `callKbTool`），在 `chat/tools.ts` 聚合（全量下发给模型，由模型自行选择调用，不再做关键词意图筛选）；外部统一从 `@/features/kb` 引入：

| 路径 | 职责 |
|---|---|
| `config.ts` | KB 来源配置（`kbConfig`，env `VITE_KB_SOURCE` 驱动；`isRemote` / `hasSource`） |
| `shared.ts` | 公共谓词 `isHttpSource`（Node 插件与浏览器侧 config 共用，无 fs 依赖） |
| `types.ts` | 文档原文 `RawDoc` / 片段 `KbChunk` 类型 |
| `source.ts` | 加载文档原文 `loadKbDocs`：本地走虚拟模块、远程 fetch manifest（带超时 + abort + 形状校验，in-flight Promise 去重） |
| `chunker.ts` | 按二级标题切分片段 `chunkDoc` + 标题提取 `docTitle`（纯函数；入口去 `\r` 兼容 CRLF） |
| `loader.ts` | 加载 + 切片 + 缓存 `getKbChunks`（缓存 Promise 去重并发）+ `clearKbCache` |
| `search.ts` | 关键词检索 `searchKb`（async；中文双字 bigram + 英文词，标题加权，适配 <50 篇） |
| `llm-tools.ts` | LLM 工具层 `kbToolDefs`（声明）+ `callKbTool`（执行，工具名 `kb.search`；出错返回 `{error}` 对齐禅道） |

**文档不放进项目：** 通过 `.env` 的 `VITE_KB_SOURCE` 指向项目外的来源，二选一：
- 本地文件夹路径（如 `D:/projects/todayops-kb`，Windows 用正斜杠）：由根目录 `vite-plugin-kb.ts` 在 dev/构建时读取 `*.md` 并注入虚拟模块 `virtual:kb-docs`；dev 改文档后刷新生效（插件已声明文件依赖并触发热更新），生产随构建打进包。**目录不存在时构建直接报错**（不静默打包空库）。
- http(s) URL：前端运行时 fetch，须返回 JSON 数组 `[{doc,title,content}, ...]`；浏览器直接 fetch 无代理，地址须同源或开放 CORS。

未配置（`VITE_KB_SOURCE` 为空）时不把 kb 工具暴露给模型，system prompt 也不宣称知识库能力（`chat/tools.ts` 的 `kbEnabled` 门控）。

首个 `#` 为文档标题、`##` 为段落切分点。**检索后端可替换：** 当前为浏览器内关键词检索，日后换向量 / 外部 RAG 仅改 `search.ts`，工具接口与上层不变。

### 本地任务模块（`src/features/local-tasks/`，自包含特性模块）

手动创建的任务，**与禅道无关**：纯前端 + localStorage（任务元数据）+ IndexedDB（附件二进制）持久化，不发任何网络请求。外部统一从 `@/features/local-tasks` 引入（barrel `index.ts`）：

| 路径 | 职责 |
|---|---|
| `types.ts` | `LocalTask`（id / title / note / done / pri / deadline / createdAt / attachments）+ `TaskAttachment` + 表单载荷 `LocalTaskInput` / `LocalTaskFormPayload`（含待新增文件与待移除附件 id） |
| `util.ts` | id 生成 `genId` / 图片判定 `isImageMime` / 体积格式化 `formatFileSize` / `MAX_ATTACHMENT_SIZE` |
| `attachments.ts` | 附件 Blob 的 IndexedDB 存储：`putAttachment`（写文件，回元数据）/ `getAttachmentBlob`（按 id 取，供预览·下载）/ `deleteAttachment`·`deleteAttachments`（删任务时连清 Blob，避免孤立数据） |
| `ui.ts` | 优先级徽标 `priBadge` / 截止日期判定 `hasDeadline`·`isOverdue`·`isToday`·`deadlineLabel` / 紧急判定 `isUrgentLocalTask`（自包含，刻意不引用 `zentao/shared/ui`，避免本地任务反向耦合禅道） |
| `store.ts` | Pinia 状态层 `useLocalTaskStore`：`tasks` 走 `useStorage('hao123-local-tasks', [])`；`add` / `update` / `toggle` / `remove` / `clearDone` 均为不可变更新；`addAttachment` / `removeAttachment` 编排 IndexedDB（Blob 读写只在 store 统一处理，组件只收集 File）；派生 `open`（按优先级+创建时间排）/ `done` / 计数 |
| `llm-tools.ts` | LLM 工具层 `localTaskToolDefs`（声明）+ `callLocalTaskTool`（执行，`local.list/create/update/complete/delete`，喂给小吴管理本地待办） |
| `components/LocalTaskFormModal.vue` | 新建 / 编辑弹窗（受控：`v-model:open` + `task` + `submit`）；标题必填、Enter 提交、Esc 关闭；附件支持拖放 / **粘贴（Ctrl+V 截图）** / 点击选择，图片走缩略图 + 大图预览、文件走 chip + 下载 |

**附件存储分层：** 任务元数据在 localStorage（`hao123-local-tasks`，含附件清单），附件二进制 Blob 存 IndexedDB（库 `hao123-local-tasks` / store `attachments`，key = 附件 id）——localStorage 装不下图片，故二进制单独走 IDB。表单提交时只回吐 File 数组 + 待移除附件 id，由 store 统一写 IDB，取消不落盘避免产生孤立 Blob。

字段口径与禅道任务对齐（`pri` 1~4 数字越小越高、`deadline` 为 `yyyy-MM-dd`、紧急 = 未完成且 pri≤2 或逾期）。**LLM 工具始终暴露**（纯前端无配置门槛）：小吴可查看 / 新建 / 修改 / 完成 / 删除本地待办（删除前会在 prompt 里要求向用户确认）。

### wbscf-web 本地 dev 服务模块（`src/features/wbscf/`，自包含特性模块）

把状态栏左上角导航（账号 / 买卖家 / 运营 / ERP）接入 wbscf-web 仓库的本地 dev 服务：每项 hover 菜单的 `dev` **之前**多一个 `localhost` 入口，点击即拉起并打开对应子应用的本地服务；已在运行则直接打开、不重复拉起，运行中用**绿色文字**标记（标签文字转绿 + localhost 行绿字；启动中琥珀字 + 转圈，未启动默认色）。外部统一从 `@/features/wbscf` 引入（barrel `index.ts`）：

| 路径 | 职责 |
|---|---|
| `config.ts` | 静态注册表 `wbscfServices`：app（account/buyer/seller/ops/erp）→ { label, script, port, base, url }；端口取自各 app 的 `apps/<app>/.env.development` 的 `VITE_PORT`（5661/5662/5663/5660/5668），前后端共用。刻意不读 `import.meta.env`（被根目录 Node 插件直接 import，env 读取放客户端 tools.ts） |
| `types.ts` | `WbscfServiceStatus`（available/running/booting）+ `WbscfServicesResponse` 契约 |
| `api.ts` | 浏览器侧 `fetchWbscfServices`（拉状态，非 2xx 抛错）+ `triggerWbscfLaunch`（`?json=1` 触发拉起并返回 JSON，供无手势的 LLM 路径）+ `wbscfLaunchUrl`（点击路径用：已在运行返回应用 URL，否则返回中转页地址） |
| `composable.ts` | `useWbscfServices`：响应式 `services` + 自驱递归轮询（4s，切后台暂停；失败保留旧状态不清空）+ `startOrOpen`（点击手势内 `window.open`）+ `statusOf` + 启动 toast（`toasts` / `startLaunchPoll` / `closeToast`，1.2s 自驱轮询、就绪转绿自动消失、卸载清理全部定时器） |
| `llm-tools.ts` | LLM 工具层 `wbscfToolDefs` + `callWbscfTool`（`wbscf.services` 查状态 / `wbscf.launch` 启动——后者长轮询可被 chat store 的 AbortSignal 中断；生产 404 降级为 `{enabled:false}`） |

浏览器无法 spawn 进程，真正的拉起 / 探测由根目录 **`vite-plugin-wbscf.ts`**（dev server Node 侧，同 `vite-plugin-kb.ts` 模式）承担，`configureServer` 挂中间件：

- `GET /wbscf/services`：读 `wbscf-web/package.json` 校验 `dev:*` 脚本是否存在（`available`），HTTP 探测 `localhost:port`（任意响应即视为就绪，`running`；探测结果 ~600ms 短缓存，避免多路轮询全量重复探测），综合返回 `{ enabled, root, services[] }`；
- `GET /wbscf/launch?app=<app>`：`ensureStarted` 幂等拉起（本插件已拉起 / 外部已在运行 / 脚本不存在 / 根未配置 都不重复拉）后——`?json=1` 返回 JSON 状态（LLM/无手势路径），否则返回「拉起 + 等端口就绪 + `location.replace` 跳转」的中转 HTML（带硬墙钟超时，连接挂起也能到点报错；供前端点击 `window.open`）；
- 拉起用 `VITE_WBSCF_PKG_MGR`（默认 `pnpm`）执行 `run <script>`，cwd=wbscf-web 根，stdio 继承到 TodayOps dev 终端；进程同时监听 `exit` 与 `error`（spawn 失败也复位 state，避免永久卡「启动中」）；TodayOps dev server 退出（含 SIGINT/SIGTERM）时连带收掉拉起的子进程树（Windows `taskkill /T /F`，非 Windows 杀进程组），避免孤儿 dev server。

**仅 dev 生效**；是否把 wbscf 工具暴露给模型由 `chat/tools.ts` 的 `wbscfEnabled`（dev 且配了 `VITE_WBSCF_WEB_ROOT`）门控（对齐 `kbEnabled` 约定）——生产或未配置时不暴露工具、system prompt 也不宣称该能力。**环境变量：** `.env` 配 `VITE_WBSCF_WEB_ROOT`（wbscf-web 根目录，Windows 用正斜杠）+ 可选 `VITE_WBSCF_PKG_MGR`；改动后需重启 dev。未配置时入口隐藏，dev/test/pre 不受影响。`StatusNav.vue` 的 `navItems` 前 5 项带 `local`（app key）即自动渲染该入口。

### 大模型设置模块（`src/features/model-config/`，自包含特性模块）

页面内管理小吴使用的 OpenAI-compatible 大模型线路（Provider / API Key / Base URL / 模型列表），外部统一从 `@/features/model-config` 引入；`src/features/chat/model-config.ts` 仅保留兼容 barrel，状态栏旧路径 `src/components/status/ModelConfigModal.vue` 仅保留 wrapper：

| 路径 | 职责 |
|---|---|
| `types.ts` | `ProviderConfig` / `ModelEntry` / `ActiveLlmConfig` / 预设与连通性测试类型 |
| `presets.ts` | 常见 OpenAI-compatible Provider 预设（DeepSeek / OpenAI / 通义 / Moonshot / GLM / 硅基流动 / 豆包），带 Base URL、常用模型与使用建议 |
| `store.ts` | 模块级响应式状态 + localStorage（`hao123-llm-config`）持久化；多 Provider / 多模型 CRUD、激活线路、导入导出、测试结果记录、给 LLM 层读取 `getActiveConfig` / `getClientAuthBody` |
| `connection-test.ts` | 经 dev 代理 `/deepseek/chat/completions` 发最小 ping 测试连接，避免浏览器 CORS；请求体携带 `api_key` / `base_url`，代理剥离后转发 |
| `ui.ts` | API Key 脱敏、当前模型名、测试时间与 Provider 健康状态文案 |
| `components/ModelConfigModal.vue` | 「模型线路控制台」弹窗：左侧保存线路和状态，右侧预设 Provider、Key/Base URL、模型编排、连接测试、导入导出 |

API Key 明文存在本机 localStorage，仅定位为本地开发工作台；真正请求通过 `vite-plugin-deepseek-fallback.ts` 注入 Authorization 后转发到用户配置的 `base_url`。

### 聊天助理模块（`src/features/chat/`，自包含特性模块）

小吴——嵌在工作台里的 AI 助理。命令面板形态（`Alt+K` / `⌘K` 召唤），agent 循环 + 工具调用，外部统一从 `@/features/chat` 引入（barrel `index.ts`）：

| 路径 | 职责 |
|---|---|
| `config.ts` | 助手身份（`ASSISTANT_NAME`）；LLM 接入参数由 `src/features/model-config` 页面内管理 |
| `connectivity.ts` | **LLM 连通性状态层**（模块级单例，非 Pinia）：把「连不上大模型」从被动等 7s 重试变成全局可观测 + 自动恢复的状态机（详见下文「连通性」节） |
| `llm/` | provider 无关抽象（`LlmProvider`：`chatStream` 流式 + `complete` 一次性）+ OpenAI 兼容实现（SSE 解析、工具调用增量拼接、瞬态错误指数退避重试） |
| `tools.ts` | **工具聚合层**：把各特性模块的中立工具声明适配为 OpenAI 格式并按名前缀分发；`kbEnabled` / `wbscfEnabled` / `reachEnabled` / `claudeEnabled` 按真实配置门控（未配置不暴露工具、system prompt 也不宣称该能力） |
| `store.ts` | Pinia `useChatStore`：**agent 循环**（流式 → 有 `tool_calls` 则并行执行并回灌 → 继续，最多 5 轮）；工具全量下发由模型自选，不做关键词意图筛选；历史 token 截断；abort / retry / 重新生成；👍/👎 反馈统计 |
| `dashboard-context.ts` | 工作台上下文采集（天气 + 指派给我的禅道任务/Bug + 本地待办，编码翻中文），welcome-guide 与晨报**共享**，in-flight 去重（并发只发一次禅道请求） |
| `welcome-guide.ts` | 命令面板快捷提问：LLM 站在前端视角生成 `suggestions`（失败回退静态兜底，模块级单例只生成一次）；首页「行动建议」已合并进晨报，不再产 headline |
| `briefing.ts` | **每日晨报**：LLM 综合工作台快照生成「今日简报」Markdown，`useStorage` 持久化（`hao123-morning-briefing`），**今日只自动生成一次**、跨刷新复用、次日或手动点刷新才更新 |
| `inbox-insight.ts` | **收件箱洞察（LLM 主动开口）**：基于 `insights` 模块的**确定性检测**（同根因 / Bug 集中 / 多项逾期 / 负载 / 高优停滞），命中才让 LLM 加工成一句自然提醒 + 具体建议（`useInboxInsight`，`hao123-inbox-insight` 按日 + 检测签名缓存）；LLM 未配置时组件侧回退检测模板 |
| `components/` | `ChatCommandPalette.vue`（命令面板主 UI：对话流 + 底部输入栏、可拖拽缩放）/ `ChatLauncher.vue`（状态栏入口，带连通性色点）/ `MorningBriefing.vue`（首页晨报卡；开头即「今天先抓什么」行动建议 + 卡片底部深聊入口）/ `ConnectivityBanner.vue`（连不上大模型时的统一琥珀状态条） |

**连通性（`connectivity.ts`，解决「连不上大模型」缺乏提示）：** 与 `configured`（env 有没有配 Key，静态）正交的**运行期可达性**状态机：`healthy / checking / unreachable`。核心约定：

- **状态分层语义**——`store.error`（红条）= 真·业务错误（解析失败 / 工具异常 / 4xx 鉴权）；`connectivity`（琥珀条 / Launcher 色点）= 网络可达性问题。`store.ts` 的 catch 用 `classifyError(e)` 拆分：网络类（offline / proxy / provider / auth / unknown）走 `markUnreachable`，不污染红条；非网络类走 `store.error`。
- **复用真实调用结果作信号**（不空探测）：provider 每次成功 → `markSuccess`；网络错误 → `markUnreachable(reason)`。避免每次进站烧 token 探活。
- **只在需要时主动 probe**：失败后指数退避自动重试（5s → 10s → 30s 封顶）；用户点「重试」立即 probe。probe 是 `max_tokens:1` 的最小 ping + 5s 超时，**故意不走** `fetchWithRetry` 的 1+2+4s 三次退避（要快速反馈，不白等）。
- **恢复广播 `onRecover(cb)`**：连通恢复时 ambient 模块（`briefing` / `inbox-insight` / `welcome-guide`）+ `store`（末尾有未答复 user 消息时）自动续生成 / 续答，用户无需点任何按钮。模块级注册一次，回调去重。
- **离线优先**：`navigator.onLine===false` 直接 `unreachable('offline')`、跳过任何 fetch；监听 `window` 的 `online`/`offline` 事件自动翻转。
- **根因 → 文案**：offline / proxy（dev server 没起）/ provider（5xx 超时）/ auth（401/403）四类不同中文文案 + 行动指引。
- **已知不可达时 `send()` 先 probe 短路**：避免用户发消息后白等 fetchWithRetry 的 7s 退避；不通则挂起，恢复后 `onRecover` 自动续答。
- **不持久化**：连通性是瞬态，纯内存（持久化会让下次进站看到陈旧的「不可用」）。`configured=false` 时整层短路（不探测、不显示降级条）。

**System prompt** 拆静态（能力 / 风格 / 组合规划）+ 动态（时间 / 城市）两条消息，命中 prompt caching；能力列表从已注册工具动态生成。「**组合规划**」节显式鼓励开放性问题并行多工具（如「今天怎么安排」→ 并行任务 / Bug / 待办 / 天气），而非一问一工具。

**多模态图片输入：** 命令面板支持 `Ctrl+V` 粘贴截图 / 拖图片到底部输入栏（单张 ≤5MB、最多 4 张），随消息以 OpenAI vision 协议（`image_url` data URL）发给模型；`toApiMessage` 对带图 user 消息构造多模态 `content`。⚠️ **视觉能力需在模型设置里选择支持图片的模型**——默认 `deepseek-chat` 不支持视觉，发图会收到模型错误（走错误条提示，不崩）；要用图片功能可在模型设置中新增 / 切换 VL 模型（如 `qwen-vl-max`、`gpt-4o`）。**图片不进 localStorage**（base64 过大会撑爆 `hao123-chat-history`）：`ChatMessage.images` 只在内存持有供 agent 多轮 + 当前会话回显缩略图，messages 用自定义持久化（不再走 `useStorage` 默认），写入前剥离 `images` 字段——刷新页面后图片消失、文字保留；`estimateMessageTokens` 按 ~1500 token/张计入图片，让历史截断正确预算。

### 洞察模块（`src/features/insights/`，自包含特性模块）

首页「AI 主动评估」的**确定性**来源——对收件箱工作项做纯启发式风险预测（逾期 / 临期 / 停滞），即时、确定、可解释，不依赖 LLM（即便 DeepSeek 未配置，首页也能体现「小吴在主动评估你的工作」）；与「晨报叙述」「交给小吴深聊」等需要自然语言的能力互补。外部统一从 `@/features/insights` 引入（barrel `index.ts`）：

| 路径 | 职责 |
|---|---|
| `types.ts` | `WorkItem`（归一化工作项）/ `Prediction`（风险预测，含 `why` 可解释理由 + `action` 行动建议）/ `InsightSummary`（列表级汇总）/ `RiskLevel` |
| `predict.ts` | 预测引擎（纯函数）：`predictItem`（单条取最强一档风险）+ `summarize`（汇总成状态条数据）+ 时间工具 `deadlineDays` / `parseZentaoTime`；截止日按本地零点比较，规避 UTC 误判 |
| `composable.ts` | `useInboxInsights`：把禅道任务 / Bug / 本地待办三类 store 归一化为 `WorkItem[]`（含 `thread` 需求线标签）→ 跑预测 → 暴露 `predictions`（`${kind}-${id}` → `Prediction` 查表，与 UnifiedInbox 行 key 同口径）+ `summary` + `insights`（深度洞察） |
| `detect.ts` | 深度洞察检测（纯函数）：`detectInsights` 扫工作项找出值得小吴**主动开口**的模式——同根因（同线索任务+Bug）/ Bug 集中 / 多项逾期 / 负载 / 高优停滞；按优先级排序、至多 2 条（克制）；命中才有洞察，不命中不渲染、不发 LLM |

**预测口径：** 逾期（截止日早于今天）> 临期（今天 / 明天到期）> 停滞（未推进状态 + 超 5 天无变动 + 够分量），一条至多命中一档。每个预测必带一句 `why`（可解释性红线，避免「玄学噪音」）与一句用户口吻的 `action`。停滞只在「够分量」的项上触发（Bug `active` 即算；任务 / 本地要求 pri ≤ 3），避免低优积压刷屏。

**洞察（Step 3）：** `detect.ts` 的检测是确定性的（可靠、即时、不烧 token），命中才发 LLM；`chat/inbox-insight.ts` 的 `useInboxInsight` 把检测结果交给 LLM 加工成「小吴的洞察」自然提醒 + 具体建议（按日 + 检测签名缓存，签名变化才重生成）。LLM 未配置时回退检测模板文案。

### Agent Reach 外部调研模块（`src/features/reach/`，自包含特性模块）

为小吴补充公开互联网搜索、网页读取、GitHub 仓库分析和 YouTube/B站视频信息/字幕能力，仅 dev 生效。浏览器不能执行本机 CLI，真正的命令执行由根目录 `vite-plugin-agent-reach.ts` 在 dev server 侧桥接。外部统一从 `@/features/reach` 引入（barrel `index.ts`）：

| 路径 | 职责 |
|---|---|
| `types.ts` | `ReachStatusResponse` / `ReachSearchResponse` / `ReachReadUrlResponse` / `ReachGithubRepoResponse` / `ReachVideoSummaryResponse` / `ReachMarkdownNoteResponse` / `ReachSource` 等契约 |
| `api.ts` | 浏览器侧 fetch 封装：`fetchReachStatus` / `fetchReachSearch` / `fetchReachReadUrl` / `fetchReachGithubRepo` / `fetchReachVideoSummary`（所有调用走 `/agent-reach` 前缀到 dev server） |
| `llm-tools.ts` | LLM 工具层 `reachToolDefs`（声明）+ `callReachTool`（执行，6 工具：`reach.status`/`search`/`read_url`/`github_repo`/`video_summary`/`markdown_note`）；`reachEnabled` = `import.meta.env.DEV && VITE_AGENT_REACH_ENABLED=true` |
| `report.ts` | Markdown 调研记录生成：`normalizeMarkdownNote`（校验归一化）+ `buildMarkdownNote`（模板渲染）+ `REACH_REPORT_GUIDE`（系统提示词中的报告结构规范） |
| `ui.ts` | 生成式 UI 卡片：`reachUiBlocksFromToolResult` 将 6 种工具结果渲染为 status-grid / item-list / summary / source-list 卡片，来源链接可点击 |

**环境变量：** `.env` 配 `VITE_AGENT_REACH_ENABLED=true` 开启；可选 `VITE_AGENT_REACH_CMD` 指定 CLI 路径（默认 `agent-reach`）。未开启时工具不暴露、system prompt 不宣称该能力（门控于 `reachEnabled`）。

**安装：** `npm run setup:reach` 一键检查/安装 Python 3.12、pipx、Agent Reach、yt-dlp、bili、gh 等上游 CLI。

**Vite 插件（`vite-plugin-agent-reach.ts`，仅 dev）：**
- `GET /agent-reach/status`：Agent Reach 与上游工具体检（7 项并行检查，~8s）
- `GET /agent-reach/search`：公开搜索（Exa/mcporter 优先，失败/空结果 DuckDuckGo HTML 兜底）
- `GET /agent-reach/read-url`：Jina Reader 提取公开网页 Markdown/正文
- `GET /agent-reach/github-repo`：公开 GitHub 仓库元信息、README、最近提交、近期 issue
- `GET /agent-reach/video-summary`：YouTube（yt-dlp 字幕）或 B站（opencli bilibili subtitle + bili video 元数据）

所有 spawn 命令带超时 + SIGTERM→SIGKILL 两级终止；出站 fetch 带 timeout 防止挂起。

### 首页统一收件箱（`src/components/UnifiedInbox.vue`）

首页主角：把「指派给我的禅道任务 / Bug」与「本地待办」**整合进一条清单**（`UnifiedInbox`），用类型徽标（任务 / Bug / 本地）区分来源。排序与 AI 增强分层：

- **主排序：** 「紧急 → 优先级 → 截止日期」（`sortKey`），紧急项左侧玫红描边。
- **「小吴已就绪」状态条：** 顶部一条 AI 主动风险概况（N 逾期 · N 临期 · N 停滞 + 点题建议），数据来自 `useInboxInsights().summary`；LLM 已配置时整条可点 → 带概况让小吴排出处理顺序（无对话框，AI 先动）。
- **行内风险徽标：** 每条有风险的工作项显示预测徽标（逾期 / 临期 / 停滞，`why` 走 tooltip），LLM 已配置时整枚可点 → 带上下文「交给小吴」跟进（`chat.show()` + `chat.send(action)`）。取代了原先静态的「逾期」徽标。
- **「小吴的洞察」卡：** `detect.ts` 检测到值得主动一说的模式（同根因 / Bug 集中 / 多项逾期 / 负载 / 高优停滞，至多 2 条）时，在状态条下方主动开口——LLM 已配置则由 `useInboxInsight` 生成自然提醒 + 建议（按日 + 签名缓存，可手动「重新分析」），未配置则回退检测模板；「让小吴展开」带上下文深聊。无模式不渲染（克制）。
- **需求线分组：** 同属一条需求 / 项目的禅道项（≥2 项）自动归入可折叠的彩色分组头（`threadOf` 按 storyTitle → projectName → productName / executionName 取线索；`threadColor` 按名 hash 取稳定配色），组间按各自最强项的紧急度排序、组内保持紧急度序——既「连成线」又不打乱「紧急优先」；本地待办与单条不成线的项并入「其他」流。

禅道项只读（点击行 → 详情弹窗），本地项可交互（圆点勾选完成、点标题编辑、悬停出删除二次确认、附件指示）。新建按钮创建本地待办（禅道任务无法在此新建，禅道是只读来源）。`WelcomePage` 的 `dailySummary` / `hasUrgentItems` 已聚合三类来源。原 `ZentaoInbox.vue` / `LocalTaskPanel.vue` 已并入此组件并移除。

### Git 仓库信息模块（`src/features/git/`，自包含特性模块）

把 wbscf-web 代码库的 git 信息（本地 + 远端）接入工作台：状态栏显示当前分支 + 变更数，点击打开完整仪表盘，支持全面的 git 管理操作。外部统一从 `@/features/git` 引入（barrel `index.ts`）：

| 路径 | 职责 |
|---|---|
| `types.ts` | `GitBranch` / `GitCommit` / `GitFileStatus` / `GitTag` / `GitStash` / `GitRemote` / `GitOverviewResponse` / `GitActionResponse` 等契约 |
| `api.ts` | 浏览器侧 fetch 封装：`fetchGitOverview` / `fetchGitCommits` / `fetchGitDiff` / `fetchGitCommitDetail` / `fetchGitBlame` / `fetchGitReflog` / `fetchGitContributors` / `fetchGitConfig` / `fetchGitSearchCommits` / `triggerGitAction` |
| `composable.ts` | `useGitDashboard`（**模块级单例**）：Widget 与 Dashboard 共享状态避免重复轮询（widget 低频 30s / dashboard 高频 8s / 切后台暂停）+ 操作（fetch/pull/push/checkout/commit/stage/unstage/**discard**/stash/tag/branch-create/branch-delete/**reset/merge/revert/cherry-pick**）+ 按需查询（diff/commit-detail/**blame/reflog/search/branch-log**）；派生 `repoName`（仓库短名，取 root basename） |
| `llm-tools.ts` | LLM 工具层 `gitToolDefs`（声明）+ `callGitTool`（执行，14 工具：`status`/`log`/`blame`/`search`/`contributors`/`reflog`/`config` 查询 + `checkout`/`fetch`/`pull`/`push`/`add`/`commit`/`branch` 操作；merge/cherry-pick/revert/reset/stash/tag 仅走 Dashboard，不暴露给 LLM 控制风险面） |
| `components/status/GitWidget.vue` | 状态栏小组件：分支名 + 变更数，点击进入 Dashboard（通过共享 composable 读取状态） |
| `components/GitDashboard.vue` | 全屏仪表盘：5 个标签页 + More 下拉菜单（**去重** Fetch/Pull/Push——这三项已在 header，More 只放次要与高级操作），HUD 玻璃面板风格 |
| `components/GitDiffBox.vue` | diff 渲染盒：把 `git diff` / `git show` 原文解析成带 old/new 双行号、`+/-` 配色（增绿删红、hunk 青）、横向滚动（不做 `word-break`）、超长截断的视图；LLM 已配置时底部出「让小吴解释这段 diff」 |

**仪表盘功能：** 概览（**仓库健康判断可点交给小吴** + 统计 + 色彩 legend + 最近提交 + 分支快照 + 远端 + 回滚 Reset）/ 分支（搜索 + 创建 + 删除 + 切换 + 合并 + 检出远端）/ 提交（日志 + diff + **revert/cherry-pick** + `--grep` 搜索 + **reflog 操作历史**）/ 变更（复选框暂存/取消暂存/**放弃修改**/**blame** + 批量操作 + **conventional 前缀 + 多行 + 复用上条** 的 commit 栏）/ 标签（**创建 / 编辑面板**：annotated/轻量显式选择 + 指向 commit 的下拉选择器 + 多行发版说明 + 实时查重/合法性校验；编辑通过本地重建 tag 实现，编辑前读取完整附注说明，已推送 tag 默认可勾选“保存后同步更新远端”；**搜索 + 日期/语义化排序**，版本排序时自动按主版本号折叠分组（v1.x / v2.x，组可折叠）；点行展开详情：metadata + **自上一 tag 以来的提交** + 操作栏（**复制检出命令** / **删远端 tag**）；**单 tag 推送 / 检出 / 编辑 / 删除 / 更新远端**；每条带 `onRemote` 同步状态、`remoteOutdated` 待更新徽标 + latest 徽标；**「让小吴写发版说明」**带提交列表交给 LLM；**推送全部**只推远端缺失的 tag，不覆盖远端已有 tag） / Stash（创建/删除/推送标签 + stash 暂存/恢复/弹出/丢弃；远端已移至概览）。所有危险操作（删除分支/标签/丢弃 stash/**放弃修改/hard reset**）通过统一确认栏二次确认；**Pull/Push 确认前预览**即将进/出的 commit 列表；**切换分支警告工作区脏、删除分支警告未合并**。

**AI 接入（ambient，对齐 UnifiedInbox 范式）：** LLM 已配置（`useChatStore().configured`）时——仓库健康判断整块可点 + 「让小吴排一下」、冲突态顶部条出「让小吴帮我理冲突」、每个 diff 盒底部出「让小吴解释这段 diff」，均带上下文 `chat.show()` + `chat.send()`；未配置时不渲染入口（不破坏纯展示体验）。

**无障碍：** 弹窗有焦点 trap（打开聚焦首元素、Tab 闭环、关闭还焦）、Escape 分级关闭（More → 确认 → 弹窗）、遮罩点击智能关闭（浮层开着只关浮层）；`prefers-reduced-motion` 覆盖流光 / sheen / spin / 全部 transition。

**浏览器无法执行 git 命令**，真正的命令执行由根目录 **`vite-plugin-git.ts`**（dev server Node 侧，同 `vite-plugin-wbscf.ts` 模式）承担，`configureServer` 挂中间件——全部走**异步 spawn**（不阻塞 dev server 事件循环），`/git/overview` 带 ~1.5s 短缓存 + in-flight 去重（合并并发轮询）；`doAction` 做 ref/hash 合法性校验（拒绝 `-` 开头等会被 git 当 flag 的输入）+ 冲突检测（merge/pull/cherry-pick/revert 失败时回 `conflict:true`），写操作成功后让 overview 缓存失效：

- `GET /git/overview`：一次返回仓库全貌（分支 / 状态 / commits / remotes / tags / stashes / sync ahead-behind）；
- `GET /git/commits?branch=&count=`：指定分支的 commit 日志；
- `GET /git/diff?path=&cached=&ref1=&ref2=`：文件 diff；
- `GET /git/commit-detail?hash=`：单个 commit 的 show 输出；
- `GET /git/tag-detail?name=`：单个 tag 的完整附注说明（编辑前读取，避免只拿列表 subject 第一行）；
- `GET /git/blame` / `/git/reflog` / `/git/contributors` / `/git/config` / `/git/search`：逐行追溯 / 操作历史 / 贡献者统计 / 本地 config / `--grep` 搜索 commit；
- `POST /git/action`：执行操作（`fetch` / `pull` / `push` / `checkout` / `branch-create` / `branch-delete` / `merge` / `add` / `commit` / `reset` / `discard` / `stash` / `stash-pop` / `stash-apply` / `stash-drop` / `cherry-pick` / `revert` / `tag-create` / `tag-update` / `tag-push` / `tag-push-missing` / `tag-delete`）；`discard` 丢弃工作区修改（已跟踪 `git restore` / 未跟踪 `git clean -f`）。

**仅 dev 生效**；git 工具与 wbscf 同条件门控（`gitEnabled = wbscfEnabled`：dev 且配了 `VITE_WBSCF_WEB_ROOT`）。生产或未配置时不暴露工具、状态栏不渲染 GitWidget。

**URL 脱敏：** remote URL 在返回给前端前会去除 `user:pass@` 部分（`sanitizeUrl`），避免密码泄露。

### Icons

Use `import IconXxx from '~icons/<collection>/<name>'` (e.g., `~icons/mdi/pencil`). The `unplugin-icons` plugin auto-installs from `@iconify/json`. Type declarations are in `src/env.d.ts`.
