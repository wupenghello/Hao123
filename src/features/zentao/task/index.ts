/**
 * 禅道「任务」子模块出口（barrel）
 *
 * 对外只暴露 TaskPanel（含其详情弹窗）与 store/类型/ui，
 * 详情弹窗等内部组件不外泄。鉴权能力来自 ../shared。
 */
export * from './types'
export * from './api'
export * from './store'
export * from './ui'
export { default as TaskPanel } from './components/TaskPanel.vue'
