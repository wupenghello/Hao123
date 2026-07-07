<script setup lang="ts">
/**
 * 首页统一收件箱：把「指派给我的禅道任务 / Bug」与「本地待办」整合进**一个清单**。
 *
 * 取代原来分开的 ZentaoInbox + LocalTaskPanel：不再两块面板并排，而是一条按
 * 「紧急 → 优先级 → 截止日期」排序的统一待办流，用类型徽标（任务 / Bug / 本地）区分来源。
 *   - 禅道项：只读，点击行 → 各自详情弹窗（TaskDetailModal / BugDetailModal）。
 *   - 本地项：可交互——圆点勾选完成、点标题编辑、悬停出删除（二次确认），支持图片/文件附件。
 *   - 新建按钮：创建本地待办（禅道任务无法在此新建，禅道是只读来源）。
 *
 * 数据来源：禅道（task/bug store 的 assigned 维度，配置后才加载）+ 本地（localStorage，始终可用）。
 * 未配置禅道时，本地待办即清单主角；两者都空时给清闲空态 + 创建入口。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import StateNotice from '@/components/common/StateNotice.vue'
import { useTaskStore, useBugStore, TaskDetailModal, BugDetailModal } from '@/features/zentao'
import {
  priorityBadge as ztPri,
  hasDeadline as ztHasDeadline,
  isOverdue as ztIsOverdue,
  isUrgentTask,
  isUrgentBug,
  taskStatusBadge,
  bugStatusBadge,
  severityBadge,
} from '@/features/zentao'
import type { ZentaoTask, ZentaoBug } from '@/features/zentao'
import { useLocalTaskStore, priBadge, deadlineLabel, isUrgentLocalTask } from '@/features/local-tasks'
import type { LocalTask, LocalTaskFormPayload } from '@/features/local-tasks'
import LocalTaskFormModal from '@/features/local-tasks/components/LocalTaskFormModal.vue'
import { defineAsyncComponent } from 'vue'
// 星图走异步加载，避免 Three.js 进入首屏 bundle（用户切到「星图」时才下载）
const InboxConstellation = defineAsyncComponent(() => import('@/components/inbox/InboxConstellation.vue'))
import { useInboxInsights } from '@/features/insights'
import type { Prediction } from '@/features/insights'
import type { Insight } from '@/features/insights'
import {
  buildInboxItemActionFlowPrompt,
  buildInboxPlanActionFlowPrompt,
  buildInsightActionFlowPrompt,
  gitEnabled,
  useChatStore,
  useInboxInsight,
} from '@/features/chat'
import type { ActionFlowItem } from '@/features/chat'
import { useWeatherStore } from '@/features/weather'
import { useFeedback } from '@/features/feedback'
import IconCheckboxOutline from '~icons/mdi/checkbox-marked-circle-outline'
import IconBug from '~icons/mdi/bug-outline'
import IconCircle from '~icons/mdi/circle-outline'
import IconCheck from '~icons/mdi/check'
import IconClipboardCheck from '~icons/mdi/clipboard-check-outline'
import IconPlus from '~icons/mdi/plus'
import IconPencil from '~icons/mdi/pencil-outline'
import IconTrash from '~icons/mdi/trash-can-outline'
import IconClip from '~icons/mdi/paperclip'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCalendarClock from '~icons/mdi/calendar-clock-outline'
import IconPause from '~icons/mdi/pause-circle-outline'
import IconSpark from '~icons/mdi/star-four-points'
import IconRefresh from '~icons/mdi/refresh'
import IconInfo from '~icons/mdi/information-outline'

const taskStore = useTaskStore()
const bugStore = useBugStore()
const localStore = useLocalTaskStore()
const weather = useWeatherStore()
const feedback = useFeedback()
/** 小吴的「风险预测」——对收件箱工作项做启发式预测（逾期 / 临期 / 停滞）+ 汇总成状态条 */
const { predictions, summary } = useInboxInsights()
/** 小吴的「洞察」——检测到的模式 + LLM 解读（驱动「小吴的洞察」卡） */
const { insights, content: insightContent, generating: insightGenerating, refresh: refreshInsight } = useInboxInsight()
const chat = useChatStore()

type InboxView = 'list' | 'orbit'
const activeView = ref<InboxView>('list')
const viewTabs: { key: InboxView; label: string; hint: string }[] = [
  { key: 'list', label: '清单', hint: '按紧急度 / 优先级 / 截止日期合并排序的统一清单' },
  { key: 'orbit', label: '星图', hint: '查看今日工作场的亮度与焦点，点亮点进入详情' },
]

// ============ 统一清单（禅道任务 + 禅道 Bug + 本地待办，合并排序）============
type InboxKind = 'task' | 'bug' | 'local'
interface InboxItem {
  key: string
  kind: InboxKind
  ref: ZentaoTask | ZentaoBug | LocalTask
  /** 小吴对该项的风险预测（无风险则 null）——驱动行内风险徽标 + 「交给小吴」 */
  risk: Prediction | null
}

function mkItem(kind: InboxKind, ref: InboxItem['ref']): Omit<InboxItem, 'risk'> {
  const id = (ref as { id: string | number }).id
  return { key: `${kind}-${id}`, kind, ref }
}

/** 排序键：[紧急(0在前) , 优先级(小在前) , 截止日期(早在前, 无则排末)]；稳定排序保留插入顺序 */
function sortKey(it: Omit<InboxItem, 'risk'>): [number, number, string] {
  const urgent =
    it.kind === 'task'
      ? isUrgentTask(it.ref as ZentaoTask)
      : it.kind === 'bug'
        ? isUrgentBug(it.ref as ZentaoBug)
        : isUrgentLocalTask(it.ref as LocalTask)
  const pri = it.kind === 'local' ? (it.ref as LocalTask).pri : Number((it.ref as { pri?: string | number }).pri) || 4
  const dl = (it.ref as { deadline?: string }).deadline
  const dlSort = !dl || /^0000/.test(dl) ? '9999-99-99' : String(dl).slice(0, 10)
  return [urgent ? 0 : 1, pri, dlSort]
}

const items = computed<InboxItem[]>(() => {
  const list: Omit<InboxItem, 'risk'>[] = [
    ...taskStore.assigned.map((t) => mkItem('task', t)),
    ...bugStore.assigned.map((b) => mkItem('bug', b)),
    ...localStore.open.map((t) => mkItem('local', t)),
  ]
  return list
    .sort((a, b) => {
      const ka = sortKey(a)
      const kb = sortKey(b)
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2])
    })
    .map((it) => ({ ...it, risk: predictions.value.get(it.key) ?? null }))
})

