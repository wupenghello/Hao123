/**
 * 心情引擎（确定性纯函数，零 LLM）。
 *
 * 输入全部是工作台现有信号（configured / connectivity / streaming / unread / 风险 / 问候标记），
 * 输出单一 mood。优先级仲裁（取最强一档），与 insights 的 KIND_RANK 同思路：
 *   sleeping(!configured) > offline > thinking > celebrating > attentive > concerned > greeting > idle
 */
import type { CompanionMood } from './types'

export interface MoodSignals {
  configured: boolean
  connectivity: 'healthy' | 'checking' | 'unreachable'
  streaming: boolean
  celebrating: boolean
  unread: boolean
  open: boolean
  topRisk: 'overdue' | 'dueSoon' | 'stalled' | null
  greetingDue: boolean
}

export function resolveMood(s: MoodSignals): CompanionMood {
  if (!s.configured) return 'sleeping'
  if (s.connectivity === 'unreachable') return 'offline'
  if (s.streaming) return 'thinking'
  if (s.celebrating) return 'celebrating'
  if (s.unread && !s.open) return 'attentive'
  if (s.topRisk === 'overdue' || s.topRisk === 'dueSoon') return 'concerned'
  if (s.greetingDue) return 'greeting'
  return 'idle'
}
