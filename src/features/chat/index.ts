/**
 * Chat 助手特性模块公共出口（barrel）
 *
 * 外部统一从这里引入，不触达模块内部路径：
 *   import { ChatPanel, ChatLauncher, useChatHotkeys, ASSISTANT_NAME } from '@/features/chat'
 *
 * 分层（自包含）：
 *   config.ts            公共配置（助手身份 + LLM 接入参数，env 驱动）
 *   types.ts             对话/工具调用消息类型
 *   tools.ts             聚合各模块工具声明 + provider 适配（OpenAI 兼容）+ 分发
 *   llm/                 LLM 接入层（provider 无关抽象 + OpenAI 兼容实现），导出激活实例 `llm`
 *   store.ts             Pinia 状态层（useChatStore，含 agent 循环）
 *   preference-log.ts    偏好数据飞轮：👍/👎/重新生成 → (context,chosen,rejected) 偏好对，存 IndexedDB
 *   useChatHotkeys.ts    全局召唤快捷键（Alt+K / Cmd+K）
 *   components/          ChatPanel（右侧停靠面板）/ ChatLauncher（可拖拽桌宠入口）
 */
export * from './config'
export * from './types'
export * from './connectivity'
export * from './tools'
export * from './settings'
export * from './llm'
export * from '@/features/model-config'
export * from './store'
export * from './preference-log'
export * from './few-shot'
export * from './useChatHotkeys'
export { renderMarkdown } from './markdown'
export { default as ChatPanel } from './components/ChatPanel.vue'
export { default as ChatLauncher } from './components/ChatLauncher.vue'
