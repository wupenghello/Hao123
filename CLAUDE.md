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

**localStorage keys:** `hao123-weather-city-coord`, `hao123-weather-city-name`, `hao123-weather-mode`, `hao123-zentao-sid`（禅道会话 ID）, `hao123-chat-history`（对话历史）, `hao123-chat-feedback`（反馈统计 {up, down, regenerations}）, `hao123-local-tasks`（本地任务列表）. When changing default data, users may need to clear these keys to see updates.

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
- 本地文件夹路径（如 `D:/projects/hao123-kb`，Windows 用正斜杠）：由根目录 `vite-plugin-kb.ts` 在 dev/构建时读取 `*.md` 并注入虚拟模块 `virtual:kb-docs`；dev 改文档后刷新生效（插件已声明文件依赖并触发热更新），生产随构建打进包。**目录不存在时构建直接报错**（不静默打包空库）。
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
- 拉起用 `VITE_WBSCF_PKG_MGR`（默认 `pnpm`）执行 `run <script>`，cwd=wbscf-web 根，stdio 继承到 Hao123 dev 终端；进程同时监听 `exit` 与 `error`（spawn 失败也复位 state，避免永久卡「启动中」）；Hao123 dev server 退出（含 SIGINT/SIGTERM）时连带收掉拉起的子进程树（Windows `taskkill /T /F`，非 Windows 杀进程组），避免孤儿 dev server。

**仅 dev 生效**；是否把 wbscf 工具暴露给模型由 `chat/tools.ts` 的 `wbscfEnabled`（dev 且配了 `VITE_WBSCF_WEB_ROOT`）门控（对齐 `kbEnabled` 约定）——生产或未配置时不暴露工具、system prompt 也不宣称该能力。**环境变量：** `.env` 配 `VITE_WBSCF_WEB_ROOT`（wbscf-web 根目录，Windows 用正斜杠）+ 可选 `VITE_WBSCF_PKG_MGR`；改动后需重启 dev。未配置时入口隐藏，dev/test/pre 不受影响。`StatusNav.vue` 的 `navItems` 前 5 项带 `local`（app key）即自动渲染该入口。

### 首页统一收件箱（`src/components/UnifiedInbox.vue`）

首页不再分两块面板，而是把「指派给我的禅道任务 / Bug」与「本地待办」**整合进一条清单**（`UnifiedInbox`），按「紧急 → 优先级 → 截止日期」排序，用类型徽标（任务 / Bug / 本地）区分来源。禅道项只读（点击行 → 详情弹窗），本地项可交互（圆点勾选完成、点标题编辑、悬停出删除二次确认、附件指示）。新建按钮创建本地待办（禅道任务无法在此新建，禅道是只读来源）。`WelcomePage` 的 `dailySummary` / `hasUrgentItems` 已聚合三类来源。原 `ZentaoInbox.vue` / `LocalTaskPanel.vue` 已并入此组件并移除。

### Icons

Use `import IconXxx from '~icons/<collection>/<name>'` (e.g., `~icons/mdi/pencil`). The `unplugin-icons` plugin auto-installs from `@iconify/json`. Type declarations are in `src/env.d.ts`.
