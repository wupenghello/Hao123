/**
 * 禅道共享 UI 工具：任务与 Bug 通用的徽标 / 文本清洗 / 富文本处理。
 *
 * 任务专属（状态/类型）映射放 task/ui.ts，Bug 专属（状态/严重度/类型/解决方案）放 bug/ui.ts，
 * 二者都复用这里的 Badge 类型、FALLBACK_CLASS、优先级徽标与富文本工具。
 *
 * 颜色用半透明描边方案（与深色背景协调），返回组合好的 class 串。
 */

export interface Badge {
  label: string
  class: string
}

/** 未知值兜底配色 */
export const FALLBACK_CLASS = 'text-zinc-300 bg-zinc-400/10 ring-zinc-400/25'

/**
 * 徽标工厂：给定「标签映射」「配色映射」，产出一个 (key) → Badge 的函数。
 * 任务状态、Bug 状态、严重度等都是「查标签 + 查配色 + 兜底」的同一模式，统一在此构造。
 * @param labelMap 值 → 中文标签；未命中时 label 回退为原始值
 * @param classMap 值 → 配色 class；未命中时回退 FALLBACK_CLASS
 */
export function makeBadge<K extends string | number>(
  labelMap: Record<K, string>,
  classMap: Record<K, string>,
): (key: K) => Badge {
  return (key: K) => ({
    label: labelMap[key] ?? String(key),
    class: classMap[key] ?? FALLBACK_CLASS,
  })
}

/**
 * 标签工厂：给定「代码 → 中文」映射，产出一个 (code) → label 的函数。
 * 空/未命中时分别回退空串 / 原始码。任务类型、Bug 类型、解决方案等共用。
 */
export function makeLabel(map: Record<string, string>): (code?: string) => string {
  return (code?: string) => {
    if (!code) return ''
    return map[code] ?? code
  }
}

/**
 * 优先级 1~4（数字越小越高）→ 标签 + 配色。
 * 禅道 pri 可能是 string 或 number，统一规整。任务与 Bug 共用。
 */
const PRI_LABEL: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' }
const PRI_CLASS: Record<number, string> = {
  1: 'text-rose-300 bg-rose-400/10 ring-rose-400/30',
  2: 'text-amber-300 bg-amber-400/10 ring-amber-400/30',
  3: 'text-sky-300 bg-sky-400/10 ring-sky-400/30',
  4: 'text-slate-300 bg-slate-400/10 ring-slate-400/25',
}

export function priorityBadge(pri: string | number): Badge | null {
  const n = Number(pri)
  if (!n || Number.isNaN(n)) return null
  return {
    label: PRI_LABEL[n] ?? `P${n}`,
    class: PRI_CLASS[n] ?? FALLBACK_CLASS,
  }
}

/** 截止日期是否有效（禅道用 0000-00-00 / 空 表示无） */
export function hasDeadline(deadline?: string): boolean {
  return !!deadline && !/^0000-00-00/.test(deadline)
}

/**
 * 把禅道截止日期（yyyy-MM-dd）解析为「本地零点」的 Date。
 *
 * 关键：`new Date("2024-06-25")` 按规范解析为 **UTC 零点**，与本地零点存在时区差，
 * 在负 UTC 偏移（美洲）会把「今天到期」误判为已逾期。这里补上 `T00:00:00` 让其按
 * **本地时间**解析，再与本地零点的 today 比较，保证任何时区下「今天到期」都不算逾期。
 */
function deadlineToLocalMidnight(deadline: string): Date | null {
  // 已是 yyyy-MM-dd 或带时间；统一取前 10 位补本地零点
  const day = deadline.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const d = new Date(`${day}T00:00:00`)
  return isNaN(d.getTime()) ? null : d
}

/** 今日本地零点 */
function localTodayMidnight(): Date {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t
}

/** 任务/工单是否已逾期（截止日早于今天，按本地时区比较） */
export function isOverdue(deadline?: string): boolean {
  if (!hasDeadline(deadline)) return false
  const dl = deadlineToLocalMidnight(deadline!)
  if (!dl) return false
  return dl.getTime() < localTodayMidnight().getTime()
}

