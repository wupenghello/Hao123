/**
 * 洞察模块 · 状态层 composable
 *
 * 把三类 store（禅道任务 / 禅道 Bug / 本地待办）的「指派给我 / 未完成」项归一化为
 * {@link WorkItem}，跑预测引擎，对外暴露：
 *  - `predictions`：以 `${kind}-${id}` 为 key 的预测表（与 UnifiedInbox 的行 key 口径一致，
 *    供行内查表渲染风险徽标）；
 *  - `summary`：列表级汇总（驱动首页「小吴已就绪」状态条）。
 *
 * 与 dashboard-context 的区别：dashboard-context 是「喂给 LLM 的中文快照」（文本），
 * 这里是「喂给 UI 的结构化预测」（对象），互不替代。
 */
import { computed } from 'vue'
import { useTaskStore, useBugStore } from '@/features/zentao'
import { useLocalTaskStore } from '@/features/local-tasks'
import type { ZentaoTask, ZentaoBug } from '@/features/zentao'
import type { LocalTask } from '@/features/local-tasks'
import type { WorkItem, Prediction, InsightSummary, Insight } from './types'
import { parseZentaoTime, predictItem, summarize } from './predict'
import { detectInsights } from './detect'

/** 把禅道的 pri / severity（string | number）规整为 1~4 数字；空 / 0 / 非法回退 def */
function toPri(v: string | number | undefined, def = 4): number {
  const n = Number(v)
  return n && !Number.isNaN(n) ? n : def
}

/** 取需求线标签：优先关联需求，其次项目 / 产品 / 迭代；都无则空串（与 UnifiedInbox 的 threadOf 同口径） */
function threadLabel(...parts: Array<string | undefined>): string {
  for (const p of parts) {
    const s = (p || '').trim()
    if (s) return s
  }
  return ''
}

function fromTask(t: ZentaoTask): WorkItem {
  return {
    id: String(t.id),
    kind: 'task',
    title: t.name,
    pri: toPri(t.pri),
    status: t.status,
    deadline: t.deadline,
    openedAt: parseZentaoTime(t.openedDate) ?? undefined,
    lastEditedAt: parseZentaoTime(t.lastEditedDate) ?? undefined,
    thread: threadLabel(t.storyTitle, t.projectName, t.executionName) || undefined,
  }
}

function fromBug(b: ZentaoBug): WorkItem {
  return {
    id: String(b.id),
    kind: 'bug',
    title: b.title,
    pri: toPri(b.pri),
    status: b.status,
    deadline: b.deadline,
    openedAt: parseZentaoTime(b.openedDate) ?? undefined,
    severity: toPri(b.severity),
    thread: threadLabel(b.storyTitle, b.projectName, b.productName) || undefined,
  }
}

function fromLocal(t: LocalTask): WorkItem {
  return {
    id: String(t.id),
    kind: 'local',
    title: t.title,
    pri: t.pri,
    status: t.done ? 'done' : 'wait',
    deadline: t.deadline,
    openedAt: t.createdAt,
  }
}

/**
 * 首页收件箱洞察。
 * 在 UnifiedInbox（及未来其它首页组件）setup 中调用一次，拿到响应式的预测表与汇总。
 */
export function useInboxInsights() {
  const taskStore = useTaskStore()
  const bugStore = useBugStore()
  const localStore = useLocalTaskStore()

  /** 三类来源合并的归一化工作项（与 UnifiedInbox 的清单同源） */
  const workItems = computed<WorkItem[]>(() => [
    ...taskStore.assigned.map(fromTask),
    ...bugStore.assigned.map(fromBug),
    ...localStore.open.map(fromLocal),
  ])

  /** key = `${kind}-${id}`，与 UnifiedInbox 的行 key 口径一致；仅含有风险的工作项 */
  const predictions = computed<Map<string, Prediction>>(() => {
    // 每轮新建 Map：computed 靠返回值引用变化驱动下游，复用同一实例会让模板不更新
    const m = new Map<string, Prediction>()
    for (const w of workItems.value) {
      const p = predictItem(w)
      if (p) m.set(`${w.kind}-${w.id}`, p)
    }
    return m
  })

  const summary = computed<InsightSummary>(() => summarize(workItems.value))

  /** 深度洞察（同根因 / Bug 集中 / 多项逾期 / 负载 / 高优停滞），驱动「小吴的洞察」卡 */
  const insights = computed<Insight[]>(() => detectInsights(workItems.value, predictions.value))

  return { predictions, summary, insights }
}
