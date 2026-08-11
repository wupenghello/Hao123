/**
 * Chat 助手特性模块公共出口（barrel）
 *
 * 外部统一从这里引入，不触达模块内部路径：
 *   import { ChatPanel, ChatLauncher, useChatHotkeys, useChatStore, useConnectivity } from '@/features/chat'
 *
 * 分层（自包含）：
 *   config.ts            公共配置（助手身份）
 *   types.ts             协议消息类型（ChatMessage/ToolCall）
 *   ui-types.ts          生成式 UI 卡类型（对外契约，reach 等外部模块依赖）
 *   turns.ts             Turn 数据模型（一次问答 = 一个 Turn）
 *   approval.ts          审批队列模块
 *   sessions.ts          会话 CRUD + Turn[] 持久化 + 旧格式迁移
 *   feedback-stats.ts    反馈分类统计（纯函数）
 *   tools.ts             聚合各模块工具声明 + OpenAI 适配 + 分发
 *   llm/                 LLM 接入层（provider 无关 + OpenAI 兼容）
 *   agent/               agent 循环引擎（loop.ts + build-messages.ts + policy.ts）
 *   feedback/            偏好数据飞轮（preference-log / few-shot）
 *   store.ts             Pinia 薄壳（面板 + 调度 + 对外契约）
 *   connectivity.ts      连通性状态层
 *   components/          ChatPanel / ChatLauncher 等
 */
export * from './config'
export * from './types'
export * from './ui-types'
export * from './turns'
export * from './approval'
export * from './sessions'
export * from './connectivity'
export * from './tools'
export * from './settings'
export * from './llm'
export * from '@/features/model-config'
export * from './store'
export * from './feedback'
export * from './feedback-stats'
export * from './useChatHotkeys'
export { renderMarkdown } from './markdown'
export { default as ChatPanel } from './components/ChatPanel.vue'
export { default as ChatLauncher } from './components/ChatLauncher.vue'