const zentaoConfigured = computed(() => taskStore.configured || bugStore.configured)
const loading = computed(
  () =>
    zentaoConfigured.value &&
    (taskStore.assignedLoading || bugStore.assignedLoading) &&
    items.value.length === 0,
)
/** 禅道正在登录中（加载态文案区分，复刻自旧 ZentaoInbox 的登录提示） */
const zentaoLoggingIn = computed(() => taskStore.loggingIn || bugStore.loggingIn)
/** 禅道加载出错（任一模块失败即视为出错，本地待办不受影响） */
const hasError = computed(() => !!(taskStore.assignedError || bugStore.assignedError))
/** 统一错误文案（任务优先于 Bug） */
const errorMessage = computed(() => taskStore.assignedError || bugStore.assignedError)
/** 重试：重新拉取已配置模块的指派项 */
function retryZentao() {
  if (taskStore.configured) taskStore.loadAssigned()
  if (bugStore.configured) bugStore.loadAssigned()
}
const urgentCount = computed(
  () =>
    taskStore.assigned.filter((t) => isUrgentTask(t)).length +
    bugStore.assigned.filter((b) => isUrgentBug(b)).length +
    localStore.open.filter((t) => isUrgentLocalTask(t)).length,
)
const total = computed(() => items.value.length)
const isEmpty = computed(() => !loading.value && total.value === 0 && localStore.doneCount === 0)
const inboxSubtitle = computed(() => {
  if (loading.value) return zentaoLoggingIn.value ? '正在建立禅道会话' : '正在同步工作项'
  if (hasError.value && total.value === 0) return '禅道连接异常，等待恢复'
  if (total.value > 0) {
    const parts = [
      taskStore.assigned.length ? `${taskStore.assigned.length} 任务` : '',
      bugStore.assigned.length ? `${bugStore.assigned.length} Bug` : '',
      localStore.openCount ? `${localStore.openCount} 本地` : '',
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : '清单已就绪'
  }
  return '任务、Bug 与本地待办汇入一处'
})

// ============ 信任面板：把「为什么这么排」产品化，而不是藏在 tooltip 里 ============
const trustOpen = ref(false)
const trustUpdatedAt = ref(Date.now())

watch(
  [
    total,
    urgentCount,
    () => summary.value.overdue,
    () => summary.value.dueSoon,
    () => summary.value.stalled,
    () => taskStore.assignedLoading,
    () => bugStore.assignedLoading,
    () => taskStore.assignedError,
    () => bugStore.assignedError,
    () => localStore.openCount,
    () => weather.now?.obsTime,
    () => weather.error,
  ],
  () => {
    trustUpdatedAt.value = Date.now()
  },
)

function trustTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

type TrustTone = 'ok' | 'warn' | 'error' | 'idle'
interface TrustSource {
  label: string
  status: string
  tone: TrustTone
  detail: string
  unavailable?: boolean
}

const trustSources = computed<TrustSource[]>(() => {
  const zentaoLoading = taskStore.assignedLoading || bugStore.assignedLoading
  const zentaoError = taskStore.assignedError || bugStore.assignedError
  const zentao: TrustSource = !zentaoConfigured.value
    ? {
        label: '禅道',
        status: '未配置',
        tone: 'warn',
        detail: '任务 / Bug 不参与当前收件箱排序。',
        unavailable: true,
      }
    : zentaoLoading
      ? {
          label: '禅道',
          status: '同步中',
          tone: 'idle',
          detail: '正在拉取指派给我的任务和 Bug。',
        }
      : zentaoError
        ? {
            label: '禅道',
            status: '异常',
            tone: 'error',
            detail: zentaoError,
            unavailable: true,
          }
        : {
            label: '禅道',
            status: '已接入',
            tone: 'ok',
            detail: `${taskStore.assignedCount} 个任务 · ${bugStore.assignedCount} 个 Bug 参与排序。`,
          }

  const local: TrustSource = {
    label: '本地待办',
    status: '已接入',
    tone: 'ok',
    detail: `${localStore.openCount} 个未完成 · ${localStore.doneCount} 个已完成；未完成项参与排序。`,
  }

  const weatherSource: TrustSource = weather.loading || weather.locating
    ? {
        label: '天气',
        status: '同步中',
        tone: 'idle',
        detail: '天气用于晨报和节奏建议，不改变收件箱风险排序。',
      }
    : weather.now
      ? {
          label: '天气',
          status: '已接入',
          tone: 'ok',
          detail: `${weather.cityName || '当前城市'} · ${weather.now.text} ${weather.now.temp}°C；用于晨报和节奏建议。`,
        }
      : {
          label: '天气',
          status: weather.error ? '异常' : '未就绪',
          tone: weather.error ? 'error' : 'warn',
          detail: weather.error || '天气暂不可用；不影响收件箱排序。',
          unavailable: true,
        }

  const git: TrustSource = gitEnabled
    ? {
        label: 'Git',
        status: '可用',
        tone: 'ok',
        detail: '用于仓库健康、diff 解释和 Git 助手能力；不改变收件箱排序。',
      }
    : {
        label: 'Git',
        status: '未启用',
        tone: 'warn',
        detail: '需要 dev 环境并配置 VITE_WBSCF_WEB_ROOT；当前不参与 AI 上下文。',
        unavailable: true,
      }

  return [zentao, local, weatherSource, git]
})

const unavailableSources = computed(() => trustSources.value.filter((s) => s.unavailable))

/** 行点击：禅道项打开详情；本地项不在整行绑定点击（标题/圆点各有自己的交互） */
function onRowClick(it: InboxItem) {
  if (it.kind === 'task') taskStore.openDetail((it.ref as ZentaoTask).id)
  else if (it.kind === 'bug') bugStore.openDetail((it.ref as ZentaoBug).id)
}

function isUrgent(it: InboxItem): boolean {
  return it.kind === 'task'
    ? isUrgentTask(it.ref as ZentaoTask)
    : it.kind === 'bug'
      ? isUrgentBug(it.ref as ZentaoBug)
      : isUrgentLocalTask(it.ref as LocalTask)
}

// ============ 小吴：AI 主动入口 → 行动流接手（带结构化上下文）============
function cleanDeadline(deadline?: string): string | undefined {
  if (!deadline || /^0000/.test(deadline)) return undefined
  return String(deadline).slice(0, 10)
}

function actionItem(it: InboxItem): ActionFlowItem {
  const id = String((it.ref as { id: string | number }).id)
  const thread = threadOf(it)?.label
  if (it.kind === 'task') {
    const t = it.ref as ZentaoTask
    return {
      key: it.key,
      kind: '禅道任务',
      id,
      title: t.name,
      source: '禅道',
      priority: ztPri(t.pri)?.label,
      status: taskStatusBadge(t.status).label,
      deadline: cleanDeadline(t.deadline),
      thread,
      meta: [t.projectName && `项目 ${t.projectName}`, t.executionName && `执行 ${t.executionName}`, t.assignedTo && `指派给 ${t.assignedTo}`]
        .filter(Boolean)
        .join('；') || undefined,
      riskLabel: it.risk?.label,
      riskWhy: it.risk?.why,
    }
  }
  if (it.kind === 'bug') {
    const b = it.ref as ZentaoBug
    return {
      key: it.key,
      kind: '禅道 Bug',
      id,
      title: b.title,
      source: '禅道',
      priority: severityBadge(b.severity)?.label || ztPri(b.pri)?.label,
      status: bugStatusBadge(b.status).label,
      deadline: cleanDeadline(b.deadline),
      thread,
      meta: [b.productName && `产品 ${b.productName}`, b.projectName && `项目 ${b.projectName}`, b.type && `类型 ${b.type}`]
        .filter(Boolean)
        .join('；') || undefined,
      riskLabel: it.risk?.label,
      riskWhy: it.risk?.why,
    }
  }
  const t = it.ref as LocalTask
  return {
    key: it.key,
    kind: '本地待办',
    id,
    title: t.title,
    source: '本地',
    priority: priBadge(t.pri).label,
    status: t.done ? '已完成' : '未完成',
    deadline: cleanDeadline(t.deadline),
    meta: [t.note && `备注 ${t.note}`, t.attachments?.length && `附件 ${t.attachments.length} 个`]
      .filter(Boolean)
      .join('；') || undefined,
    riskLabel: it.risk?.label,
    riskWhy: it.risk?.why,
  }
}

/** 行内风险徽标点击：带上下文把这项交给小吴跟进（LLM 未配置则不响应，徽标仅作信息提示） */
function askXiaowu(it: InboxItem) {
  if (!chat.configured || !it.risk) return
  chat.show()
  void chat.send(buildInboxItemActionFlowPrompt(actionItem(it)))
}
/** 状态条「让小吴排一下」：把今天的风险概况交给小吴排出处理顺序与节奏 */
function askXiaowuToPlan() {
  if (!chat.configured) return
  const s = summary.value
  chat.show()
  void chat.send(
    buildInboxPlanActionFlowPrompt(
      {
        total: total.value,
        urgentCount: urgentCount.value,
        overdue: s.overdue,
        dueSoon: s.dueSoon,
        stalled: s.stalled,
        headline: s.headline,
      },
      items.value.slice(0, 8).map(actionItem),
    ),
  )
}
/** 「小吴的洞察」卡 → 让小吴就这条洞察展开分析（带上下文） */
function askXiaowuInsight(ins?: Insight) {
  if (!chat.configured || !ins) return
  chat.show()
  const related = items.value.filter((it) => ins.itemKeys.includes(it.key)).slice(0, 8).map(actionItem)
  void chat.send(buildInsightActionFlowPrompt(ins, related))
}

// ============ 需求线分组：把同属一条需求线 / 项目的禅道项自动连起来 ============
interface ItemGroup {
  key: string
  label: string
  /** 真正的簇（同一线索 ≥2 项）；单条不成线，并入「其他」 */
  isCluster: boolean
  items: InboxItem[]
}

/**
 * 推断一条工作项所属的「需求线」：优先关联需求（storyTitle），其次项目 / 产品 / 迭代名。
 * 本地待办无线索（手动创建、与禅道无关）。
 */
function threadOf(it: InboxItem): { key: string; label: string } | null {
  if (it.kind === 'local') return null
  const r = it.ref as ZentaoTask | ZentaoBug
  const label =
    (r as ZentaoTask).storyTitle ||
    r.projectName ||
    (it.kind === 'bug' ? (r as ZentaoBug).productName : (r as ZentaoTask).executionName)
  const s = (label || '').trim()
  return s ? { key: s, label: s } : null
}

/**
 * 按需求线分组：同一线索 ≥2 项才成「簇」。
 * 组间按各自最强项的紧急度排序（沿用 items 的紧急度序），组内保持紧急度序——
 * 既「连成线」又不打乱「紧急优先」的主排序。
 */
const groups = computed<ItemGroup[]>(() => {
  const sorted = items.value
  const idx = new Map<string, number>()
  sorted.forEach((it, i) => idx.set(it.key, i))

  const byThread = new Map<string, InboxItem[]>()
  const others: InboxItem[] = []
  for (const it of sorted) {
    const th = threadOf(it)
    if (th) {
      const arr = byThread.get(th.key) ?? []
      arr.push(it)
      byThread.set(th.key, arr)
    } else {
      others.push(it)
    }
  }

  const clusters: ItemGroup[] = []
  for (const [label, arr] of byThread) {
    if (arr.length >= 2) clusters.push({ key: `thread:${label}`, label, isCluster: true, items: arr })
    else others.push(...arr)
  }

  const all: ItemGroup[] = [...clusters]
  if (others.length) all.push({ key: 'other', label: '', isCluster: false, items: others })
  // 组间排序：以组内最强项（在 items 中最靠前）的紧急度为准
  const rank = (g: ItemGroup) => Math.min(...g.items.map((it) => idx.get(it.key) ?? Number.POSITIVE_INFINITY))
  return all.sort((a, b) => rank(a) - rank(b))
})

/** 折叠的簇 key 集合（默认全展开） */
const collapsed = ref<Set<string>>(new Set())
function toggleGroup(key: string) {
  const next = new Set(collapsed.value)
  next.has(key) ? next.delete(key) : next.add(key)
  collapsed.value = next
}
function groupOpen(key: string) {
  return !collapsed.value.has(key)
}

/** 需求线配色：按线索名 hash 取一个稳定颜色，让同一线一眼可辨 */
const THREAD_COLORS = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#2dd4bf', '#fb7185']
function threadColor(label: string): string {
  let h = 0
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return THREAD_COLORS[h % THREAD_COLORS.length]
}

// ============ 星图视图：Three.js 任务星域（真实工作项 → 3D 节点）============
function itemTitle(it: InboxItem): string {
  if (it.kind === 'task') return (it.ref as ZentaoTask).name
  if (it.kind === 'bug') return (it.ref as ZentaoBug).title
  return (it.ref as LocalTask).title
}
function itemKindLabel(kind: InboxKind): string {
  return kind === 'task' ? '主线' : kind === 'bug' ? '异常' : '标记'
}
function itemMeta(it: InboxItem): string {
  if (it.kind === 'task') {
    const t = it.ref as ZentaoTask
    return [ztPri(t.pri)?.label, taskStatusBadge(t.status).label, ztHasDeadline(t.deadline) ? t.deadline : '无截止'].filter(Boolean).join(' · ')
  }
  if (it.kind === 'bug') {
    const b = it.ref as ZentaoBug
    return [severityBadge(b.severity)?.label, bugStatusBadge(b.status).label].filter(Boolean).join(' · ')
  }
  const t = it.ref as LocalTask
  return [priBadge(t.pri).label, deadlineLabel(t.deadline) || '无截止'].filter(Boolean).join(' · ')
}
const orbitItems = computed(() =>
  items.value.slice(0, 18).map((it) => {
    const riskLevel = (it.risk?.level ?? (isUrgent(it) ? 'overdue' : 'calm')) as
      | 'overdue'
      | 'due-soon'
      | 'stalled'
      | 'calm'
    return {
      key: it.key,
      title: itemTitle(it),
      kind: it.kind,
      kindLabel: itemKindLabel(it.kind),
      riskLevel,
      riskLabel: it.risk?.label ?? (isUrgent(it) ? '高压' : '平稳'),
      riskWhy: it.risk?.why ?? '',
      meta: itemMeta(it),
      urgent: isUrgent(it),
    }
  }),
)
const orbitRemainder = computed(() => Math.max(0, items.value.length - orbitItems.value.length))
function openOrbitItem(key: string) {
  const it = items.value.find((item) => item.key === key)
  if (!it) return
  if (it.kind === 'local') openEdit(it.ref as LocalTask)
  else onRowClick(it)
}

// ============ 本地待办：新建 / 编辑（含附件）============
const formOpen = ref(false)
const editing = ref<LocalTask | null>(null)
function openCreate() {
  editing.value = null
  formOpen.value = true
}
function openEdit(task: LocalTask) {
  editing.value = task
  formOpen.value = true
}
async function onSubmit(payload: LocalTaskFormPayload) {
  const baseInput = { title: payload.title, note: payload.note, pri: payload.pri, deadline: payload.deadline }
  const targetId = editing.value?.id
  if (targetId) {
    for (const attId of payload.removeAttachmentIds) await localStore.removeAttachment(targetId, attId)
    localStore.update(targetId, baseInput)
  } else {
    const created = localStore.add(baseInput)
    if (!created) return
    for (const file of payload.newFiles) await localStore.addAttachment(created.id, file)
    return
  }
  for (const file of payload.newFiles) await localStore.addAttachment(targetId, file)
}

// ============ 本地待办：删除（轻量二次确认）============
const pendingDelete = ref<string | null>(null)
let deleteTimer: ReturnType<typeof setTimeout> | null = null
function onDelete(id: string) {
  if (pendingDelete.value === id) {
    localStore.remove(id)
    pendingDelete.value = null
    if (deleteTimer) clearTimeout(deleteTimer)
    deleteTimer = null
    return
  }
  pendingDelete.value = id
  if (deleteTimer) clearTimeout(deleteTimer)
  deleteTimer = setTimeout(() => {
    pendingDelete.value = null
    deleteTimer = null
  }, 2500)
}

// ============ 已完成折叠 ============
const showDone = ref(false)

const COMPLETION_ANIMATION_MS = 520
const ALL_CLEAR_STORAGE_KEY = 'hao123-local-clear-celebrated-date'
const completingIds = ref<Set<string>>(new Set())
const completionTimers = new Map<string, ReturnType<typeof setTimeout>>()
let completionAudio: AudioContext | null = null

function hasCompleting(id: string): boolean {
  return completingIds.value.has(id)
}

function setCompleting(id: string, active: boolean): void {
  const next = new Set(completingIds.value)
  active ? next.add(id) : next.delete(id)
  completingIds.value = next
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function celebratedToday(): boolean {
  try {
    return localStorage.getItem(ALL_CLEAR_STORAGE_KEY) === todayKey()
  } catch {
    return false
  }
}

function showAllClearFeedback(): void {
  if (celebratedToday()) return
  try {
    localStorage.setItem(ALL_CLEAR_STORAGE_KEY, todayKey())
  } catch {}

  feedback.success({
    title: '今日清零',
    message: '本地待办全部收尾，收工感 +1',
    duration: 3200,
  })
}

function getCompletionAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtor) return null
  completionAudio ??= new AudioCtor()
  return completionAudio
}

