/**
 * Avatar 模块 · 配置
 *
 * 内置形象清单、缩放边界、表情映射、行为参数集中管理。
 * 上层只读引用，不魔改。
 *
 * 内置形象来自 Live2D 官方 CubismWebSamples（Cubism 4），走 jsDelivr 镜像。
 */
import type { AvatarModelConfig, AvatarModelOption, ExpressionMapping } from './types'
import type { AvatarExpression } from './types'

/** CubismWebSamples 模型根路径（jsDelivr 镜像 develop 分支） */
const CDN_BASE =
  'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources'

/**
 * 内置形象清单（均 Cubism 4，运行时由 runtime.ts 懒加载）。
 * 切换形象 = 改 url → AvatarStage watch 重建渲染器。
 */
export const AVATAR_MODELS: AvatarModelOption[] = [
  { id: 'Hiyori', label: '日和', url: `${CDN_BASE}/Hiyori/Hiyori.model3.json`, desc: '少女' },
  { id: 'Haru', label: '春', url: `${CDN_BASE}/Haru/Haru.model3.json`, desc: '少女' },
  { id: 'Mao', label: '茉', url: `${CDN_BASE}/Mao/Mao.model3.json`, desc: '少女' },
  { id: 'Mark', label: '马克', url: `${CDN_BASE}/Mark/Mark.model3.json`, desc: '少年' },
  { id: 'Natori', label: '名取', url: `${CDN_BASE}/Natori/Natori.model3.json`, desc: '男性' },
  { id: 'Rice', label: '蕾依', url: `${CDN_BASE}/Rice/Rice.model3.json`, desc: '少女' },
  { id: 'Ren', label: '莲', url: `${CDN_BASE}/Ren/Ren.model3.json`, desc: '少女' },
  { id: 'Wanko', label: '汪子', url: `${CDN_BASE}/Wanko/Wanko.model3.json`, desc: '小狗' },
]

/** 默认形象 id */
export const DEFAULT_MODEL_ID = 'Hiyori'

/** 按 id 查模型 URL（找不到回退首个） */
export function getAvatarModelUrl(id: string): string {
  return AVATAR_MODELS.find((m) => m.id === id)?.url ?? AVATAR_MODELS[0].url
}

/** 按 id 查模型选项（找不到回退首个） */
export function getAvatarModel(id: string): AvatarModelOption {
  return AVATAR_MODELS.find((m) => m.id === id) ?? AVATAR_MODELS[0]
}

// ============ 缩放边界（相对自适应 fit 的倍数） ============
export const SCALE_FACTOR_MIN = 0.5
export const SCALE_FACTOR_MAX = 2.0
/** 单次放大/缩小步长 */
export const SCALE_FACTOR_STEP = 0.1

/** 把缩放倍数约束到边界 */
export function clampScaleFactor(f: number): number {
  return Math.max(SCALE_FACTOR_MIN, Math.min(SCALE_FACTOR_MAX, Number(f.toFixed(2))))
}

// ============ localStorage keys ============
/** 用户选择的形象 id */
export const STORAGE_KEY_MODEL = 'hao123-avatar-model'
/** 用户调整的缩放倍数 */
export const STORAGE_KEY_SCALE = 'hao123-avatar-scale'

/**
 * 默认模型配置——不指定 scale/scaleFactor，由渲染器自适应 + 用户倍数叠加。
 */
export const DEFAULT_MODEL_CONFIG: AvatarModelConfig = {
  url: getAvatarModelUrl(DEFAULT_MODEL_ID),
}

/** 眨眼间隔（毫秒）——随机范围 */
export const BLINK_INTERVAL_MIN = 2000
export const BLINK_INTERVAL_MAX = 6000

/** 呼吸动画周期（毫秒） */
export const BREATH_CYCLE_MS = 3000

/** 视线追随的平滑系数（0~1，越大越跟手） */
export const FOCUS_SMOOTHING = 0.15

/** 说话时嘴型开合的最大幅度（归一化 0~1） */
export const SPEAK_MOUTH_MAX = 0.7

/** 说话时嘴型振荡频率（Hz） */
export const SPEAK_MOUTH_FREQ = 12

/** 表情 → Live2D 参数映射（Cubism 4 模型通用参数） */
export const EXPRESSION_MAPPINGS: Record<AvatarExpression, ExpressionMapping> = {
  neutral: {},
  happy: {
    params: { ParamEyeLOpen: 0.6, ParamEyeROpen: 0.6, ParamMouthOpenY: 0.2 },
  },
  sad: {
    params: { ParamAngleX: -8, ParamAngleY: 0, ParamEyeLOpen: 0.7, ParamEyeROpen: 0.7 },
  },
  surprised: {
    params: { ParamEyeLOpen: 1.2, ParamEyeROpen: 1.2, ParamMouthOpenY: 0.6 },
  },
  thinking: {
    params: { ParamAngleX: 5, ParamAngleY: 10 },
  },
  alert: {
    params: { ParamEyeLOpen: 1.0, ParamEyeROpen: 1.0 },
    motionGroup: 'tap_body',
  },
}

/** 常用 Live2D 参数 id（Cubism 4 模型通用参数） */
export const PARAM = {
  ANGLE_X: 'ParamAngleX',
  ANGLE_Y: 'ParamAngleY',
  ANGLE_Z: 'ParamAngleZ',
  EYE_L_OPEN: 'ParamEyeLOpen',
  EYE_R_OPEN: 'ParamEyeROpen',
  MOUTH_OPEN_Y: 'ParamMouthOpenY',
  BODY_ANGLE_X: 'ParamBodyAngleX',
  BREATH: 'ParamBreath',
} as const
