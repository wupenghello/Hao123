/**
 * Chat 助手 · 反馈统计
 *
 * 从旧 store.ts 抽出的纯函数：反馈分类（classifyAssistantMessage）、
 * 分类表（FEEDBACK_CATEGORIES）、统计归因（incCategory）、
 * 持久化归一化（normalizeFeedbackStats）。不依赖 Pinia，可单测。
 */
import type { FeedbackCategory, FeedbackStats } from './types'
import type { Turn } from './turns'

export const FEEDBACK_CATEGORIES: { key: FeedbackCategory; label: string }[] = [
  { key: 'briefing', label: '晨报' },
  { key: 'task-planning', label: '任务排序' },
  { key: 'git', label: 'Git' },
  { key: 'kb', label: '知识库' },
  { key: 'weather', label: '天气' },
  { key: 'local-task', label: '本地待办' },
  { key: 'zentao', label: '禅道' },
  { key: 'vision', label: '图片理解' },
  { key: 'general', label: '通用' },
]

export function emptyCategoryStats() {
  return { up: 0, down: 0, regenerations: 0 }
}

export function defaultFeedbackStats(): FeedbackStats {
  return { up: 0, down: 0, regenerations: 0, byCategory: {} }
}

export function normalizeFeedbackStats(v: FeedbackStats): FeedbackStats {
  if (!v.byCategory) v.byCategory = {}
  for (const cat of FEEDBACK_CATEGORIES) {
    v.byCategory[cat.key] = { ...emptyCategoryStats(), ...(v.byCategory[cat.key] ?? {}) }
  }
  return v
}

export function categoryLabel(cat?: FeedbackCategory): string {
  return FEEDBACK_CATEGORIES.find((c) => c.key === cat)?.label || '通用'
}

export function incCategory(
  stats: FeedbackStats,
  cat: FeedbackCategory,
  key: keyof ReturnType<typeof emptyCategoryStats>,
  delta: number,
) {
  const cur = stats.byCategory[cat] ?? emptyCategoryStats()
  cur[key] = Math.max(0, cur[key] + delta)
  stats.byCategory[cat] = cur
}

/** 把一条 assistant 回答归类到具体能力场景（赞/踩归因用） */
export function classifyAssistantMessage(history: Turn[], assistant: Turn): FeedbackCategory {
  const recent = history.slice(-8)
  const text = [...recent, assistant]
    .map((t) => [t.answer, ...(t.steps.map((s) => `${s.tool} ${s.label} ${s.detail || ''}`) ?? [])].join('\n'))
    .join('\n')
    .toLowerCase()

  if (/今日简报|晨报|briefing/.test(text)) return 'briefing'
  if (/接手模式|今天最该|处理顺序|任务排序|小吴已就绪|逾期|临期|停滞|安排今天/.test(text)) return 'task-planning'
  if (/git|commit|branch|checkout|pull|push|diff|blame|reflog|stash|tag/.test(text)) return 'git'
  if (/知识库|kb|文档|环境地址|部署流程|kb__search/.test(text)) return 'kb'
  if (/天气|气温|下雨|带伞|穿衣|weather/.test(text)) return 'weather'
  if (/本地待办|local__|记一下|提醒我|待办/.test(text)) return 'local-task'
  if (/禅道|zentao|任务详情|bug/.test(text)) return 'zentao'
  if (/图片|截图|视觉|image_url|看图/.test(text) || recent.some((t) => t.images?.length)) return 'vision'
  return 'general'
}
