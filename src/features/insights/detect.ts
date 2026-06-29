/**
 * 洞察模块 · 深度洞察检测（纯函数，无 Vue / 无 store / 无 LLM 依赖）
 *
 * 在预测（逾期/临期/停滞）之上再做一层「模式识别」——找出值得小吴**主动开口**说的：
 *  - root-cause：同一需求线既有任务又有 Bug，疑同根因（最有价值的「连」）；
 *  - bug-concentration：待修 Bug 集中在某条线；
 *  - overdue-cluster：多项逾期（可能集中在某条线）；
 *  - overload：今天到期 + 逾期数量偏多，负载重；
 *  - stalled-key：高优（pri ≤ 2）却停滞。
 *
 * 确定性、即时：检测命中才有洞察，未命中不渲染（克制红线），也不产生任何 LLM 调用。
 * LLM 只在「已命中 + 已配置」时把 detail 加工成自然提醒（见 chat/inbox-insight.ts）。
 */
import type { WorkItem, Prediction, Insight, InsightKind } from './types'

/** 仍未完成 / 未关闭的状态（检测只看「还在进行中」的项） */
const ACTIVE_STATUSES = new Set(['wait', 'doing', 'pause', 'active'])

/** 洞察优先级（小在前）；detectInsights 据此排序后截断到 2 条 */
const KIND_RANK: Record<InsightKind, number> = {
  'root-cause': 0,
  'bug-concentration': 1,
  'overdue-cluster': 2,
  overload: 3,
  'stalled-key': 4,
}

/** 取一个 Map 中 value 最大的 key（用于「最集中的那条线」） */
function topEntry(m: Map<string, number>): [string, number] | null {
  let best: [string, number] | null = null
  for (const e of m) if (!best || e[1] > best[1]) best = e
  return best
}

/**
 * 扫描工作项，返回值得主动一说的洞察（按优先级排序，至多 2 条）。
 * @param items 归一化工作项
 * @param predictions 预测表（与 useInboxInsights 的 predictions 同源，用于判定逾期/临期/停滞）
 */
export function detectInsights(items: WorkItem[], predictions: Map<string, Prediction>): Insight[] {
  // 太少不值得洞察（避免噪音）
  if (items.length < 3) return []

  const findings: Insight[] = []
  const riskOf = (it: WorkItem) => predictions.get(`${it.kind}-${it.id}`)

  // —— 按线索分组（仅未完成、有线索的项）——
  const byThread = new Map<string, WorkItem[]>()
  for (const it of items) {
    if (!it.thread || !ACTIVE_STATUSES.has(it.status)) continue
    const arr = byThread.get(it.thread) ?? []
    arr.push(it)
    byThread.set(it.thread, arr)
  }

  // 1) 同一需求线既有任务又有 Bug —— 疑同根因
  for (const [thread, arr] of byThread) {
    const hasTask = arr.some((i) => i.kind === 'task')
    const hasBug = arr.some((i) => i.kind === 'bug')
    if (hasTask && hasBug && arr.length >= 2) {
      findings.push({
        kind: 'root-cause',
        title: `「${thread}」任务与 Bug 并存，疑同根因`,
        detail: arr.map((i) => `${i.kind === 'bug' ? 'Bug' : '任务'}：${i.title}`).join('；'),
        itemKeys: arr.map((i) => `${i.kind}-${i.id}`),
        action: `「${thread}」这条线同时挂着开发任务和 Bug，帮我判断是不是同一处改动引入的、该从哪条入手。`,
      })
      break // 一条 root-cause 足够
    }
  }

  // 2) Bug 集中在一条线
  const activeBugs = items.filter((i) => i.kind === 'bug' && i.status === 'active')
  if (activeBugs.length >= 3) {
    const bugThreads = new Map<string, number>()
    for (const b of activeBugs) {
      if (!b.thread) continue
      bugThreads.set(b.thread, (bugThreads.get(b.thread) ?? 0) + 1)
    }
    const top = topEntry(bugThreads)
    if (top && top[1] >= 3) {
      findings.push({
        kind: 'bug-concentration',
        title: `待修 Bug 集中在「${top[0]}」（${top[1]} 个）`,
        detail: `共 ${activeBugs.length} 个待修 Bug，其中 ${top[1]} 个属于「${top[0]}」。`,
        itemKeys: activeBugs.filter((b) => b.thread === top[0]).map((b) => `bug-${b.id}`),
        action: `待修 Bug 集中在「${top[0]}」，帮我归因是不是这个模块出了共性问题。`,
      })
    }
  }

  // 3) 多项逾期（可能集中在一条线）
  const overdueItems = items.filter((i) => riskOf(i)?.level === 'overdue')
  if (overdueItems.length >= 2) {
    const threads = new Map<string, number>()
    for (const o of overdueItems) if (o.thread) threads.set(o.thread, (threads.get(o.thread) ?? 0) + 1)
    const top = topEntry(threads)
    const concentration = top && top[1] >= 2 ? `，集中在「${top[0]}」` : ''
    findings.push({
      kind: 'overdue-cluster',
      title: `${overdueItems.length} 项逾期${concentration}`,
      detail: overdueItems.map((i) => i.title).join('；'),
      itemKeys: overdueItems.map((i) => `${i.kind}-${i.id}`),
      action: `我有 ${overdueItems.length} 项逾期${concentration}，帮我排个收尾顺序，先点名最该收的。`,
    })
  }

  // 4) 今天负载重（到期 + 逾期 ≥ 4）
  const dueSoon = items.filter((i) => riskOf(i)?.level === 'due-soon')
  if (overdueItems.length + dueSoon.length >= 4) {
    findings.push({
      kind: 'overload',
      title: `今天 ${dueSoon.length} 项到期、${overdueItems.length} 项逾期，负载偏重`,
      detail: '',
      itemKeys: [...overdueItems, ...dueSoon].map((i) => `${i.kind}-${i.id}`),
      action: `今天到期 ${dueSoon.length}、逾期 ${overdueItems.length}，帮我挑出可以推迟的低优项，腾出精力。`,
    })
  }

  // 5) 高优却停滞
  const stalledHighPri = items.find((i) => riskOf(i)?.level === 'stalled' && i.pri <= 2)
  if (stalledHighPri) {
    const p = riskOf(stalledHighPri)!
    findings.push({
      kind: 'stalled-key',
      title: `高优「${stalledHighPri.title}」${p.label}`,
      detail: p.why,
      itemKeys: [`${stalledHighPri.kind}-${stalledHighPri.id}`],
      action: `「${stalledHighPri.title}」是高优却${p.label}，帮我看看卡在哪、怎么破。`,
    })
  }

  return findings.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]).slice(0, 2)
}
