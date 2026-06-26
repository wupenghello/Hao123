/**
 * Chat 助手 · LLM 层出口（barrel）
 *
 * 上层（store）只从这里取 `llm`（当前激活的提供方实例），不关心底层实现。
 * 切换提供方：改下方 `createOpenAiProvider(llmConfig)` 一行即可（或按 config 分流）。
 *
 * 分层：
 *   types.ts            provider 无关抽象（LlmProvider / LlmChatArgs）
 *   openai-provider.ts  OpenAI 兼容流式实现（DeepSeek 等）
 */
import { llmConfig } from '../config'
import { createOpenAiProvider } from './openai-provider'

export type { LlmProvider, LlmChatArgs, LlmToolDef, LlmTool } from './types'
export { createOpenAiProvider } from './openai-provider'
export type { OpenAiCompatConfig } from './openai-provider'

/** 当前激活的 LLM 提供方（DeepSeek，OpenAI 兼容） */
export const llm = createOpenAiProvider(llmConfig)
