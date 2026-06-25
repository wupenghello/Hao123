/**
 * 禅道 Bug 专属 UI 映射：状态、严重度、类型、解决方案 → 中文标签 + 配色。
 * 优先级徽标、文本清洗、富文本工具等通用能力在 ../shared/ui.ts。
 */
import { makeBadge, makeLabel, type Badge } from '../shared/ui'

/** Bug 状态 → 中文标签 */
const BUG_STATUS_LABEL: Record<string, string> = {
  active: '激活',
  resolved: '已解决',
  closed: '已关闭',
}

/** Bug 状态 → 徽标配色 */
const BUG_STATUS_CLASS: Record<string, string> = {
  active: 'text-rose-300 bg-rose-400/10 ring-rose-400/30',
  resolved: 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/30',
  closed: 'text-zinc-400 bg-zinc-400/10 ring-zinc-400/25',
}

/** Bug 状态徽标 */
export const bugStatusBadge = makeBadge(BUG_STATUS_LABEL, BUG_STATUS_CLASS)

/**
 * Bug 严重程度 1~4（数字越小越严重）→ 标签 + 配色。
 */
const SEVERITY_LABEL: Record<number, string> = { 1: '严重', 2: '主要', 3: '次要', 4: '轻微' }
const SEVERITY_CLASS: Record<number, string> = {
  1: 'text-rose-300 bg-rose-400/10 ring-rose-400/30',
  2: 'text-orange-300 bg-orange-400/10 ring-orange-400/30',
  3: 'text-amber-300 bg-amber-400/10 ring-amber-400/30',
  4: 'text-slate-300 bg-slate-400/10 ring-slate-400/25',
}

const severityBadgeOf = makeBadge(SEVERITY_LABEL, SEVERITY_CLASS)
export function severityBadge(severity: string | number): Badge | null {
  const n = Number(severity)
  if (!n || Number.isNaN(n)) return null
  return severityBadgeOf(n)
}

/** Bug 类型代码 → 中文 */
const BUG_TYPE_LABEL: Record<string, string> = {
  codeerror: '代码错误',
  config: '配置相关',
  install: '安装部署',
  security: '安全相关',
  performance: '性能问题',
  standard: '标准规范',
  automation: '测试脚本',
  designdefect: '设计缺陷',
  interface: '界面优化',
  others: '其他',
}

/** Bug 解决方案代码 → 中文 */
const RESOLUTION_LABEL: Record<string, string> = {
  bydesign: '设计如此',
  duplicate: '重复 Bug',
  external: '外部原因',
  fixed: '已解决',
  notrepro: '无法重现',
  postponed: '延期处理',
  willnotfix: '不予解决',
  tostory: '转为需求',
}

export const bugTypeLabel = makeLabel(BUG_TYPE_LABEL)

export const resolutionLabel = makeLabel(RESOLUTION_LABEL)
