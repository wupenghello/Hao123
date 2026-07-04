/**
 * Chat 助手 · LLM 层出口（barrel）
 *
 * 上层（store）只从这里取 `llm`（当前激活的提供方实例），不关心底层实现。
 * llm 不再是静态单例——每次调用 chatStream / complete 时动态读取 model-config
 * 中的当前激活 Provider 配置创建实例，确保模型切换即时生效。
 *
 * 分层：
 *   types.ts            provider 无关抽象（LlmProvider / LlmChatArgs）
 *   openai-provider.ts  OpenAI 兼容流式实现（DeepSeek 等）
 */
import { getActiveConfig, getClientAuthBody } from '@/features/model-config'
import { createOpenAiProvider } from './openai-provider'
import type { LlmProvider } from './types'

export type { LlmProvider, LlmChatArgs, LlmToolDef, LlmTool } from './types'
export { createOpenAiProvider } from './openai-provider'
export type { OpenAiCompatConfig } from './openai-provider'

/**
 * 当前激活的 LLM 提供方（动态代理）。
 * 每次调用时从 model-config 读取最新配置创建 provider，
 * 模型/Key/Provider 切换无需刷新或重启。
 */
export const llm: LlmProvider = {
  get name() {
    return getActiveConfig().provider
  },

  get configured() {
    return getActiveConfig().configured
  },

  async chatStream(args) {
    const config = getActiveConfig()
    // 注入客户端 API Key（如有）到请求体，供 vite 代理插件读取
    const clientAuth = getClientAuthBody()
    const provider = createOpenAiProvider({
      ...config,
      // 把 clientAuth 信息附到 config 上，由 openai-provider 注入 body
      _clientAuth: clientAuth,
    })
    return provider.chatStream(args)
  },

  async complete(args) {
    const config = getActiveConfig()
    const clientAuth = getClientAuthBody()
    const provider = createOpenAiProvider({
      ...config,
      _clientAuth: clientAuth,
    })
    return provider.complete(args)
  },
}
