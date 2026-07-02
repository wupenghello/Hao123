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
  status: 'running' | 'done' | 'error' | 'pending'
  /** 开始时间戳（ms） */
  startTime?: number
  /** 结束时间戳（ms） */
  endTime?: number
  /** 工具返回的原始结果（用于预览） */
  result?: string
  /** 是否展开预览详情 */
  expanded?: boolean
  /** 执行耗时（ms），结束时计算 */
  duration?: number
  /** 高风险工具的产品级审批信息；pending 时由 UI 渲染确认卡 */
  approval?: ToolApproval
}

/** 高风险工具调用的产品级审批信息 */
export interface ToolApproval {
  /** 人类可读动作标题 */
  title: string
  /** 动作影响说明 */
  description: string
  /** 风险提示 */
  risk: string
  /** 待执行参数（只用于 UI 预览，不发给模型） */
  args: Record<string, unknown>
  /** 用户是否已经处理该审批 */
  decision?: 'approved' | 'rejected'
  /** 处理时间戳 */
  decidedAt?: number
}

/** 对话消息（与 DeepSeek/OpenAI chat/completions 的 message 对齐） */
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
