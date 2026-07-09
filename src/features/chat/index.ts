/**
 * Chat 助手特性模块公共出口（barrel）
 *
 * 外部统一从这里引入，不触达模块内部路径：
 *   import { ChatCommandPalette, ChatLauncher, MorningBriefing, useChatHotkeys, useBriefing, ASSISTANT_NAME } from '@/features/chat'
 *
 * 分层（自包含）：
 *   config.ts            公共配置（助手身份 + LLM 接入参数，env 驱动）
 *   types.ts             对话/工具调用消息类型
 *   tools.ts             聚合各模块工具声明 + provider 适配（OpenAI 兼容）+ 分发
 *   action-flow.ts       首页主动 AI 入口的结构化接手 prompt（风险项 / 今日编排 / 洞察 / 晨报）
 *   dashboard-context.ts 工作台上下文采集（天气+禅道+本地待办，welcome-guide 与晨报共享）
 *   welcome-guide.ts     命令面板快捷提问（LLM 生成 suggestions；首页「行动建议」已并入晨报）
 *   briefing.ts          每日晨报（LLM 综合工作台快照生成今日简报，持久化、今日一次）
 *   llm/                 LLM 接入层（provider 无关抽象 + OpenAI 兼容实现），导出激活实例 `llm`
 *   store.ts             Pinia 状态层（useChatStore，含 agent 循环）
 *   preference-log.ts    偏好数据飞轮：👍/👎/重新生成 → (context,chosen,rejected) 偏好对，存 IndexedDB
 *   useChatHotkeys.ts    全局召唤快捷键（Alt+K / Cmd+K）
 *   components/          ChatCommandPalette（Spotlight 式中央命令面板）/ ChatLauncher（状态栏入口）/ MorningBriefing（首页晨报卡）
 */
export * from './config'
export * from './types'
export * from './connectivity'
export * from './tools'
export * from './action-flow'
export * from './welcome-guide'
export * from './briefing'
export * from './inbox-insight'
export * from './settings'
export * from './llm'
export * from '@/features/model-config'
export * from './store'
export * from './preference-log'
export * from './few-shot'
export * from './useChatHotkeys'
export { renderMarkdown } from './markdown'
export { default as ChatCommandPalette } from './components/ChatCommandPalette.vue'
export { default as ChatLauncher } from './components/ChatLauncher.vue'
export { default as MorningBriefing } from './components/MorningBriefing.vue'
