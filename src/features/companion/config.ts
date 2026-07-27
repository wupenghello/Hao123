/**
 * 小吴 · 常驻 AI 伙伴配置
 *
 * - 模型源：御姐首选 Senko（仙狐小姐），cool 御姐备选 HK416。
 * - env：VITE_COMPANION_MODEL（换模型）/ VITE_COMPANION_RENDERER（换引擎）/ VITE_COMPANION_DISABLED（一键关）。
 * - License 红线：oml2d 托管模型声明「仅供学习、严禁商业」；小吴单用户本地自用无忧，
 *   公开 / 商用须换授权模型（约稿或官方授权）。
 */
import type { CompanionRendererKind } from './types'

/** env 字符串取值，空回默认 */
function envStr(v: string | undefined, def: string): string {
  const s = (v ?? '').trim()
  return s || def
}

/** 御姐首选：Senko（仙狐小姐，温婉大姐姐 / 照顾型，契合「小吴照顾你的工作台」） */
export const SENKO_MODEL = 'https://model.oml2d.com/Senko_Normals/senko.model3.json'
/** cool 御姐备选：HK416（少女前线战术人形，冷艳干练） */
export const HK416_MODEL = 'https://model.oml2d.com/HK416-1-normal/model.json'

export const DEFAULT_MODEL_SOURCE = envStr(import.meta.env.VITE_COMPANION_MODEL, SENKO_MODEL)
export const COMPANION_DISABLED = envStr(import.meta.env.VITE_COMPANION_DISABLED, '') === 'true'
const RENDERER_RAW = envStr(import.meta.env.VITE_COMPANION_RENDERER, 'live2d')
export const DEFAULT_RENDERER: CompanionRendererKind =
  RENDERER_RAW === 'rive' || RENDERER_RAW === 'lottie' ? RENDERER_RAW : 'live2d'

/** localStorage 键：伙伴持久态 */
export const COMPANION_STATE_KEY = 'hao123-companion-state'
/** 老药丸位置键（迁移源，迁移后留置无害） */
export const LEGACY_LAUNCHER_POS_KEY = 'hao123-chat-launcher-pos'

/** 气泡自动消失（ms） */
export const BUBBLE_AUTO_DISMISS_MS = 6000
/** 已关闭气泡 id 上限 */
export const DISMISSED_CAP = 20
/** 免打扰夜间窗口（本地小时，含 start 不含 end） */
export const SLEEP_HOUR_START = 23
export const SLEEP_HOUR_END = 7
/** 庆祝 mood 瞬态时长（ms） */
export const CELEBRATE_MS = 3000
/** 进站问候延迟（ms，等工作台可交互后再开口） */
export const GREETING_DELAY_MS = 1200

/** Senko 的 OhMyLive2D 模型配置（position 来自官方模型资源页） */
export const SENKO_OML2D_CONFIG = {
  path: SENKO_MODEL,
  position: [-10, 20] as [number, number],
}