/** 把 pri/severity 这类「string | number」规整为合法优先级数字；空/0/非法返回 null（视为未设置） */
function toPriorityNum(v: string | number | undefined | null): number | null {
  if (v == null) return null
  const n = Number(v)
  if (!n || Number.isNaN(n)) return null // '' / '0' / 0 → 视为未设置，不误判为最高优先级
  return n
}

/** 紧急任务判定结构（任务） */
export interface UrgentTaskLike {
  pri?: string | number
  deadline?: string
  status?: string
}
/** 紧急 Bug 判定结构 */
export interface UrgentBugLike {
  severity?: string | number
  status?: string
}

/** 任务是否紧急：非终态 + 优先级 1~2，或已逾期 */
export function isUrgentTask(t: UrgentTaskLike): boolean {
  const s = t.status
  if (s === 'done' || s === 'closed' || s === 'cancel') return false
  const pri = toPriorityNum(t.pri)
  if (pri != null && pri <= 2) return true
  return isOverdue(t.deadline)
}

/** Bug 是否紧急：待解决（active）且严重度 1~2 */
export function isUrgentBug(b: UrgentBugLike): boolean {
  return b.status === 'active' && (toPriorityNum(b.severity) ?? 99) <= 2
}

/**
 * 过滤禅道的「伪值」：任务关闭后 assignedTo 会变成状态词（closed/done/cancel），
 * 还有空串 / '0' / '0000-00-00' 等，这些不该作为真实内容展示。
 * @returns 有意义的文本，否则空串
 */
const PSEUDO_VALUES = new Set(['', '0', 'closed', 'done', 'cancel', 'wait', 'doing', 'pause'])
export function cleanText(v?: string | number | null): string {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  if (PSEUDO_VALUES.has(s.toLowerCase())) return ''
  if (/^0000-00-00/.test(s)) return ''
  return s
}

/**
 * 把禅道返回的 HTML 压成纯文本：去标签、还原常见实体、合并空白。
 * 仅用于「判空 / 列表摘要」等场景；详情正文用 sanitizeHtml 保留富文本。
 */
export function htmlToText(html?: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/**
 * 清洗禅道富文本，用于安全地 v-html 渲染（保留段落 / 图片 / 列表 / 链接 / 表格，
 * 去除脚本与一切可执行内容）。
 *
 * 禅道富文本里常见 `<img onload="setImageSize(this,0)" src="/zentao/file-read-*.jpg">`，
 * 图片路径已是 /zentao 前缀的绝对路径，正好走本项目 vite 代理（file-read 无需鉴权，实测可直接加载）。
 *
 * 清洗内容：
 *   - 整段移除 <script> / <style> / <iframe> / <object> / <embed> 及其内容
 *   - 移除所有 on* 内联事件属性（onload/onclick/onerror…）
 *   - 移除 javascript: / data:（非图片）等危险协议
 *
 * 注意：不加 loading=lazy —— 详情图通常很少，且懒加载在「弹窗滚动容器 + 初始视口外」
 * 场景下常不触发，导致图片不显示；直接加载更可靠。
 */
export function sanitizeHtml(html?: string): string {
  if (!html) return ''
  const s = html
    // 危险标签连同内容一起删
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    // 去掉所有 on* 内联事件属性（双引号 / 单引号 / 无引号）
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    // 去掉 href/src 里的 javascript: 协议
    .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'")

  return s.trim()
}

/**
 * 判断一段 HTML 是否「有可展示内容」：含文字 **或** 含图片即算有。
 * 关键：禅道很多描述/需求只有一张图、没有文字，若仅用 htmlToText 判空会漏掉图片，
 * 导致整段被当成空而显示「暂无描述」——必须把 <img> 也算作有内容。
 */
export function hasRichContent(html?: string): boolean {
  if (!html) return false
  if (htmlToText(html).length > 0) return true
  return /<img\b/i.test(html)
}
