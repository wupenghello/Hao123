/**
 * 本地任务 UI 工具：优先级徽标 / 截止日期判定。
 *
 * 刻意不引用 zentao/shared/ui——本模块与禅道无关，自包含。
 * 逻辑与禅道侧等价（pri 1~4、deadline yyyy-MM-dd 按本地时区比逾期），但独立维护，
 * 避免本地任务反过来耦合禅道模块。
 */

export interface PriBadge {
  label: string
  class: string
}

/** 优先级 1~4 → 标签 + 配色（与项目徽标配色一致：P1 红 / P2 琥珀 / P3 蓝 / P4 灰） */
const PRI_BADGE: Record<number, PriBadge> = {
  1: { label: 'P1', class: 'text-rose-300 bg-rose-400/10 ring-rose-400/30' },
  2: { label: 'P2', class: 'text-amber-300 bg-amber-400/10 ring-amber-400/30' },
  3: { label: 'P3', class: 'text-sky-300 bg-sky-400/10 ring-sky-400/30' },
  4: { label: 'P4', class: 'text-slate-300 bg-slate-400/10 ring-slate-400/25' },
}

export function priBadge(pri: number): PriBadge {
  return PRI_BADGE[pri] ?? PRI_BADGE[3]
}

/** 截止日期是否有效（yyyy-MM-dd） */
export function hasDeadline(d?: string): boolean {
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)
}

/** 把 yyyy-MM-dd 解析为本地零点 Date（避免 UTC 解析导致时区误判） */
function deadlineToLocalMidnight(deadline: string): Date | null {
  const day = deadline.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const d = new Date(`${day}T00:00:00`)
  return isNaN(d.getTime()) ? null : d
}

function localTodayMidnight(): Date {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t
}

/** 是否已逾期（截止日早于今天） */
export function isOverdue(d?: string): boolean {
  if (!hasDeadline(d)) return false
  const dl = deadlineToLocalMidnight(d!)
  if (!dl) return false
  return dl.getTime() < localTodayMidnight().getTime()
}

/** 是否今天到期 */
export function isToday(d?: string): boolean {
  if (!hasDeadline(d)) return false
  const dl = deadlineToLocalMidnight(d!)
  if (!dl) return false
  return dl.getTime() === localTodayMidnight().getTime()
}

/**
 * 截止日期的展示文案：今天 →「今天」、明天 →「明天」、逾期 →「已逾期 N 天」，
 * 否则原样返回 M/D。用于列表行右侧的轻量提示。
 */
export function deadlineLabel(d?: string): string | null {
  if (!hasDeadline(d)) return null
  const dl = deadlineToLocalMidnight(d!)
  if (!dl) return null
  const today = localTodayMidnight()
  const dayMs = 24 * 60 * 60 * 1000
  const diff = Math.round((dl.getTime() - today.getTime()) / dayMs)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天逾期'
  if (diff < 0) return `逾期 ${-diff} 天`
  if (diff <= 7) return `${diff} 天后`
  return `${dl.getMonth() + 1}/${dl.getDate()}`
}

/** 本地任务是否紧急：未完成 + 优先级 1~2，或已逾期（与首页紧急点口径一致） */
export function isUrgentLocalTask(t: { done?: boolean; pri: number; deadline?: string }): boolean {
  if (t.done) return false
  if (t.pri <= 2) return true
  return isOverdue(t.deadline)
}
