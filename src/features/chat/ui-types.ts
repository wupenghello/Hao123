/**
 * Chat 助手 · 生成式 UI 类型（对外契约）
 *
 * 独立成文件是为了让外部特性模块（reach 等）稳定依赖——这是重构时的地平线：
 * ChatUiBlock / ChatUiKind 的结构与旧 `types.ts` 完全同构，外部零改动。
 */

/** 白名单 UI 卡种类（由前端组件按 kind 分派渲染） */
export type ChatUiKind =
  | 'summary'
  | 'metrics'
  | 'item-list'
  | 'data-table'
  | 'timeline'
  | 'weather-current'
  | 'weather-forecast'
  | 'status-grid'
  | 'source-list'

/** 一条生成式 UI 卡片（模型经 ui.render 或工具自动卡生成，前端白名单组件渲染） */
export interface ChatUiBlock {
  id: string
  kind: ChatUiKind
  title: string
  subtitle?: string
  props: Record<string, unknown>
}
