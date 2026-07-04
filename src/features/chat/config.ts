/**
 * Chat 助手 · 公共配置
 *
 * 所有 LLM 接入参数（API Key / 模型 / Base URL）均在页面内配置，
 * 不再依赖 .env。助手身份留空使用默认「小吴」。
 */

/** 读取并 trim env，空串/未配置回退到默认值 */
function envOr(value: string | undefined, fallback: string): string {
  const v = value?.trim()
  return v || fallback
}

// ============ 助手身份（改动极少，可由 .env 覆盖） ============

/** 助手名称（默认「小吴」），全应用文案统一引用此处 */
export const ASSISTANT_NAME = envOr(import.meta.env.VITE_ASSISTANT_NAME, '小吴')

/** 助手一句话定位（欢迎页副标题 / 命令面板提示） */
export const ASSISTANT_TAGLINE = envOr(
  import.meta.env.VITE_ASSISTANT_TAGLINE,
  '你的工作台智能助理 —— 查天气、看禅道任务与 Bug，一句话就够。',
)
