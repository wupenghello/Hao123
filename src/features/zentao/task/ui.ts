/**
 * 禅道任务专属 UI 映射：状态、类型 → 中文标签 + 配色。
 * 优先级徽标、文本清洗、富文本工具等通用能力在 ../shared/ui.ts。
 */
import { makeBadge, makeLabel } from '../shared/ui'

/** 任务状态 → 中文标签 */
const TASK_STATUS_LABEL: Record<string, string> = {
  wait: '未开始',
  doing: '进行中',
  done: '已完成',
  pause: '已暂停',
  cancel: '已取消',
  closed: '已关闭',
}

/** 任务状态 → 徽标配色（文字/背景/描边） */
const TASK_STATUS_CLASS: Record<string, string> = {
  wait: 'text-slate-300 bg-slate-400/10 ring-slate-400/30',
  doing: 'text-sky-300 bg-sky-400/10 ring-sky-400/30',
  done: 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/30',
  pause: 'text-amber-300 bg-amber-400/10 ring-amber-400/30',
  cancel: 'text-zinc-400 bg-zinc-400/10 ring-zinc-400/25',
  closed: 'text-zinc-400 bg-zinc-400/10 ring-zinc-400/25',
}

/** 任务状态徽标 */
export const taskStatusBadge = makeBadge(TASK_STATUS_LABEL, TASK_STATUS_CLASS)

/**
 * 任务关闭原因 → 中文。
 * 禅道任务的 closedReason 是独立取值（done/cancel），与状态码含义不同，
 * 需单独映射；不可复用 taskStatusBadge，也不能被 cleanText 当伪值过滤掉。
 */
const TASK_CLOSED_REASON_LABEL: Record<string, string> = {
  done: '已完成',
  cancel: '已取消',
}

export const taskClosedReasonLabel = makeLabel(TASK_CLOSED_REASON_LABEL)

/** 任务类型代码 → 中文 */
const TASK_TYPE_LABEL: Record<string, string> = {
  design: '设计',
  devel: '开发',
  fe: '前端',
  be: '后端',
  request: '需求',
  test: '测试',
  study: '研究',
  discuss: '讨论',
  ui: '界面',
  affair: '事务',
  misc: '其他',
}

export const taskTypeLabel = makeLabel(TASK_TYPE_LABEL)