function playCompletionChime(kind: 'single' | 'clear' = 'single'): void {
  const ctx = getCompletionAudio()
  if (!ctx) return
  void ctx.resume().catch(() => {})

  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.setValueAtTime(0.0001, now)
  master.gain.exponentialRampToValueAtTime(kind === 'clear' ? 0.055 : 0.032, now + 0.018)
  master.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'clear' ? 0.34 : 0.22))
  master.connect(ctx.destination)

  const notes = kind === 'clear' ? [659.25, 880] : [659.25]
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, now + i * 0.09)
    osc.connect(master)
    osc.start(now + i * 0.09)
    osc.stop(now + i * 0.09 + 0.18)
    osc.onended = () => osc.disconnect()
  })

  window.setTimeout(() => master.disconnect(), 480)
}

function completeLocalTask(task: LocalTask): void {
  if (task.done || hasCompleting(task.id)) return
  const willClearAfterThis =
    !celebratedToday() &&
    localStore.open.every((t) => t.id === task.id || hasCompleting(t.id))
  setCompleting(task.id, true)
  playCompletionChime(willClearAfterThis ? 'clear' : 'single')

  const timer = setTimeout(() => {
    completionTimers.delete(task.id)
    setCompleting(task.id, false)
    const current = localStore.tasks.find((t) => t.id === task.id)
    if (!current || current.done) return
    localStore.toggle(task.id)
    if (localStore.open.length === 0) showAllClearFeedback()
  }, COMPLETION_ANIMATION_MS)
  completionTimers.set(task.id, timer)
}

// ============ 生命周期：按需加载禅道指派项 ============
onMounted(() => {
  if (taskStore.configured) taskStore.loadAssigned()
  if (bugStore.configured) bugStore.loadAssigned()
})
onUnmounted(() => {
  for (const timer of completionTimers.values()) clearTimeout(timer)
  completionTimers.clear()
  taskStore.stop()
  bugStore.stop()
})
</script>

