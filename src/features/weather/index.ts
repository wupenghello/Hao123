/**
 * 天气模块公共出口（barrel）
 *
 * 外部统一从这里引入，不触达模块内部路径：
 *   import { WeatherWidget, useWeatherStore, weatherToolDefs, callWeatherTool } from '@/features/weather'
 *
 * 分层（内部相对引用，自包含）：
 *   types.ts       和风接口数据类型
 *   api.ts         和风 API 客户端（weatherApi / WeatherApiError）
 *   store.ts       Pinia 状态层（useWeatherStore）
 *   llm-tools.ts   LLM 工具层（weatherToolDefs / callWeatherTool）
 *   icons.ts       天气编码 → 图标
 *   ui.ts          AQI / 预警 配色 + 指数图标
 *   sun-times.ts   本地日出日落计算（兜底）
 *   city-data.ts   中国城市坐标库
 *   components/    Vue 组件（WeatherWidget 为对外入口）
 */
export * from './types'
export * from './api'
export * from './store'
export * from './llm-tools'
export * from './icons'
export * from './ui'
export * from './sun-times'
export * from './city-data'
export { default as WeatherWidget } from './components/WeatherWidget.vue'
