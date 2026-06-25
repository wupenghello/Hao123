/**
 * 禅道特性模块公共出口（barrel）
 *
 * 外部统一从这里引入，不触达模块内部路径：
 *   import { ZentaoPanel } from '@/features/zentao'
 *
 * 模块化结构（自包含，子模块互不依赖对方）：
 *   shared/        鉴权 HTTP 核心 / 会话 store / 通用类型 / 通用 UI 工具 / 详情正文样式
 *   task/          「我的任务」：types · api · store · ui · TaskPanel(+TaskDetailModal)
 *   bug/           「我的 Bug」：types · api · store · ui · BugPanel(+BugDetailModal)
 *   components/    ZentaoPanel —— 把任务、Bug 两块并排组合的容器
 *
 * 任务详情、Bug 详情弹窗均复用项目级公共组件 @/components/common/DetailModal.vue。
 */
export * from './shared'
export * from './task'
export * from './bug'
export { default as ZentaoPanel } from './components/ZentaoPanel.vue'
