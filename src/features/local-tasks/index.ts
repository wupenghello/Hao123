/**
 * 本地任务特性模块（barrel）
 *
 * 手动创建的任务，与禅道无关：纯前端 + localStorage（元数据）+ IndexedDB（附件二进制）持久化，
 * 不发任何网络请求。外部统一从这里引入，不触达模块内部路径：
 *   import { LocalTaskPanel, useLocalTaskStore, localTaskToolDefs } from '@/features/local-tasks'
 *
 * 结构：
 *   types.ts        数据类型（LocalTask / LocalTaskInput / LocalTaskFormPayload / TaskAttachment）
 *   util.ts         id 生成 / 文件判定 / 体积格式化
 *   attachments.ts  附件 Blob 的 IndexedDB 存储（put / get / delete）
 *   ui.ts           优先级徽标 / 截止日期判定（自包含，不依赖禅道）
 *   store.ts        Pinia 状态层（localStorage 持久化 + 增删改查 + 附件编排）
 *   llm-tools.ts    LLM 工具层（local.list/create/update/complete/delete，喂给小吴）
 *   components/     LocalTaskPanel（首页面板）+ LocalTaskFormModal（新建 / 编辑弹窗，含附件）
 */
export * from './types'
export * from './util'
export * from './attachments'
export * from './ui'
export * from './store'
export * from './llm-tools'
export { default as LocalTaskFormModal } from './components/LocalTaskFormModal.vue'
