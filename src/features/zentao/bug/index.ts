/**
 * 禅道「Bug」子模块出口（barrel）
 *
 * 对外只暴露 BugPanel（含其详情弹窗）与 store/类型/ui，
 * 详情弹窗等内部组件不外泄。鉴权能力来自 ../shared。
 */
export * from './types'
export * from './api'
export * from './store'
export * from './ui'
export { default as BugPanel } from './components/BugPanel.vue'
export { default as BugDetailModal } from './components/BugDetailModal.vue'
