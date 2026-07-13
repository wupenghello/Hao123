/**
 * 墨刀原型特性模块（barrel）
 *
 * 读取公开 modao.cc/proto 原型链接，封装为：
 *   - 浏览器 API：/modao/status、/modao/read
 *   - 状态栏入口 + Dashboard 共享 composable
 *   - LLM 工具层：modao.status / modao.read
 *   - skill prompt：告诉小吴何时、如何使用墨刀读取能力
 */
export * from './types'
export * from './config'
export * from './api'
export * from './skill'
export { useModaoDashboard } from './composable'
export * from './llm-tools'
export { default as ModaoDeepReadPanel } from './components/ModaoDeepReadPanel.vue'
