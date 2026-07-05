/**
 * Chat 助手 · 对话参数配置
 *
 * 把 Agent 循环轮数 / 历史 token 预算 / 单次输出上限 / 多模态图片限制
 * 从硬编码常量提升为可配置项，持久化到 localStorage，用户在对话中枢内
 * 即可调整，无需改代码。
 *
 * 默认值即为推荐的生产配置，用户可通过设置弹窗覆盖。
 */
import { useStorage } from '@/composables/useStorage'
import type { Ref } from 'vue'

// ============ 类型 ============

export interface ChatSettings {
  /** Agent 循环最大轮数，防止工具调用失控 */
  maxRounds: number
  /** 对话历史 token 预算上限（粗略估算），超过时截断早期消息 */
  maxHistoryTokens: number
  /** 单次模型输出 token 上限 */
  maxOutputTokens: number
  /** 用户一次最多可粘贴 / 拖入的图片张数 */
  maxImages: number
}

// ============ 默认值 ============

export const CHAT_SETTINGS_DEFAULTS: ChatSettings = {
  maxRounds: 50,
  maxHistoryTokens: 120_000,
  maxOutputTokens: 40_960,
  maxImages: 9,
}

// ============ 持久化 key ============

const SETTINGS_KEY = 'hao123-chat-settings'

// ============ 模块级单例 ============
// useStorage 返回一个与 localStorage 双向同步的 ref；
// 在模块 import 时即初始化，无需 Vue 组件上下文。

const settingsRef: Ref<ChatSettings> = useStorage<ChatSettings>(
  SETTINGS_KEY,
  { ...CHAT_SETTINGS_DEFAULTS },
)

// ============ 数据清洗 ============

/**
 * 确保 settings 对象中的每个字段都存在且为有效数字。
 * 处理两种情况：
 * 1. localStorage 中存有残缺 JSON（如旧版本迁移时缺字段）→ 缺失字段回填默认值
 * 2. 用户通过 devtools 或脚本写入了非数字值 → 回退默认值
 */
function normalizeSettings(raw: ChatSettings): ChatSettings {
  const out = { ...raw }
  for (const key of Object.keys(CHAT_SETTINGS_DEFAULTS) as (keyof ChatSettings)[]) {
    if (typeof out[key] !== 'number' || Number.isNaN(out[key])) {
      out[key] = CHAT_SETTINGS_DEFAULTS[key]
    }
  }
  return out
}

// ============ 公开 API ============

/**
 * 在 Vue 组件 / Pinia store 中获取可配置的对话参数。
 * 返回的 settings 是响应式 ref，可直接 .value 读取或在 computed 中依赖。
 */
export function useChatSettings() {
  function update(patch: Partial<ChatSettings>) {
    settingsRef.value = normalizeSettings({ ...settingsRef.value, ...patch })
  }

  function reset() {
    settingsRef.value = { ...CHAT_SETTINGS_DEFAULTS }
  }

  return {
    settings: settingsRef,
    update,
    reset,
    defaults: CHAT_SETTINGS_DEFAULTS,
  }
}

/**
 * 非响应式只读访问器——供不需要响应式的工具函数使用
 * （如 utils.ts 中的 truncateHistory 在纯函数上下文中无法依赖 ref）。
 * 注意：调用方需自行保证拿到的是最新值；通常 store.ts 在 buildApiMessages
 * 时读取，每次 send() 都会重新调用，天然拿到最新值。
 */
export function getChatSettings(): Readonly<ChatSettings> {
  return normalizeSettings(settingsRef.value)
}
