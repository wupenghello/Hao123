/**
 * 洞察模块 · 预测引擎（纯函数，无 Vue / 无 store 依赖）
 *
 * 三类风险（取最强一档）：
 *  - overdue（逾期）：截止日早于今天；
 *  - due-soon（临期）：今天 / 明天到期；
 *  - stalled（停滞）：仍处未推进状态 + 超过阈值天数无变动 + 够得上「该推进」的分量。
 *
 * 刻意是启发式而非 LLM：首页风险标注要**即时、确定、可解释**，不能每次进页面都跑一次模型
 * （既有延迟又有成本，还不稳定）。LLM 留给「晨报叙述」「交给小吴深聊」等需要自然语言的场景。
 *
 * 时区处理沿用项目约定：截止日期按**本地零点**比较，规避 `new Date('yyyy-MM-dd')` 被解析为
 * UTC 零点导致的「今天到期」误判为「已逾期」。
 */
import type { WorkItem, Prediction, RiskLevel, InsightSummary } from './types'

/** 一天的毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000

/** 停滞阈值：未变动超过这么多天，且仍处未推进状态，才视为「停滞」 */
const STALL_DAYS = 5

/** 状态码 → 中文（why / action 文案用；与 dashboard-context 的映射保持一致口径） */
const STATUS_ZH: Record<string, string> = {
  wait: '未开始',
  doing: '进行中',
  done: '已完成',
  pause: '已暂停',
  cancel: '已取消',
  closed: '已关闭',
  active: '待解决',
  resolved: '已解决',
}

// ============ 时间工具 ============

/** yyyy-MM-dd（取前 10 位）→ 本地零点 Date；非法 / 0000-00-00 返回 null */
function deadlineToDate(d?: string): Date | null {
  if (!d) return null
  const day = d.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const dt = new Date(`${day}T00:00:00`)
  return isNaN(dt.getTime()) ? null : dt
}

/** 本地零点 */
function todayMidnight(): Date {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t
}

/** 截止日距今天的整天天数：<0 已逾期，0 今天，1 明天 …；无有效截止日返回 null */
export function deadlineDays(d?: string): number | null {
  const dl = deadlineToDate(d)
  if (!dl) return null
  return Math.round((dl.getTime() - todayMidnight().getTime()) / DAY_MS)
}

/**
 * 把禅道的时间字符串解析为 ms 时间戳。
 * 禅道常见 `"2024-06-01 12:00:00"`（空格分隔）或 ISO；`0000-00-00…` 视为无。
 * 失败返回 null（不抛错，调用方据此回退到 openedAt）。
 */
export function parseZentaoTime(s?: string): number | null {
  if (!s || /^0000-00-00/.test(s)) return null
  // 空格分隔的日期时间补成 T，走 ISO 解析更稳（多数引擎对纯空格分隔解析不一致）
  const iso = s.includes('T') ? s : s.replace(' ', 'T')
  const t = new Date(iso).getTime()
  return isNaN(t) ? null : t
}

/** 工作项「最近活动」时间：优先 lastEditedAt，回退 openedAt，都没有返回 null */
function lastActivity(it: WorkItem): number | null {
  return it.lastEditedAt ?? it.openedAt ?? null
}

/** 是否「未推进」状态——停滞判定的前提（已完成 / 已关闭不算停滞） */
function isStallableStatus(it: WorkItem): boolean {
  if (it.kind === 'local') return true // 本地待办进清单本就是未完成
  if (it.kind === 'task') return it.status === 'wait' || it.status === 'pause'
  return it.status === 'active' // bug
}

/**
 * 停滞是否「够分量」值得提示——避免低优积压噪音。
 * Bug：active 即值得提示（任何待解决 Bug 拖着都不好）；任务 / 本地：要求优先级 ≤ 3。
 */
function isStallWorthNoting(it: WorkItem): boolean {
  if (it.kind === 'bug') return true
  return it.pri <= 3
}

/**
 * 计算单条工作项的风险预测（取最强一档）。
 * @returns 命中则返回 Prediction；无风险返回 null
 */
export function predictItem(it: WorkItem): Prediction | null {
  const days = deadlineDays(it.deadline)

  // 1) 逾期：截止日早于今天（最强信号）
  if (days != null && days < 0) {
    const n = -days
    const priHint = it.pri <= 2 ? '，且优先级高' : ''
    return {
      level: 'overdue',
      label: `逾期 ${n} 天`,
      why: `截止 ${it.deadline!.slice(0, 10)}，已过 ${n} 天${priHint}。`,
      action: `「${it.title}」已逾期 ${n} 天，帮我评估是该今天收尾、还是先同步一下风险。`,
    }
  }

  // 2) 临期：今天 / 明天到期
  if (days != null && days <= 1) {
    const dl = days === 0 ? '今天' : '明天'
    const st = STATUS_ZH[it.status]
    return {
      level: 'due-soon',
      label: `${dl}到期`,
      why: st ? `${dl}到期，仍处「${st}」。` : `${dl}到期。`,
      action: `「${it.title}」${dl}到期，帮我确认今天能不能收、还差什么。`,
    }
  }

  // 3) 停滞：未推进 + 长时间无变动 + 够分量
  if (isStallableStatus(it) && isStallWorthNoting(it)) {
    const la = lastActivity(it)
    if (la != null) {
      const stallDays = Math.floor((Date.now() - la) / DAY_MS)
      if (stallDays >= STALL_DAYS) {
        const st = STATUS_ZH[it.status]
        return {
          level: 'stalled',
          label: `停滞 ${stallDays} 天`,
          why: st ? `${st}已 ${stallDays} 天未变动。` : `已 ${stallDays} 天未变动。`,
          action: `「${it.title}」停滞 ${stallDays} 天了，帮我看看是不是卡住了、下一步该怎么推。`,
        }
      }
    }
  }

  return null
}

/**
 * 汇总一批工作项的预测，生成首页「小吴已就绪」状态条所需的数据。
 * 每项只计其最强一档（与 predictItem 一致），故 overdue + dueSoon + stalled 三者互斥求和 = total。
 */
export function summarize(items: WorkItem[]): InsightSummary {
  let overdue = 0
  let dueSoon = 0
  let stalled = 0
  for (const it of items) {
    const p = predictItem(it)
    if (!p) continue
    if (p.level === 'overdue') overdue++
    else if (p.level === 'due-soon') dueSoon++
    else stalled++
  }

  const total = overdue + dueSoon + stalled
  const top: RiskLevel | null = overdue > 0 ? 'overdue' : dueSoon > 0 ? 'due-soon' : stalled > 0 ? 'stalled' : null

  let headline = ''
  if (top === 'overdue') headline = overdue === 1 ? '有 1 项已逾期，建议先收尾' : `有 ${overdue} 项已逾期，建议先收尾`
  else if (top === 'due-soon') headline = dueSoon === 1 ? '有 1 项今明两天到期' : `有 ${dueSoon} 项今明两天到期`
  else if (top === 'stalled') headline = stalled === 1 ? '有 1 项停滞多日，该推进了' : `有 ${stalled} 项停滞多日，该推进了`

  return { overdue, dueSoon, stalled, total, top, headline }
}
