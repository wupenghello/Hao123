/**
 * 每日晨报 · 显著性门控（何时值得重排）
 *
 * 设计取向：克制。晨报 agent 每次触发都烧 token，不能每次工作项微变都重排。
 * 只在「计划真的需要改了」才重排，避免刷屏与成本浪费。
 *
 * 触发重排的显著变化：
 *  - 新增逾期项（之前没有逾期，现在出现了）
 *  - 新增紧急 Bug（severity 1-2 的 active Bug 首次出现）
 *  - 今日截止项状态变更（已完成 / 已取消 → 腾出空间）
 *  - 天气预警（暴雨 / 高温 / 雷阵雨等首次出现）
 *
 * 不触发：低优积压 +1、已完成项的备注变化、无风险任务的优先级微调。
 *
 * 节流器：同一天最多重排 MAX_REGENERATIONS_PER_DAY 次（默认 3），超出后不再自动触发，
 * 但用户手点「刷新」始终可用。
 */

import { useWeatherStore } from '@/features/weather'
import { useTaskStore, useBugStore } from '@/features/zentao'
import { useLocalTaskStore } from '@/features/local-tasks'

/** 同日最大自动重排次数（超出后不再自动触发，手点刷新始终可用） */
export const MAX_REGENERATIONS_PER_DAY = 3

/** 同日已自动重排次数（模块级内存，刷新页面重置是合理的——新一天的开始） */
let todayRegenerations = 0
/** 当前计数对应的日期（用于跨天重置） */
let regenDate = ''

/** 本地日期 yyyy-MM-dd */
function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 重置同日计数器（跨天时） */
function ensureDate() {
  const today = todayStr()
  if (regenDate !== today) {
    regenDate = today
    todayRegenerations = 0
  }
}

/** 记录一次自动重排（调用方在确实触发重排前调用） */
export function consumeRegenerationBudget(): boolean {
  ensureDate()
  if (todayRegenerations >= MAX_REGENERATIONS_PER_DAY) return false
  todayRegenerations++
  return true
}

/** 剩余可重排次数（UI 展示用） */
export function remainingRegenerations(): number {
  ensureDate()
  return Math.max(0, MAX_REGENERATIONS_PER_DAY - todayRegenerations)
}

interface Snapshot {
  tasks: Array<{ id: string; status: string; deadline?: string; pri: number }>
  bugs: Array<{ id: string; status: string; severity?: string | number; deadline?: string }>
  local: Array<{ id: string; done: boolean; deadline?: string; pri: number }>
  weatherAlert: boolean
}

/** 当前快照 */
function currentSnapshot(): Snapshot {
  const taskStore = useTaskStore()
  const bugStore = useBugStore()
  const localStore = useLocalTaskStore()
  const weather = useWeatherStore()
  return {
    tasks: taskStore.assigned.map((t) => ({ id: t.id, status: t.status, deadline: t.deadline, pri: Number(t.pri) || 4 })),
    bugs: bugStore.assigned.map((b) => ({ id: b.id, status: b.status, severity: b.severity, deadline: b.deadline })),
    local: localStore.tasks.map((t) => ({ id: t.id, done: t.done, deadline: t.deadline, pri: t.pri })),
    weatherAlert: hasWeatherAlert(weather.now?.icon),
  }
}

/** 是否天气预警（雷阵雨 / 暴雨 / 暴雪 — 基于 QWeather 天气现象图标码） */
function hasWeatherAlert(icon?: string | number): boolean {
  const c = Number(icon)
  if (!Number.isFinite(c)) return false
  // 雷阵雨 302-304、暴雨 305-318
  if (c >= 302 && c <= 318) return true
  // 暴雪 / 大雪 400-499
  if (c >= 400 && c <= 499) return true
  return false
}

/** 把 yyyy-MM-dd 解析为本地零点Date（规避 `new Date('yyyy-MM-dd')` 被当作 UTC 的误判） */
function parseLocalDate(deadline: string): Date {
  const [y, m, d] = deadline.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 今天 / 明天截止（含今天逾期） */
function isDueTodayOrOverdue(deadline?: string): boolean {
  if (!deadline || /^0000/.test(deadline)) return false
  const d = parseLocalDate(deadline)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = (d.getTime() - today.getTime()) / 86400000
  return diff <= 1
}

/** 之前没有逾期项，现在出现了 → 显著 */
function newOverdueAppeared(prev: Snapshot, curr: Snapshot): boolean {
  const prevOverdue = prev.tasks.some((t) => isOverdue(t.deadline, t.status))
  if (prevOverdue) return false
  return curr.tasks.some((t) => isOverdue(t.deadline, t.status))
}

function isOverdue(deadline?: string, status?: string): boolean {
  if (!deadline || /^0000/.test(deadline)) return false
  if (status === 'done' || status === 'closed' || status === 'cancel') return false
  const d = parseLocalDate(deadline)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}

/** 新增紧急 Bug（severity 1-2 的 active Bug 首次出现） */
function newUrgentBugAppeared(prev: Snapshot, curr: Snapshot): boolean {
  const prevIds = new Set(prev.bugs.filter((b) => isUrgentBug(b)).map((b) => b.id))
  return curr.bugs.some((b) => isUrgentBug(b) && !prevIds.has(b.id))
}

function isUrgentBug(b: { status?: string; severity?: string | number }): boolean {
  if (b.status !== 'active') return false
  const s = Number(b.severity)
  return s === 1 || s === 2
}

/** 今日截止项状态变更（已完成 / 已取消） */
function todayDeadlineStatusChanged(prev: Snapshot, curr: Snapshot): boolean {
  const prevMap = new Map(prev.tasks.map((t) => [t.id, t]))
  for (const t of curr.tasks) {
    if (!isDueTodayOrOverdue(t.deadline)) continue
    const p = prevMap.get(t.id)
    if (p && p.status !== t.status) return true
  }
  return false
}

/** 天气预警首次出现 */
function weatherAlertAppeared(prev: Snapshot, curr: Snapshot): boolean {
  return !prev.weatherAlert && curr.weatherAlert
}

/**
 * 判断当前变化是否值得重排。
 * @param prev 上一次生成规划时的快照（null 表示首次，直接允许）
 */
export function isSignificantChange(prev: Snapshot | null): { significant: boolean; reason?: string } {
  if (!prev) return { significant: true, reason: '首次生成' }
  const curr = currentSnapshot()
  if (newOverdueAppeared(prev, curr)) return { significant: true, reason: '新增逾期项' }
  if (newUrgentBugAppeared(prev, curr)) return { significant: true, reason: '新增紧急 Bug' }
  if (todayDeadlineStatusChanged(prev, curr)) return { significant: true, reason: '今日截止项状态变更' }
  if (weatherAlertAppeared(prev, curr)) return { significant: true, reason: '天气预警' }
  return { significant: false }
}

/** 取当前快照（供调用方存为「上一次」） */
export function takeSnapshot(): Snapshot {
  return currentSnapshot()
}
