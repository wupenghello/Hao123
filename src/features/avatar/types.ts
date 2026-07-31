/**
 * Avatar 模块 · 公共类型
 *
 * 渲染器无关的 avatar 状态与配置类型。
 */

/** 表情枚举——上层驱动，渲染器翻译成具体 Live2D 参数/motion */
export type AvatarExpression =
  | 'neutral' // 默认
  | 'happy' // 开心
  | 'sad' // 难过
  | 'surprised' // 惊讶
  | 'thinking' // 思考
  | 'alert' // 提醒/警告

/** 模型资源配置 */
export interface AvatarModelConfig {
  /** 模型 settings JSON 的 URL（.model.json / .model3.json） */
  url: string
  /** 手动覆盖缩放（不用自适应 fit），手工微调用 */
  scale?: number
  /** 相对自适应 fit 缩放的倍数，默认 1（用户放大/缩小用） */
  scaleFactor?: number
}

/** 可选形象（内置模型清单的一项） */
export interface AvatarModelOption {
  /** 唯一 id（同时作 localStorage key 的值） */
  id: string
  /** 展示名（中文） */
  label: string
  /** 模型 settings JSON 的 URL */
  url: string
  /** 一句话描述（性别 / 风格） */
  desc?: string
}

/** 单个表情对应的 Live2D 动作/参数覆写 */
export interface ExpressionMapping {
  /** 要播放的 motion 组名（可选） */
  motionGroup?: string
  /** 要播放的 motion 下标（可选，不填则随机） */
  motionIndex?: number
  /** 直接覆写的参数 id → 值 */
  params?: Record<string, number>
}

/** 渲染器内部状态（只读暴露） */
export interface AvatarState {
  /** 是否已加载完成可交互 */
  ready: boolean
  /** 是否正在说话 */
  speaking: boolean
  /** 当前表情 */
  expression: AvatarExpression
  /** 加载/出错时的文案（调试用） */
  message: string | null
}
