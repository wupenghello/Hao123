/**
 * 语音气泡 builder（确定性文案，零 LLM）。
 *
 * 气泡内容尽量复用既有产物（晨报 / 洞察 / 连通性 / 完成事件），不另起 LLM 链；
 * 唯一可选的 LLM 润色（问候一句）留待后续，当前走确定性模板即可。
 */
import type { BubblePayload } from './types'
import { greetingWord } from './ui'

let _seq = 0
function nextId(kind: BubblePayload['kind']): string {
  _seq += 1
  return `${kind}-${_seq}`
}

export interface InsightLike {
  kind?: string
  title: string
  action?: string
}

/** 洞察签名：清单结构变了才重弹 */
export function insightSignature(insights: InsightLike[]): string {
  return insights.map((i) => `${i.kind ?? 'x'}:${i.title}`).join('|')
}

export interface GreetingInput {
  hour: number
  headline?: string
  overdue: number
  dueSoon: number
  total: number
  onDeepChat: () => void
}

export function buildGreeting(o: GreetingInput): BubblePayload {
  const word = greetingWord(o.hour)
  let text: string
  if (o.overdue > 0) {
    text = `${word}。今天有 ${o.overdue} 项逾期${o.dueSoon > 0 ? `、${o.dueSoon} 项今天到期` : ''}，要不要我先帮你排个顺序？`
  } else if (o.dueSoon > 0) {
    text = `${word}。今天有 ${o.dueSoon} 项今天到期，先抓哪个我已经想好了。`
  } else if (o.total > 0) {
    text = `${word}。今天 ${o.total} 项待办，节奏不紧，慢慢来。`
  } else {
    text = `${word}。今天清闲，有我在，随时叫我。`
  }
  return {
    id: nextId('greeting'),
    kind: 'greeting',
    text,
    actionLabel: o.total > 0 ? '让小吴排一下 →' : undefined,
    handoff: o.onDeepChat,
  }
}

export function buildInsightBubble(o: InsightLike, onDeepChat: () => void): BubblePayload {
  const text = `注意到一个情况：${o.title}${o.action ? `——${o.action}` : ''}`
  return { id: nextId('insight'), kind: 'insight', text, actionLabel: '让小吴展开 →', handoff: onDeepChat }
}

export function buildRecovery(onDeepChat?: () => void): BubblePayload {
  return {
    id: nextId('recovery'),
    kind: 'recovery',
    text: '回来啦，网络恢复了。',
    actionLabel: onDeepChat ? '接着答 →' : undefined,
    handoff: onDeepChat,
  }
}

export function buildCelebration(extra?: string): BubblePayload {
  return { id: nextId('celebration'), kind: 'celebration', text: extra || '漂亮，又搞定一项！' }
}
