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

**localStorage keys:** `hao123-weather-city-coord`, `hao123-weather-city-name`, `hao123-weather-mode`. When changing default data, users may need to clear these keys to see updates.

### Component hierarchy

```
App.vue (router-view)
  └─ Layout.vue (single-page layout)
       └─ status/StatusBar.vue   (顶部状态栏外壳：固定高度，三栏插槽)
            ↑ 通过具名插槽注入内容，Layout.vue 填充 #right(WeatherWidget + StatusTime)
            ↑ 可用插槽：#left / #center / #right

`WeatherWidget` 来自天气特性模块 `@/features/weather`（见下节）；外部只从该 barrel 引入，不触达模块内部路径。
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

### Icons

Use `import IconXxx from '~icons/<collection>/<name>'` (e.g., `~icons/mdi/pencil`). The `unplugin-icons` plugin auto-installs from `@iconify/json`. Type declarations are in `src/env.d.ts`.