<template>
  <section class="zt-panel" :class="{ 'is-orbit-view': activeView === 'orbit' }">
    <!-- 头部 -->
    <header class="zt-head">
      <div class="zt-head-main">
        <span class="zt-title-core" :class="{ 'is-active': total > 0, 'is-urgent': urgentCount > 0 }">
          <span class="zt-pulse" />
        </span>
        <div class="zt-title-copy">
          <div class="zt-title-line">
            <span class="zt-title-kicker">WORKSTREAM</span>
            <h2>统一收件箱</h2>
          </div>
          <p>{{ inboxSubtitle }}</p>
        </div>
        <div class="zt-title-metrics" aria-label="收件箱统计">
          <span v-if="total" class="zt-title-pill is-total">
            <strong>{{ total }}</strong>
            <span>项</span>
          </span>
          <span v-if="urgentCount > 0" class="zt-title-pill is-urgent">
            <strong>{{ urgentCount }}</strong>
            <span>紧急</span>
          </span>
        </div>
      </div>

      <nav class="zt-tabs" aria-label="收件箱显示形态">
        <button
          v-for="tab in viewTabs"
          :key="tab.key"
          class="zt-tab"
          :class="{ 'is-active': activeView === tab.key }"
          :title="tab.hint"
          @click="activeView = tab.key"
        >
          <span class="zt-tab-icon" aria-hidden="true">
            <IconClipboardCheck v-if="tab.key === 'list'" class="w-3.5 h-3.5" />
            <IconSpark v-else class="w-3.5 h-3.5" />
          </span>
          <span class="zt-tab-label">{{ tab.label }}</span>
        </button>
      </nav>

      <div class="zt-head-actions">
        <button
          v-if="localStore.doneCount"
          class="zt-clear-done text-[11px] text-white/40 hover:text-rose-300/90 transition-colors"
          title="清除所有已完成"
          @click="localStore.clearDone()"
        >
          清除已完成 ({{ localStore.doneCount }})
        </button>
        <button
          type="button"
          class="zt-create-btn"
          title="新建本地待办"
          aria-label="新建本地待办"
          @click="openCreate"
        >
          <span class="zt-create-core">
            <IconPlus class="w-4 h-4" />
          </span>
          <span class="zt-create-label">新建</span>
        </button>
      </div>
    </header>

    <!-- 小吴已就绪：只要清单非空就常驻；有风险给出概况 + 点题，清闲时一句平稳收尾（无对话框，AI 先动） -->
    <div
      v-if="total > 0"
      class="zt-insight"
      :class="{ 'is-calm': summary.total === 0 }"
    >
      <span class="zt-insight-spark"><IconSpark class="w-3 h-3" /></span>
      <span class="zt-insight-name">小吴已就绪</span>
      <template v-if="summary.total > 0">
        <span class="zt-insight-stats">
          <span v-if="summary.overdue" class="is-overdue">{{ summary.overdue }} 逾期</span>
          <span v-if="summary.dueSoon" class="is-due">{{ summary.dueSoon }} 临期</span>
          <span v-if="summary.stalled" class="is-stall">{{ summary.stalled }} 停滞</span>
        </span>
        <span class="zt-insight-head">{{ summary.headline }}</span>
      </template>
      <span v-else class="zt-insight-head">一切平稳，没有需要紧急处理的，按自己的节奏来。</span>
      <button
        v-if="activeView === 'list'"
        class="zt-trust-toggle"
        :class="{ 'is-open': trustOpen }"
        title="查看数据来源、判断规则和不可用项"
        @click.stop="trustOpen = !trustOpen"
      >
        <IconInfo class="w-3.5 h-3.5" />
        <span>为什么这么排</span>
        <span class="zt-trust-chev">▾</span>
      </button>
      <button
        v-if="chat.configured"
        type="button"
        class="zt-insight-go"
        title="让小吴排出处理顺序"
        @click="askXiaowuToPlan"
      >
        让小吴排一下 →
      </button>
    </div>

    <!-- 信任面板：显式解释排序依据，避免 AI 判断像黑箱（仅清单视图显示） -->
    <section v-if="activeView === 'list' && trustOpen && total > 0" class="zt-trust" aria-label="为什么这么排">
      <header class="zt-trust-head">
        <div>
          <p class="zt-trust-kicker">排序透明度</p>
          <h3 class="zt-trust-title">为什么这么排</h3>
        </div>
        <span class="zt-trust-time">最近更新 {{ trustTime(trustUpdatedAt) }}</span>
      </header>

      <div class="zt-trust-grid">
        <div class="zt-trust-block">
          <p class="zt-trust-label">数据来源</p>
          <ul class="zt-trust-sources">
            <li v-for="source in trustSources" :key="source.label" class="zt-trust-source">
              <span class="zt-trust-dot" :class="`is-${source.tone}`" />
              <div class="min-w-0">
                <div class="zt-trust-source-line">
                  <span class="zt-trust-source-name">{{ source.label }}</span>
                  <span class="zt-trust-source-status" :class="`is-${source.tone}`">{{ source.status }}</span>
                </div>
                <p class="zt-trust-source-detail">{{ source.detail }}</p>
              </div>
            </li>
          </ul>
        </div>

        <div class="zt-trust-block">
          <p class="zt-trust-label">判断规则</p>
          <ul class="zt-trust-rules">
            <li><strong>逾期</strong><span>截止日早于今天，优先级最高。</span></li>
            <li><strong>临期</strong><span>今天或明天到期，排在普通项前。</span></li>
            <li><strong>停滞</strong><span>未推进状态、至少 5 天未变动，且值得提醒。</span></li>
            <li><strong>主排序</strong><span>紧急 → 优先级 → 截止日期；需求线只负责把相关项连起来。</span></li>
          </ul>
        </div>
      </div>

      <div class="zt-trust-foot">
        <span class="zt-trust-current">
          当前命中：{{ summary.overdue }} 逾期 · {{ summary.dueSoon }} 临期 · {{ summary.stalled }} 停滞
        </span>
        <span class="zt-trust-missing">
          不可用：{{ unavailableSources.length ? unavailableSources.map((s) => s.label).join('、') : '暂无' }}
        </span>
      </div>
    </section>

    <!-- 小吴的洞察：检测到值得说的模式时主动开口（LLM 解读 / 未配置走检测模板） -->
    <div v-if="insights.length" class="zt-ic">
      <header class="zt-ic-head">
        <span class="zt-ic-spark"><IconSpark class="w-3 h-3" /></span>
        <span class="zt-ic-title">小吴的洞察</span>
        <button
          v-if="chat.configured"
          class="zt-ic-refresh"
          :class="{ 'is-spinning': insightGenerating }"
          :disabled="insightGenerating"
          title="重新分析"
          @click.stop="refreshInsight"
        >
          <IconRefresh class="w-3 h-3" />
        </button>
      </header>

      <!-- LLM 解读中（无缓存） -->
      <div v-if="chat.configured && insightGenerating && !insightContent" class="zt-ic-loading">
        <span class="zt-ic-dot" />
        <span class="zt-ic-dot" />
        <span class="zt-ic-dot" />
        <span class="zt-ic-loading-text">小吴正在看你的清单…</span>
      </div>

      <!-- LLM 解读正文 -->
      <p v-else-if="insightContent" class="zt-ic-body">{{ insightContent }}</p>

      <!-- 检测模板（LLM 未配置 / 尚未生成时） -->
      <ul v-else class="zt-ic-list">
        <li v-for="ins in insights" :key="ins.kind">
          <span class="zt-ic-bullet" />
          <span>{{ ins.title }}</span>
        </li>
      </ul>

      <footer v-if="chat.configured" class="zt-ic-foot">
        <button class="zt-ic-ask" @click.stop="askXiaowuInsight(insights[0])">
          <IconSpark class="w-3 h-3" />
          <span>让小吴展开 →</span>
        </button>
      </footer>
    </div>

    <!-- 加载中：仅清单视图占位；星图视图始终展示星域本身 -->
    <StateNotice
      v-if="activeView === 'list' && loading"
      tone="loading"
      surface="center"
      :title="zentaoLoggingIn ? '正在登录禅道' : '正在同步清单'"
      :message="zentaoLoggingIn ? '正在建立会话并同步任务、Bug 指派信息。' : '正在刷新禅道与本地待办的合并视图。'"
    />

    <!-- 禅道加载出错且清单无内容可兜底：仅清单视图占满提示 + 重试（本地待办存在时走下面的清单，不被遮蔽） -->
    <StateNotice
      v-else-if="activeView === 'list' && hasError && total === 0"
      tone="danger"
      surface="center"
      title="禅道清单同步失败"
      :message="errorMessage || '禅道服务暂时不可用。'"
      action-label="重试"
      @action="retryZentao"
    />

    <!-- 星图视图：Three.js 科幻任务星域（即使当前没有任务，也保留星域背景与核心状态） -->
    <InboxConstellation
      v-else-if="activeView === 'orbit'"
      :items="orbitItems"
      :summary="summary"
      :urgent-count="urgentCount"
      :remainder="orbitRemainder"
      @open-item="openOrbitItem"
    />

    <!-- 空态：仅清单视图使用；星图视图即使 0 节点也展示星域 -->
    <div v-else-if="isEmpty" class="zt-empty">
      <span class="zt-empty-icon">
        <IconClipboardCheck class="w-6 h-6" />
      </span>
      <p class="zt-empty-title">没有待办</p>
      <p class="zt-empty-sub">禅道指派与本地的待办都会聚到这里</p>
      <button class="zt-empty-create" @click="openCreate">新建一个待办</button>
    </div>

    <!-- 统一清单：任务板形态 -->
    <div v-else class="zt-mission-board">
      <template v-for="g in groups" :key="g.key">
        <!-- 需求线分组头（仅 ≥2 项的簇显示；可折叠） -->
        <button
          v-if="g.isCluster"
          type="button"
          class="zt-group-head"
          :style="{ '--thread': threadColor(g.label) }"
          @click="toggleGroup(g.key)"
        >
          <span class="zt-group-chev" :class="{ 'is-collapsed': !groupOpen(g.key) }">▾</span>
          <span class="zt-group-dot" />
          <span class="zt-group-label">需求线 · {{ g.label }}</span>
          <span class="zt-group-count">{{ g.items.length }}</span>
        </button>
        <!-- 组内条目（簇折叠时隐藏；其他组始终显示） -->
        <article
          v-for="(it, idx) in g.items"
          :key="it.key"
          v-show="g.isCluster ? groupOpen(g.key) : true"
          class="zt-mission-card"
          :class="{
            'is-urgent': isUrgent(it),
            'is-clickable': it.kind !== 'local',
            'in-thread': g.isCluster,
            'is-completing': it.kind === 'local' && hasCompleting((it.ref as LocalTask).id),
          }"
          @click="onRowClick(it)"
        >
          <span v-if="g.isCluster" class="zt-thread-mark" :style="{ '--thread': threadColor(g.label) }" />
          <div class="zt-card-node">
            <button
              v-if="it.kind === 'local'"
              class="zt-check"
              title="标记完成"
              :disabled="hasCompleting((it.ref as LocalTask).id)"
              @click.stop="completeLocalTask(it.ref as LocalTask)"
            >
              <IconCircle class="w-[18px] h-[18px]" />
            </button>
            <template v-else-if="it.kind === 'task'">
              <IconCheckboxOutline class="w-5 h-5" />
            </template>
            <template v-else>
              <IconBug class="w-5 h-5" />
            </template>
            <span class="zt-card-index">{{ String(idx + 1).padStart(2, '0') }}</span>
          </div>

          <div class="zt-card-main">
            <div class="zt-card-top">
              <span
                class="zt-kind"
                :class="{
                  'is-task': it.kind === 'task',
                  'is-bug': it.kind === 'bug',
                  'is-local': it.kind === 'local',
                }"
              >{{ it.kind === 'task' ? '任务' : it.kind === 'bug' ? 'Bug' : '本地' }}</span>
              <span class="zt-card-source">
                #{{ (it.ref as { id: string | number }).id }}
              </span>
              <span v-if="isUrgent(it)" class="zt-card-pressure">HIGH PRESSURE</span>
            </div>

            <div class="zt-card-title-row">
              <button
                v-if="it.kind === 'local'"
                type="button"
                class="zt-title"
                :title="(it.ref as LocalTask).title"
                @click.stop="openEdit(it.ref as LocalTask)"
              >{{ (it.ref as LocalTask).title }}</button>
              <span v-else-if="it.kind === 'task'" class="zt-title" :title="(it.ref as ZentaoTask).name">
                {{ (it.ref as ZentaoTask).name }}
              </span>
              <span v-else class="zt-title" :title="(it.ref as ZentaoBug).title">
                {{ (it.ref as ZentaoBug).title }}
              </span>
            </div>

            <p v-if="it.kind === 'local' && (it.ref as LocalTask).note" class="zt-note truncate">
              {{ (it.ref as LocalTask).note }}
            </p>

            <div class="zt-card-meta">
              <template v-if="it.kind === 'task'">
                <span
                  v-if="ztPri((it.ref as ZentaoTask).pri)"
                  class="zt-badge ring-1 ring-inset"
                  :class="ztPri((it.ref as ZentaoTask).pri)!.class"
                >{{ ztPri((it.ref as ZentaoTask).pri)!.label }}</span>
                <span class="zt-badge ring-1 ring-inset" :class="taskStatusBadge((it.ref as ZentaoTask).status).class">
                  {{ taskStatusBadge((it.ref as ZentaoTask).status).label }}
                </span>
                <span
                  v-if="ztHasDeadline((it.ref as ZentaoTask).deadline)"
                  class="zt-dl"
                  :class="{ 'is-overdue': ztIsOverdue((it.ref as ZentaoTask).deadline) }"
                >{{ (it.ref as ZentaoTask).deadline }}</span>
              </template>

              <template v-else-if="it.kind === 'bug'">
                <span
                  v-if="severityBadge((it.ref as ZentaoBug).severity)"
                  class="zt-badge ring-1 ring-inset"
                  :class="severityBadge((it.ref as ZentaoBug).severity)!.class"
                >{{ severityBadge((it.ref as ZentaoBug).severity)!.label }}</span>
                <span class="zt-badge ring-1 ring-inset" :class="bugStatusBadge((it.ref as ZentaoBug).status).class">
                  {{ bugStatusBadge((it.ref as ZentaoBug).status).label }}
                </span>
              </template>

              <template v-else>
                <span
                  v-if="deadlineLabel((it.ref as LocalTask).deadline)"
                  class="zt-dl"
                  :class="{ 'is-overdue': ztIsOverdue((it.ref as LocalTask).deadline) }"
                >{{ deadlineLabel((it.ref as LocalTask).deadline) }}</span>
                <span class="zt-badge ring-1 ring-inset" :class="priBadge((it.ref as LocalTask).pri).class">
                  {{ priBadge((it.ref as LocalTask).pri).label }}
                </span>
                <span
                  v-if="(it.ref as LocalTask).attachments?.length"
                  class="zt-att flex items-center gap-0.5 text-white/35"
                  :title="`${(it.ref as LocalTask).attachments!.length} 个附件`"
                >
                  <IconClip class="w-3.5 h-3.5" />
                  <span class="text-[11px] tabular-nums">{{ (it.ref as LocalTask).attachments!.length }}</span>
                </span>
              </template>
            </div>
          </div>

          <div class="zt-card-command">
            <button
              v-if="it.risk"
              type="button"
              class="zt-risk"
              :class="[`is-${it.risk.level}`, { 'is-ask': chat.configured }]"
              :title="it.risk.why + (chat.configured ? '（点击让小吴跟进）' : '')"
              @click.stop="askXiaowu(it)"
            >
              <IconAlert v-if="it.risk.level === 'overdue'" class="w-3 h-3" />
              <IconCalendarClock v-else-if="it.risk.level === 'due-soon'" class="w-3 h-3" />
              <IconPause v-else class="w-3 h-3" />
              {{ it.risk.label }}
            </button>
            <span v-else class="zt-card-calm">STABLE</span>

            <div v-if="it.kind === 'local'" class="zt-card-actions">
              <button
                class="zt-act"
                :class="{ 'is-confirm': pendingDelete === (it.ref as LocalTask).id }"
                :title="pendingDelete === (it.ref as LocalTask).id ? '再点一次确认删除' : '删除'"
                @click.stop="onDelete((it.ref as LocalTask).id)"
              >
                <IconTrash v-if="pendingDelete !== (it.ref as LocalTask).id" class="w-4 h-4" />
                <IconCheck v-else class="w-4 h-4" />
              </button>
              <button class="zt-act zt-act-edit" title="编辑" @click.stop="openEdit(it.ref as LocalTask)">
                <IconPencil class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </article>
      </template>

      <!-- 已完成（本地待办）折叠 -->
      <template v-if="localStore.doneCount">
        <button type="button" class="zt-done-head" @click="showDone = !showDone">
          <IconCheck class="w-3.5 h-3.5 text-teal-300/60" />
          <span class="text-[12px] text-white/45">已完成 {{ localStore.doneCount }}</span>
          <span class="zt-chevron text-white/30 transition-transform" :class="{ 'rotate-180': showDone }">▾</span>
        </button>
        <template v-if="showDone">
          <article
            v-for="t in localStore.done"
            :key="`done-${t.id}`"
            class="zt-mission-card is-done"
          >
            <button class="zt-check" title="取消完成" @click.stop="localStore.toggle(t.id)">
              <IconCheck class="w-[18px] h-[18px] text-teal-300" />
            </button>
            <div class="zt-card-main">
              <span class="zt-title line-through" :title="t.title">{{ t.title }}</span>
            </div>
            <button
              class="zt-act"
              :class="{ 'is-confirm': pendingDelete === t.id }"
              :title="pendingDelete === t.id ? '再点一次确认删除' : '删除'"
              @click.stop="onDelete(t.id)"
            >
              <IconTrash v-if="pendingDelete !== t.id" class="w-4 h-4" />
              <IconCheck v-else class="w-4 h-4" />
            </button>
          </article>
        </template>
      </template>
    </div>

    <!-- 详情 / 编辑弹窗 -->
    <TaskDetailModal />
    <BugDetailModal />
    <LocalTaskFormModal v-model:open="formOpen" :task="editing" @submit="onSubmit" />
  </section>
