/**
 * Chat 助手 · LLM 层类型（provider 无关）
 *
 * 这里定义「与具体提供方解耦」的 LLM 抽象：一个 LlmProvider 只需实现
 * configured + chatStream 两件事。换提供方（DeepSeek↔其它 OpenAI 兼容服务，
 * 乃至非 OpenAI 协议）只需新增一个实现，store/tools 等上层无需改动。
 */
import type { ChatMessage, StreamResult } from '../types'

/** provider 无关的工具声明（喂给 LLM 的部分，不含执行器） */
export interface LlmToolDef {
  name: string
  description: string
  /** 参数的 JSON Schema（provider 无关） */
  parameters: Record<string, unknown>
}

/** 完整工具：声明 + 执行器 */
export interface LlmTool<P = Record<string, unknown>, R = unknown> extends LlmToolDef {
  execute(params: P): Promise<R>
}

/** 一轮流式对话的入参 */
export interface LlmChatArgs {
  /** 已构造好的消息序列（含 system；UI-only 字段由 provider 自行裁剪） */
  messages: ChatMessage[]
  /** 取消信号（abort 上一次请求用） */
  signal?: AbortSignal
  /** 文本增量回调（逐字渲染） */
  onText?: (delta: string) => void
  /** 可选工具列表（function-calling）；不传则不挂工具 */
  tools?: Array<{ type: 'function'; function: LlmToolDef }>
  /** 采样温度（0~2）；低值确定性高、工具调用更准确，高值更随机多样 */
  temperature?: number
  /** 最大输出 token 数；限制单次回复长度以节省成本和降低延迟 */
  maxTokens?: number
  /** 核采样（0~1）；与 temperature 互补，建议只调其中一个 */
  topP?: number
  /** 频率惩罚（-2~2）；正值减少重复用词 */
  frequencyPenalty?: number
  /** 工具选择策略；'auto' 模型自行决定 | 'none' 禁用 | {type:'function',function:{name}} 强制 */
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
}

/** 一次性补全（非流式、不带工具）的入参 */
export interface LlmCompleteArgs {
  /** 消息序列（通常 system + 一条 user） */
  messages: ChatMessage[]
  /** 取消信号 */
  signal?: AbortSignal
  /** 采样温度（默认沿用服务端；生成多样文案时可调高） */
  temperature?: number
  /** 最大输出 token 数 */
  maxTokens?: number
  /** 核采样（0~1） */
  topP?: number
  /** 强制 JSON 输出格式（用于结构化数据生成） */
  responseFormat?: { type: 'json_object' }
}

/**
 * LLM 提供方抽象。上层只依赖此接口，不关心底层是 DeepSeek 还是别的服务。
 */
export interface LlmProvider {
  /** 提供方标识（调试/日志用，如 'deepseek'） */
  readonly name: string
  /** 是否已正确配置（缺 key 时上层给提示而非静默失败） */
  readonly configured: boolean
  /** 发起一轮流式对话，返回累积文本 + 工具调用 */
  chatStream(args: LlmChatArgs): Promise<StreamResult>
  /**
   * 一次性补全：非流式、不挂工具，返回纯文本。
   * 用于「让模型生成一段内容」的轻量场景（如开场推荐问题），不走 agent 循环。
   */
  complete(args: LlmCompleteArgs): Promise<string>
}
