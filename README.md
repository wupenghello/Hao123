# Hao123 工作台

一个极简的个人工作台 / 导航主页：顶部状态栏展示时间与实时天气，主区域聚合**禅道任务管理**。纯前端、无后端，数据持久化在浏览器本地。

## 功能特性

- 🌤️ **天气**：基于和风天气（QWeather）API，展示实时天气、多日预报、逐小时 / 分钟级预报、生活指数、AQI 与预警（富数据按需懒加载）
- ✅ **禅道集成**：对接禅道（ZenTao），展示「我的任务」与「我的 Bug」列表及详情
- 🕐 **状态栏**：固定高度顶部栏，时间 + 天气组件，三栏插槽便于扩展
- 💾 **本地持久化**：基于 `localStorage` 的响应式存储

## 技术栈

Vue 3（Composition API + `<script setup>`） · TypeScript · Vite · Pinia · Vue Router 4 · Tailwind CSS 4 · unplugin-icons（Iconify）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填入真实值（`.env` 已被 `.gitignore` 忽略，不会提交）：

```bash
cp .env.example .env
```

需配置的变量见下方[环境变量](#环境变量)一节。

### 3. 启动开发服务器

```bash
npm run dev
```

默认地址：http://localhost:5173

### 4. 构建与预览

```bash
npm run build     # 类型检查（vue-tsc）+ 生产构建
npm run preview   # 本地预览生产构建
```

## 环境变量

| 变量 | 说明 | 是否必填 |
|---|---|---|
| `VITE_QWEATHER_API_KEY` | 和风天气 API Key（到 https://qweather.com 申请） | 必填 |
| `VITE_QWEATHER_API_HOST` | 和风天气 API Host；新版账户填专属域名，留空默认 `devapi.qweather.com` | 可选 |
| `VITE_ZENTAO_BASE` | 禅道服务器地址，如 `http://zentao.example.com`（子路径部署带上 `/zentao`） | 使用禅道时必填 |
| `VITE_ZENTAO_ACCOUNT` | 禅道登录账号 | 使用禅道时必填 |
| `VITE_ZENTAO_PASSWORD` | 禅道登录密码 | 使用禅道时必填 |

> 开发环境下，和风天气与禅道的请求分别通过 Vite 的 `/qweather`、`/qgeo`、`/zentao` 代理转发，规避浏览器跨域与 `Set-Cookie` 丢失问题。详见 `vite.config.ts`。

## 项目结构

```
src/
├─ components/        # 通用组件（Layout 布局、status 状态栏、common 公共组件）
├─ composables/       # 组合式函数（useStorage 本地存储、useTime 时间）
├─ features/          # 自包含特性模块（对外只从各自 index.ts 引入）
│  ├─ weather/        # 天气模块：api / store / llm-tools / 图标映射 / 城市库 / 组件
│  └─ zentao/         # 禅道模块：task 任务 / bug 缺陷 / shared 公共层 / 组件
├─ router/            # 路由
├─ App.vue
└─ main.ts
```

## 说明

- 持久化数据保存在 `localStorage`，相关 key：`hao123-weather-city-coord`、`hao123-weather-city-name`、`hao123-weather-mode`。更改默认数据后可能需要清除这些 key 才能看到更新。
- 图标使用 `~icons/<collection>/<name>` 方式引入（由 unplugin-icons 自动按需加载）。