</template>

<style scoped>
.zt-panel {
  --zt-tone: #22d3ee;
  --zt-tone-2: #a78bfa;
  --zt-success: #34d399;
  --zt-warning: #fbbf24;
  --zt-danger: #fb7185;
  --zt-border: rgba(148, 163, 184, 0.16);
  position: relative;
  display: flex;
  width: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--zt-tone) 24%, var(--zt-border));
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.62), rgba(2, 6, 23, 0.38)),
    linear-gradient(115deg, color-mix(in srgb, var(--zt-tone) 7%, transparent), transparent 38%),
    linear-gradient(245deg, color-mix(in srgb, var(--zt-tone-2) 7%, transparent), transparent 42%),
    rgba(2, 6, 23, 0.36);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    inset 0 0 0 1px rgba(255,255,255,0.03),
    0 24px 82px rgba(0,0,0,0.32);
  backdrop-filter: blur(20px) saturate(135%);
}
.zt-panel::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, rgba(255,255,255,0.038) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255,255,255,0.026) 1px, transparent 1px),
    repeating-linear-gradient(135deg, transparent 0 34px, rgba(255,255,255,0.018) 34px 35px, transparent 35px 70px);
  background-size: 30px 30px, 30px 30px, auto;
  mask-image: linear-gradient(135deg, rgba(0,0,0,0.58), transparent 66%);
}
.zt-panel::after {
  position: absolute;
  inset: 0 18px auto;
  height: 2px;
  content: '';
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--zt-tone) 64%, transparent), color-mix(in srgb, var(--zt-tone-2) 38%, transparent), transparent);
  opacity: 0.88;
  box-shadow: 0 0 28px color-mix(in srgb, var(--zt-tone) 18%, transparent);
}
.zt-panel.is-orbit-view {
  border-color: color-mix(in srgb, var(--zt-tone) 12%, transparent);
  background: rgba(2, 6, 23, 0.18);
}
.zt-head,
.zt-insight,
.zt-trust,
.zt-ic,
.zt-mission-board,
.zt-empty,
.zt-panel > div,
.zt-panel > ul,
.zt-panel > section {
  position: relative;
  z-index: 1;
}
.zt-head {
  position: relative;
  display: grid;
  grid-template-columns: minmax(190px, 1fr) auto minmax(180px, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 12px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--zt-tone) 18%, rgba(255,255,255,0.08));
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.58), rgba(15, 23, 42, 0.26)),
    linear-gradient(90deg, color-mix(in srgb, var(--zt-tone) 7%, transparent), transparent 38%);
  backdrop-filter: blur(16px) saturate(125%);
}
.zt-head::after {
  position: absolute;
  inset: auto 16px 0;
  height: 1px;
  content: '';
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent);
}
.zt-panel.is-orbit-view .zt-head {
  position: absolute;
  z-index: 9;
  top: 16px;
  left: 50%;
  right: auto;
  width: auto;
  min-width: 0;
  min-height: 42px;
  grid-template-columns: auto auto auto;
  gap: 10px;
  padding: 6px 8px 6px 12px;
  border: 1px solid color-mix(in srgb, var(--zt-tone) 18%, transparent);
  border-radius: 999px;
  background: rgba(2, 6, 23, 0.3);
  box-shadow: 0 10px 34px rgba(0,0,0,0.18);
  backdrop-filter: blur(12px) saturate(120%);
  transform: translateX(-50%);
}
.zt-panel.is-orbit-view .zt-head-main h2,
.zt-panel.is-orbit-view .zt-head-main > span:not(.zt-pulse),
.zt-panel.is-orbit-view .zt-title-copy,
.zt-panel.is-orbit-view .zt-title-metrics,
.zt-panel.is-orbit-view .zt-head-actions button:first-child { display: none; }
.zt-panel.is-orbit-view .zt-head-actions { min-width: auto; }
.zt-panel.is-orbit-view .zt-create-btn {
  width: 34px;
  padding: 0;
}
.zt-panel.is-orbit-view .zt-create-label { display: none; }
.zt-panel.is-orbit-view .zt-insight,
.zt-panel.is-orbit-view .zt-ic { display: none; }
.zt-head-main,
.zt-head-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.zt-head-main {
  gap: 10px;
}
.zt-title-core {
  position: relative;
  display: grid;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid rgba(148,163,184,0.14);
  border-radius: 12px;
  background:
    radial-gradient(circle at 50% 0, rgba(255,255,255,0.1), transparent 52%),
    rgba(2,6,23,0.34);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055);
}
.zt-title-core::before {
  position: absolute;
  inset: -5px;
  border-radius: 16px;
  content: '';
  background: radial-gradient(circle, color-mix(in srgb, var(--zt-tone) 16%, transparent), transparent 64%);
  opacity: 0.42;
}
.zt-title-core.is-active {
  border-color: color-mix(in srgb, var(--zt-success) 32%, transparent);
}
.zt-title-core.is-urgent {
  border-color: color-mix(in srgb, var(--zt-danger) 36%, transparent);
}
.zt-title-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.zt-title-line {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}
.zt-title-kicker {
  color: color-mix(in srgb, var(--zt-tone) 64%, white 4%);
  font: 850 9px/1 var(--hud-font-data, ui-monospace, monospace);
  letter-spacing: 0.12em;
}
.zt-title-copy h2 {
  margin: 0;
  color: rgba(248,250,252,0.94);
  font-size: 15.5px;
  font-weight: 850;
  line-height: 1.15;
}
.zt-title-copy p {
  margin: 0;
  overflow: hidden;
  color: rgba(226,232,240,0.45);
  font-size: 11.5px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zt-title-metrics {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  margin-left: 2px;
}
.zt-title-pill {
  display: inline-flex;
  height: 24px;
  align-items: baseline;
  gap: 4px;
  padding: 0 8px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  background: rgba(255,255,255,0.04);
  color: rgba(226,232,240,0.64);
  font-size: 10.5px;
  line-height: 22px;
}
.zt-title-pill strong {
  color: rgba(255,255,255,0.9);
  font-size: 12px;
  font-weight: 850;
}
.zt-title-pill.is-total {
  border-color: rgba(45,212,191,0.18);
  background: rgba(45,212,191,0.08);
  color: rgba(153,246,228,0.7);
}
.zt-title-pill.is-urgent {
  border-color: rgba(251,113,133,0.24);
  background: rgba(244,63,94,0.11);
  color: rgba(254,205,211,0.76);
}
.zt-head-actions { justify-content: flex-end; }
.zt-head-actions button,
.zt-tab,
.zt-insight-go,
.zt-trust-toggle,
.zt-ic-refresh,
.zt-ic-ask,
.zt-check,
.zt-act,
.zt-done-head,
.zt-empty-create,
.zt-group-head {
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}
.zt-head-actions button {
  border-radius: 9px;
}
.zt-head-actions .zt-clear-done {
  height: 29px;
  padding: 0 9px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.045);
  color: rgba(226,232,240,0.5);
}
.zt-head-actions .zt-clear-done:hover,
.zt-head-actions .zt-clear-done:focus-visible {
  color: #fecdd3;
  border-color: rgba(244,63,94,0.26);
  background: rgba(244,63,94,0.1);
  outline: 0;
}
.zt-head-actions .zt-create-btn {
  position: relative;
  display: inline-flex;
  width: auto;
  height: 32px;
  align-items: center;
  gap: 7px;
  padding: 0 11px 0 6px;
  border: 1px solid color-mix(in srgb, var(--zt-tone) 40%, transparent);
  border-radius: 12px;
  background:
    radial-gradient(circle at 22px 0, rgba(255,255,255,0.14), transparent 42%),
    linear-gradient(180deg, color-mix(in srgb, var(--zt-tone) 18%, rgba(2,6,23,0.66)), rgba(2,6,23,0.34));
  color: rgba(236,254,255,0.94);
  box-shadow:
    0 12px 28px color-mix(in srgb, var(--zt-tone) 14%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.14);
  overflow: hidden;
}
.zt-head-actions .zt-create-btn::after {
  position: absolute;
  inset: auto 10px 0;
  height: 1px;
  content: '';
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--zt-tone) 72%, transparent), transparent);
  opacity: 0.72;
}
.zt-head-actions .zt-create-btn:hover,
.zt-head-actions .zt-create-btn:focus-visible {
  border-color: color-mix(in srgb, var(--zt-tone) 48%, transparent);
  background:
    radial-gradient(circle at 22px 0, rgba(255,255,255,0.18), transparent 42%),
    color-mix(in srgb, var(--zt-tone) 14%, rgba(255,255,255,0.05));
  outline: 0;
  transform: translateY(-1px);
}
.zt-create-core {
  display: grid;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--zt-tone) 42%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--zt-tone) 12%, transparent);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
}
.zt-create-label {
  position: relative;
  z-index: 1;
  font-size: 12px;
  font-weight: 850;
  line-height: 1;
  white-space: nowrap;
}
.zt-tabs {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border: 1px solid color-mix(in srgb, var(--zt-tone) 26%, transparent);
  border-radius: 14px;
  background:
    radial-gradient(circle at 50% 0, color-mix(in srgb, var(--zt-tone) 9%, transparent), transparent 62%),
    linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.018)),
    rgba(2, 6, 23, 0.62);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.065),
    0 12px 30px rgba(0,0,0,0.2);
  overflow: hidden;
}
.zt-tabs::before {
  position: absolute;
  inset: 6px 50% 6px 6px;
  width: calc(50% - 6px);
  border-radius: 10px;
  content: '';
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--zt-tone) 19%, rgba(255,255,255,0.04)), color-mix(in srgb, var(--zt-tone-2) 8%, transparent));
  box-shadow:
    0 0 22px color-mix(in srgb, var(--zt-tone) 16%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--zt-tone) 30%, transparent);
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.zt-tabs:has(.zt-tab:nth-child(2).is-active)::before {
  transform: translateX(calc(100% + 4px));
}
.zt-tab {
  position: relative;
  z-index: 1;
  display: inline-flex;
  height: 32px;
  min-width: 62px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 11px;
  border-radius: 10px;
  color: rgba(226,232,240,0.54);
  font-size: 12px;
  font-weight: 750;
  transition: color 0.18s, filter 0.18s;
}
.zt-tab:hover,
.zt-tab:focus-visible { color: rgba(255,255,255,0.84); outline: 0; }
.zt-tab.is-active {
  color: #ecfeff;
  filter: drop-shadow(0 0 8px color-mix(in srgb, var(--zt-tone) 22%, transparent));
}
.zt-tab-icon {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 7px;
  color: rgba(226,232,240,0.52);
}
.zt-tab.is-active .zt-tab-icon {
  color: color-mix(in srgb, var(--zt-tone) 78%, white 12%);
}
.zt-tab-label {
  position: relative;
}
.zt-tab.is-active .zt-tab-label::after {
  position: absolute;
  inset: auto 15% -6px;
  height: 1px;
  content: '';
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--zt-tone) 82%, transparent), transparent);
}
.zt-pulse {
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  border-radius: 9999px;
  background: rgba(148,163,184,0.5);
}
.zt-pulse.is-active {
  background: var(--zt-success);
  animation: zt-ping 2s ease-out infinite;
}
.zt-pulse.is-urgent {
  background: var(--zt-danger);
  animation: zt-ping-urgent 2s ease-out infinite;
}
.zt-title-core.is-active .zt-pulse {
  background: var(--zt-success);
  animation: zt-ping 2s ease-out infinite;
}
.zt-title-core.is-urgent .zt-pulse {
  background: var(--zt-danger);
  animation: zt-ping-urgent 2s ease-out infinite;
}
@keyframes zt-ping {
  0% { box-shadow: 0 0 0 0 rgba(52,211,153,0.5); }
  70% { box-shadow: 0 0 0 7px rgba(52,211,153,0); }
  100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
}
@keyframes zt-ping-urgent {
  0% { box-shadow: 0 0 0 0 rgba(251,113,133,0.5); }
  70% { box-shadow: 0 0 0 7px rgba(251,113,133,0); }
  100% { box-shadow: 0 0 0 0 rgba(251,113,133,0); }
}
.zt-insight,
.zt-ic,
.zt-trust {
  border-bottom: 1px solid rgba(255,255,255,0.07);
  background:
    linear-gradient(120deg, color-mix(in srgb, var(--zt-tone-2) 8%, transparent), color-mix(in srgb, var(--zt-tone) 5%, transparent)),
    linear-gradient(180deg, rgba(255,255,255,0.026), transparent),
    rgba(2, 6, 23, 0.16);
}
.zt-insight {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 11px 16px;
  color: rgba(255,255,255,0.76);
  font-size: 12px;
}
.zt-insight.is-calm { background: linear-gradient(120deg, color-mix(in srgb, var(--zt-success) 8%, transparent), color-mix(in srgb, var(--zt-tone) 3%, transparent)); }
.zt-insight-spark,
.zt-ic-spark {
  display: grid;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--zt-tone-2) 26%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--zt-tone-2) 14%, transparent);
  color: color-mix(in srgb, var(--zt-tone-2) 80%, white);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.zt-insight.is-calm .zt-insight-spark {
  border-color: color-mix(in srgb, var(--zt-success) 28%, transparent);
  background: color-mix(in srgb, var(--zt-success) 13%, transparent);
  color: #86efac;
}
.zt-insight-name,
.zt-ic-title { color: rgba(255,255,255,0.9); font-weight: 850; }
.zt-insight-stats { display: inline-flex; gap: 6px; }
.zt-insight-stats span,
.zt-risk,
.zt-kind,
.zt-badge,
.zt-dl,
.zt-group-count,
.zt-trust-source-status,
.zt-quality-pill {
  border-radius: 999px;
}
.zt-insight-stats span {
  padding: 1px 7px;
  font-weight: 750;
}
.zt-insight-stats .is-overdue { color: #fda4af; background: rgba(244,63,94,0.12); }
.zt-insight-stats .is-due { color: #fcd34d; background: rgba(251,191,36,0.1); }
.zt-insight-stats .is-stall { color: #c4b5fd; background: rgba(139,92,246,0.1); }
.zt-insight-head { color: rgba(255,255,255,0.58); }
.zt-insight-go,
.zt-trust-toggle,
.zt-ic-ask,
.zt-ic-refresh {
  border: 1px solid color-mix(in srgb, var(--zt-tone-2) 20%, transparent);
  background: color-mix(in srgb, var(--zt-tone-2) 10%, rgba(255,255,255,0.035));
  color: rgba(199,210,254,0.86);
  transition: transform 0.15s, background 0.15s, border-color 0.15s, color 0.15s;
}
.zt-insight-go {
  display: inline-flex;
  height: 25px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
  white-space: nowrap;
}
.zt-trust-toggle {
  display: inline-flex;
  height: 25px;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border-radius: 8px;
  font-size: 11.5px;
}
.zt-insight-go:hover,
.zt-insight-go:focus-visible,
.zt-trust-toggle:hover,
.zt-trust-toggle:focus-visible,
.zt-trust-toggle.is-open,
.zt-ic-ask:hover,
.zt-ic-ask:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--zt-tone-2) 36%, transparent);
  background: color-mix(in srgb, var(--zt-tone-2) 18%, rgba(255,255,255,0.05));
  color: #eef2ff;
  outline: 0;
}
.zt-trust-chev { color: rgba(255,255,255,0.42); font-size: 10px; transition: transform 0.15s; }
.zt-trust-toggle.is-open .zt-trust-chev { transform: rotate(180deg); }
.zt-trust {
  padding: 13px 16px 14px;
}
.zt-trust-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.zt-trust-kicker {
  margin: 0 0 2px;
  color: color-mix(in srgb, var(--zt-tone-2) 72%, white 6%);
  font: 850 9px/1 var(--hud-font-data, ui-monospace, monospace);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.zt-trust-title { margin: 0; color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 850; }
.zt-trust-time { flex-shrink: 0; color: rgba(255,255,255,0.42); font-size: 11px; }
.zt-trust-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr); gap: 12px; }
.zt-trust-block {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148,163,184,0.13);
  border-radius: 10px;
  background: rgba(2,6,23,0.26);
}
.zt-trust-label { margin: 0 0 8px; color: rgba(255,255,255,0.74); font-size: 11px; font-weight: 800; }
.zt-trust-sources,
.zt-trust-rules { margin: 0; padding: 0; list-style: none; }
.zt-trust-source { display: grid; grid-template-columns: 8px minmax(0, 1fr); gap: 8px; align-items: start; }
.zt-trust-source + .zt-trust-source { margin-top: 9px; }
.zt-trust-dot { width: 7px; height: 7px; margin-top: 6px; border-radius: 999px; background: rgba(148,163,184,0.72); }
.zt-trust-dot.is-ok { background: var(--zt-success); box-shadow: 0 0 8px rgba(52,211,153,0.5); }
.zt-trust-dot.is-warn { background: var(--zt-warning); box-shadow: 0 0 8px rgba(251,191,36,0.42); }
.zt-trust-dot.is-error { background: var(--zt-danger); box-shadow: 0 0 8px rgba(251,113,133,0.45); }
.zt-trust-dot.is-idle { background: var(--zt-tone); box-shadow: 0 0 8px rgba(34,211,238,0.42); }
.zt-trust-source-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.zt-trust-source-name { color: rgba(255,255,255,0.86); font-size: 12px; font-weight: 800; }
.zt-trust-source-status { flex-shrink: 0; padding: 1px 6px; background: rgba(148,163,184,0.12); color: rgba(226,232,240,0.68); font-size: 10.5px; font-weight: 750; }
.zt-trust-source-status.is-ok { color: #86efac; background: rgba(34,197,94,0.12); }
.zt-trust-source-status.is-warn { color: #fde68a; background: rgba(251,191,36,0.12); }
.zt-trust-source-status.is-error { color: #fda4af; background: rgba(244,63,94,0.13); }
.zt-trust-source-status.is-idle { color: #7dd3fc; background: rgba(56,189,248,0.12); }
.zt-trust-source-detail { margin: 3px 0 0; color: rgba(255,255,255,0.5); font-size: 11.5px; line-height: 1.55; }
.zt-trust-rules li { display: grid; grid-template-columns: 46px minmax(0,1fr); gap: 8px; align-items: baseline; color: rgba(255,255,255,0.52); font-size: 11.5px; line-height: 1.5; }
.zt-trust-rules li + li { margin-top: 7px; }
.zt-trust-rules strong { color: rgba(255,255,255,0.84); font-weight: 850; }
.zt-trust-foot { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; font-size: 11.5px; }
.zt-trust-current { color: rgba(226,232,240,0.64); }
.zt-trust-missing { color: rgba(251,191,36,0.78); }
.zt-ic { padding: 0 16px 12px; }
.zt-ic-head { display: flex; align-items: center; gap: 7px; padding: 10px 0 8px; }
.zt-ic-refresh { display: grid; width: 24px; height: 24px; margin-left: auto; place-items: center; border-radius: 8px; color: rgba(255,255,255,0.42); }
.zt-ic-refresh:hover:not(:disabled),
.zt-ic-refresh:focus-visible { color: rgba(255,255,255,0.9); outline: 0; }
.zt-ic-refresh:disabled { cursor: default; opacity: 0.65; }
.zt-ic-refresh.is-spinning svg { animation: zt-risk-spin 0.9s linear infinite; }
@keyframes zt-risk-spin { to { transform: rotate(360deg); } }
.zt-ic-body { margin: 0; color: rgba(255,255,255,0.78); font-size: 12.5px; line-height: 1.7; }
.zt-ic-list { margin: 0; padding: 0; list-style: none; }
.zt-ic-list li { position: relative; padding: 3px 0 3px 14px; color: rgba(255,255,255,0.75); font-size: 12.5px; line-height: 1.6; }
.zt-ic-bullet { position: absolute; left: 2px; top: 11px; width: 4px; height: 4px; border-radius: 50%; background: color-mix(in srgb, var(--zt-tone-2) 70%, transparent); }
.zt-ic-loading { display: flex; align-items: center; gap: 5px; padding: 2px 0; }
.zt-ic-loading-text { margin-left: 6px; color: rgba(255,255,255,0.5); font-size: 12.5px; }
.zt-ic-dot { width: 5px; height: 5px; border-radius: 50%; background: color-mix(in srgb, var(--zt-tone-2) 70%, white); animation: zt-ic-bounce 1.2s ease-in-out infinite; }
.zt-ic-dot:nth-child(2) { animation-delay: 0.15s; }
.zt-ic-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes zt-ic-bounce { 0%,80%,100% { opacity: 0.3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
.zt-ic-foot { padding: 8px 0 0; }
.zt-ic-ask { display: inline-flex; align-items: center; gap: 5px; min-height: 27px; padding: 0 10px; border-radius: 8px; font-size: 11.5px; font-weight: 800; }
.zt-mission-board {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  background:
    linear-gradient(90deg, rgba(255,255,255,0.024), transparent 7%, transparent 93%, rgba(255,255,255,0.018)),
    linear-gradient(180deg, rgba(255,255,255,0.02), transparent 92%),
    repeating-linear-gradient(180deg, transparent 0 47px, rgba(255,255,255,0.014) 47px 48px);
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.24) transparent;
}
.zt-mission-board::-webkit-scrollbar { width: 6px; }
.zt-mission-board::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.24); border-radius: 999px; }
.zt-mission-card {
  position: relative;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) minmax(112px, auto);
  align-items: stretch;
  gap: 13px;
  height: 96px;
  max-height: 96px;
  margin-bottom: 10px;
  padding: 13px 14px 13px 16px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.115);
  border-radius: 16px;
  background:
    radial-gradient(circle at 34px 28px, color-mix(in srgb, var(--zt-tone) 7%, transparent), transparent 72px),
    linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012)),
    linear-gradient(100deg, color-mix(in srgb, var(--zt-tone) 6%, transparent), transparent 50%),
    rgba(2, 6, 23, 0.34);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.055),
    inset 0 -1px 0 rgba(255,255,255,0.018),
    0 10px 24px rgba(0,0,0,0.14);
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}
.zt-mission-card::before {
  position: absolute;
  inset: 12px auto 12px 0;
  width: 2px;
  border-radius: 999px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--zt-tone), transparent);
  opacity: 0.48;
}
.zt-mission-card::after {
  position: absolute;
  inset: 0 16px auto 18px;
  height: 1px;
  content: '';
  background: linear-gradient(90deg, color-mix(in srgb, var(--zt-tone) 24%, transparent), transparent 54%);
  opacity: 0.38;
}
.zt-mission-card:last-child { margin-bottom: 0; }
.zt-mission-card.is-clickable { cursor: pointer; }
.zt-mission-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--zt-tone) 34%, transparent);
  background:
    radial-gradient(circle at 34px 32px, color-mix(in srgb, var(--zt-tone) 14%, transparent), transparent 86px),
    linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.018)),
    linear-gradient(100deg, color-mix(in srgb, var(--zt-tone) 11%, transparent), transparent 56%),
    rgba(15, 23, 42, 0.48);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.075),
    inset 0 -1px 0 rgba(255,255,255,0.026),
    0 14px 34px rgba(0,0,0,0.2),
    0 0 28px color-mix(in srgb, var(--zt-tone) 9%, transparent);
}
.zt-mission-card:hover::before { opacity: 0.88; }
.zt-mission-card:hover::after { opacity: 0.68; }
.zt-mission-card.is-urgent {
  border-color: rgba(244,63,94,0.24);
  background:
    radial-gradient(circle at 34px 32px, rgba(244,63,94,0.16), transparent 86px),
    linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012)),
    rgba(244,63,94,0.04);
}
.zt-mission-card.is-urgent::before { background: linear-gradient(180deg, transparent, var(--zt-danger), transparent); opacity: 0.72; }
.zt-mission-card.is-done { opacity: 0.68; }
.zt-mission-card.is-done:hover { opacity: 1; }
.zt-mission-card.is-completing {
  pointer-events: none;
  animation: zt-complete-row 0.52s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  background: linear-gradient(90deg, rgba(45,212,191,0.16), rgba(45,212,191,0.03)), rgba(125,211,252,0.05);
  box-shadow: inset 3px 0 0 rgba(45,212,191,0.72), 0 0 24px rgba(45,212,191,0.1);
}
.zt-mission-card.is-completing .zt-title,
.zt-mission-card.is-completing .zt-note { position: relative; color: rgba(204,251,241,0.72); }
.zt-mission-card.is-completing .zt-title::after {
  position: absolute;
  left: 0;
  top: 54%;
  width: 100%;
  height: 1px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(153,246,228,0), rgba(153,246,228,0.92), rgba(153,246,228,0.35));
  content: '';
  transform: scaleX(0);
  transform-origin: left;
  animation: zt-complete-strike 0.34s ease-out forwards;
}
.zt-mission-card.is-completing .zt-check { color: #99f6e4; background: rgba(45,212,191,0.18); box-shadow: 0 0 0 5px rgba(45,212,191,0.1); animation: zt-complete-check 0.42s ease-out; }
@keyframes zt-complete-row { 0% { opacity: 1; transform: translateY(0) scale(1); } 42% { opacity: 1; transform: translateY(-1px) scale(1.006); } 100% { opacity: 0; transform: translateY(-8px) scale(0.985); } }
@keyframes zt-complete-strike { to { transform: scaleX(1); } }
@keyframes zt-complete-check { 0% { transform: scale(1); } 45% { transform: scale(1.18); } 100% { transform: scale(1); } }
.zt-card-node {
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-rows: 42px auto;
  justify-items: center;
  align-self: stretch;
  gap: 6px;
  color: color-mix(in srgb, var(--zt-tone) 70%, white 8%);
}
.zt-card-node::before {
  position: absolute;
  top: 48px;
  bottom: 3px;
  width: 1px;
  content: '';
  background: linear-gradient(180deg, color-mix(in srgb, var(--zt-tone) 34%, transparent), transparent);
}
.zt-card-node > svg,
.zt-card-node .zt-check {
  position: relative;
  z-index: 1;
}
.zt-card-node > svg {
  width: 42px;
  height: 42px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--zt-tone) 28%, transparent);
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015)),
    color-mix(in srgb, var(--zt-tone) 9%, rgba(2,6,23,0.28));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.06),
    0 0 20px color-mix(in srgb, var(--zt-tone) 10%, transparent);
}
.zt-card-index {
  position: relative;
  z-index: 1;
  padding: 2px 5px;
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 6px;
  background: rgba(2,6,23,0.42);
  color: rgba(226,232,240,0.45);
  font: 800 10px/1 var(--hud-font-data, ui-monospace, monospace);
}
.zt-card-main {
  display: grid;
  min-width: 0;
  align-content: center;
  gap: 7px;
}
.zt-card-top,
.zt-card-meta,
.zt-card-actions {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.zt-card-title-row {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zt-card-source,
.zt-card-pressure,
.zt-card-calm {
  color: rgba(226,232,240,0.42);
  font: 800 10px/1 var(--hud-font-data, ui-monospace, monospace);
  letter-spacing: 0.08em;
}
.zt-card-pressure {
  color: rgba(254,205,211,0.72);
}
.zt-card-command {
  display: grid;
  min-width: 112px;
  align-content: center;
  justify-items: end;
  gap: 8px;
}
.zt-card-calm {
  padding: 6px 8px;
  border: 1px solid rgba(52,211,153,0.12);
  border-radius: 8px;
  background: rgba(52,211,153,0.045);
  color: rgba(167,243,208,0.48);
}
.zt-group-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 5px 0 9px;
  padding: 8px 12px 8px 13px;
  border: 1px solid color-mix(in srgb, var(--thread) 26%, rgba(255,255,255,0.08));
  border-radius: 11px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--thread) 13%, rgba(2,6,23,0.38)), rgba(2,6,23,0.2)),
    linear-gradient(180deg, rgba(255,255,255,0.035), transparent);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.045);
  user-select: none;
  transition: background 0.15s, border-color 0.15s;
}
.zt-group-head:hover,
.zt-group-head:focus-visible { border-color: color-mix(in srgb, var(--thread) 36%, transparent); background: color-mix(in srgb, var(--thread) 12%, rgba(2,6,23,0.36)); outline: 0; }
.zt-group-chev { color: rgba(255,255,255,0.42); font-size: 10px; transition: transform 0.15s; }
.zt-group-chev.is-collapsed { transform: rotate(-90deg); }
.zt-group-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 999px; background: var(--thread); box-shadow: 0 0 8px var(--thread); }
.zt-group-label { overflow: hidden; color: rgba(255,255,255,0.82); font-size: 11.5px; font-weight: 830; text-overflow: ellipsis; white-space: nowrap; }
.zt-group-count { flex-shrink: 0; padding: 0 7px; background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.52); font-size: 11px; font-weight: 780; }
.zt-thread-mark {
  position: absolute;
  inset: 14px auto 14px 16px;
  z-index: 1;
  width: 2px;
  border-radius: 2px;
  background: var(--thread);
  opacity: 0.62;
  pointer-events: none;
}
.zt-kind,
.zt-badge {
  flex-shrink: 0;
  min-height: 20px;
  padding: 2px 7px;
  border: 1px solid rgba(255,255,255,0.075);
  background: rgba(255,255,255,0.04);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
  font-size: 11px;
  font-weight: 750;
  line-height: 1.35;
}
.zt-kind {
  border-radius: 7px;
  letter-spacing: 0.02em;
}
.zt-risk {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 3px;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 780;
  line-height: 1.4;
}
.zt-risk.is-overdue { color: #fecdd3; background: linear-gradient(180deg, rgba(244,63,94,0.18), rgba(244,63,94,0.08)); box-shadow: inset 0 0 0 1px rgba(244,63,94,0.34); }
.zt-risk.is-due-soon { color: #fde68a; background: linear-gradient(180deg, rgba(251,191,36,0.15), rgba(251,191,36,0.065)); box-shadow: inset 0 0 0 1px rgba(251,191,36,0.3); }
.zt-risk.is-stalled { color: #ddd6fe; background: linear-gradient(180deg, rgba(139,92,246,0.15), rgba(139,92,246,0.065)); box-shadow: inset 0 0 0 1px rgba(139,92,246,0.28); }
.zt-risk.is-ask { transition: filter 0.15s, transform 0.15s; cursor: pointer; }
.zt-risk.is-ask:hover,
.zt-risk.is-ask:focus-visible { transform: translateY(-1px); filter: brightness(1.15); outline: 0; }
.zt-risk.is-overdue.is-ask { animation: zt-risk-pulse 2.4s ease-in-out infinite; }
@keyframes zt-risk-pulse { 0%,100% { box-shadow: inset 0 0 0 1px rgba(244,63,94,0.3); } 50% { box-shadow: inset 0 0 0 1px rgba(244,63,94,0.55), 0 0 0 3px rgba(244,63,94,0.1); } }
.zt-dl { flex-shrink: 0; padding: 2px 7px; border-radius: 7px; background: rgba(255,255,255,0.035); color: rgba(255,255,255,0.48); font-size: 11px; }
.zt-dl.is-overdue { color: #fda4af; }
.zt-att { flex-shrink: 0; align-items: center; }
.zt-check {
  display: flex;
  width: 27px;
  height: 27px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018));
  color: rgba(255,255,255,0.42);
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.zt-check:hover,
.zt-check:focus-visible { color: #5eead4; border-color: rgba(45,212,191,0.28); background: rgba(45,212,191,0.12); outline: 0; }
.zt-check:disabled { cursor: default; }
.zt-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.35;
  font-weight: 720;
}
.zt-title:hover { color: #fff; }
.zt-note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 3px;
  color: rgba(255,255,255,0.42);
  font-size: 11.5px;
}
.zt-act {
  display: flex;
  width: 25px;
  height: 25px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: rgba(255,255,255,0.28);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s, transform 0.15s;
}
.zt-mission-card:hover .zt-act { opacity: 1; }
.zt-act:hover,
.zt-act:focus-visible { color: rgba(255,255,255,0.84); background: rgba(255,255,255,0.09); outline: 0; transform: translateY(-1px); }
.zt-act.is-confirm { opacity: 1; color: #fda4af; background: rgba(244,63,94,0.14); }
.zt-act-edit { width: 22px; height: 22px; }
.zt-done-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
  padding: 9px 12px;
  border: 1px dashed rgba(148,163,184,0.12);
  border-radius: 10px;
  transition: background 0.15s, border-color 0.15s;
}
.zt-done-head:hover { border-color: color-mix(in srgb, var(--zt-tone) 22%, transparent); background: rgba(255,255,255,0.04); }
.zt-chevron { margin-left: auto; font-size: 11px; }
.zt-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 44px 16px;
  text-align: center;
  background:
    linear-gradient(180deg, transparent, rgba(255,255,255,0.018), transparent),
    linear-gradient(90deg, transparent, color-mix(in srgb, var(--zt-tone) 5%, transparent), transparent);
}
.zt-empty-icon {
  display: grid;
  width: 64px;
  height: 64px;
  margin-bottom: 4px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--zt-tone) 34%, transparent);
  border-radius: 18px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--zt-tone) 14%, rgba(255,255,255,0.045)), rgba(2,6,23,0.12));
  color: #5eead4;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.09),
    0 0 30px color-mix(in srgb, var(--zt-tone) 17%, transparent);
}
.zt-empty-title { color: rgba(255,255,255,0.82); font-size: 15px; font-weight: 850; }
.zt-empty-sub { color: rgba(255,255,255,0.42); font-size: 12.5px; }
.zt-empty-create {
  margin-top: 7px;
  padding: 7px 13px;
  border: 1px solid color-mix(in srgb, var(--zt-tone) 34%, transparent);
  border-radius: 10px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--zt-tone) 13%, transparent), transparent),
    rgba(255,255,255,0.035);
  color: #5eead4;
  font-size: 12.5px;
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.zt-empty-create:hover,
.zt-empty-create:focus-visible { border-color: color-mix(in srgb, var(--zt-tone) 44%, transparent); background: color-mix(in srgb, var(--zt-tone) 16%, transparent); color: #99f6e4; outline: 0; }
@media (max-width: 760px) {
  .zt-panel { border-radius: 14px; }
  .zt-head { grid-template-columns: 1fr; align-items: stretch; padding: 12px; }
  .zt-tabs,
  .zt-head-actions { justify-content: flex-start; }
  .zt-trust-grid { grid-template-columns: 1fr; }
  .zt-mission-board { padding: 8px; }
  .zt-mission-card {
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 9px;
    min-height: 0;
    padding: 11px;
  }
  .zt-card-node {
    grid-template-rows: 38px auto;
  }
  .zt-card-node > svg {
    width: 38px;
    height: 38px;
  }
  .zt-card-command {
    grid-column: 2;
    min-width: 0;
    justify-items: start;
  }
  .zt-kind,
  .zt-badge,
  .zt-risk,
  .zt-dl { min-height: 19px; }
}
@media (prefers-reduced-motion: reduce) {
  .zt-pulse.is-active,
  .zt-pulse.is-urgent,
  .zt-risk.is-overdue.is-ask,
  .zt-ic-refresh.is-spinning svg,
  .zt-ic-dot,
  .zt-mission-card.is-completing,
  .zt-mission-card.is-completing .zt-check,
  .zt-mission-card.is-completing .zt-title::after { animation: none; }
  .zt-mission-card,
  .zt-insight-go,
  .zt-trust-toggle,
  .zt-ic-ask { transition: none; }
  .zt-mission-card:hover,
  .zt-insight-go:hover,
  .zt-trust-toggle:hover,
  .zt-ic-ask:hover { transform: none; }
  .zt-mission-card.is-completing { opacity: 0.55; transform: none; }
}
</style>
