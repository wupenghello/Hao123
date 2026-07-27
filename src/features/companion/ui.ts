/**
 * mood → 视觉映射（色调光晕 / 文案 / aria），供容器辉光、徽标、aria-label 复用。
 * 配色对齐 HUD token（青主导 / 紫 AI / 琥珀警示 / 玫红错误 / 绿完成）。
 */
import type { CompanionMood } from './types'

export interface MoodVisual {
  label: string
  aria: string
  /** 容器辉光色（rgba） */
  glow: string
  /** 主色（hex，边框 / 徽标 / 占位光球上色） */
  tone: string
}

export const MOOD_VISUAL: Record<CompanionMood, MoodVisual> = {
  sleeping: { label: '休息中', aria: '小吴在休息（模型未配置）', glow: 'rgba(148,163,184,0.16)', tone: '#94a3b8' },
  offline: { label: '连不上', aria: '小吴暂时连不上大模型', glow: 'rgba(251,113,133,0.30)', tone: '#fb7185' },
  thinking: { label: '思考中', aria: '小吴正在思考', glow: 'rgba(167,139,250,0.36)', tone: '#a78bfa' },
  celebrating: { label: '干得漂亮', aria: '小吴为你点赞', glow: 'rgba(52,211,153,0.36)', tone: '#34d399' },
  attentive: { label: '有新消息', aria: '小吴有新回复给你', glow: 'rgba(34,211,238,0.34)', tone: '#22d3ee' },
  concerned: { label: '需留意', aria: '小吴注意到风险', glow: 'rgba(251,191,36,0.32)', tone: '#fbbf24' },
  greeting: { label: '你好呀', aria: '小吴向你打招呼', glow: 'rgba(34,211,238,0.30)', tone: '#22d3ee' },
  idle: { label: '待命', aria: '小吴待命中', glow: 'rgba(34,211,238,0.20)', tone: '#22d3ee' },
}

/** 当前时段问候词 */
export function greetingWord(hour: number): string {
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早安'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}
