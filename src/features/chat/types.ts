/**
 * Chat 助手 · 类型定义（OpenAI 兼容的对话/工具调用消息结构）
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

/** 工具执行的可视活动（用于在 UI 里实时呈现「正在查询…→ 已完成」的过程） */
export interface ToolActivity {
  /** 线上名（含 __），用于关联 tool_call */
  name: string
  /** 人类可读标签，如「查询实时天气」 */
  label: string
  /** 参数摘要，如「北京 · 未来 7 天」（可空） */
  detail?: string
  /** 执行状态 */
  status: 'running' | 'done' | 'error'
}

/** 对话消息（与 DeepSeek/OpenAI chat/completions 的 message 对齐） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** 文本内容；assistant 发起纯工具调用时可能为空串 */
  content: string
  /** assistant 发起的工具调用（可选，回灌给模型用） */
  tool_calls?: ToolCall[]
  /** role=tool 时，对应的 tool_call id */
  tool_call_id?: string
  /** 仅 UI 展示用：本条 assistant 触发的工具活动（不发给模型） */
  activities?: ToolActivity[]
  /** 仅 UI 展示用：消息创建时间戳（不发给模型） */
  ts?: number
  /** 用户反馈（仅 assistant 消息）；用于质量追踪与 prompt 迭代 */
  feedback?: 'up' | 'down'
}

/** 一轮流式响应的累积结果 */
export interface StreamResult {
  content: string
  toolCalls: ToolCall[]
}
