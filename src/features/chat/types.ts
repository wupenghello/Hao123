/**
 * Chat 助手 · 类型定义
 *
 * 协议层类型（与 OpenAI chat/completions 消息对齐）：ChatMessage / ToolCall / StreamResult。
 * 产品概念（Turn / ToolStep）在 turns.ts；生成式 UI 卡（ChatUiBlock / ChatUiKind）
 * 是对外契约，re-export 自 ui-types.ts（外部特性模块稳定依赖，不随重构变更）。
 */

/** 一次工具调用（OpenAI tool_calls 形态） */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    /** 模型给出的参数 JSON 字符串（流式拼接而来） */
    arguments: string
  }
}

/** 对话消息（与 DeepSeek/OpenAI chat/completions 的 message 对齐，协议形态） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** 文本内容；assistant 发起纯工具调用时可能为空串 */
  content: string
  /** 仅 user 消息：附带的图片 data URL（多模态输入）。不持久化（localStorage 装不下 base64），
   *  仅当前会话内存持有，供 agent loop 多轮与回显；刷新页面后丢失。 */
  images?: string[]
  /** assistant 发起的工具调用（可选，回灌给模型用） */
  tool_calls?: ToolCall[]
  /** role=tool 时，对应的 tool_call id */
  tool_call_id?: string
  /** 消息唯一 id（部分历史场景使用；新架构以 Turn.id 为准） */
  id?: string
}

/** 一轮流式响应的累积结果 */
export interface StreamResult {
  content: string
  toolCalls: ToolCall[]
}

/** AI 质量反馈分类，用于把赞踩归因到具体能力场景 */
export type FeedbackCategory =
  | 'briefing'
  | 'task-planning'
  | 'git'
  | 'kb'
  | 'weather'
  | 'local-task'
  | 'zentao'
  | 'vision'
  | 'general'

export interface FeedbackCategoryStats {
  up: number
  down: number
  regenerations: number
}

export interface FeedbackStats {
  up: number
  down: number
  regenerations: number
  byCategory: Partial<Record<FeedbackCategory, FeedbackCategoryStats>>
}

// 生成式 UI 类型（对外契约，见 ui-types.ts）
export type { ChatUiKind, ChatUiBlock } from './ui-types'
