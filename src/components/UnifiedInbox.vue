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
import { computed, onMounted, onUnmounted, ref } from 'vue'
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
import { useChatStore, useInboxInsight } from '@/features/chat'
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

const taskStore = useTaskStore()
const bugStore = useBugStore()
const localStore = useLocalTaskStore()
/** 小吴的「风险预测」——对收件箱工作项做启发式预测（逾期 / 临期 / 停滞）+ 汇总成状态条 */
const { predictions, summary } = useInboxInsights()
/** 小吴的「洞察」——检测到的模式 + LLM 解读（驱动「小吴的洞察」卡） */
const { insights, content: insightContent, generating: insightGenerating, refresh: refreshInsight } = useInboxInsight()
const chat = useChatStore()

type InboxView = 'list' | 'orbit'
const activeView = ref<InboxView>('list')
const viewTabs: { key: InboxView; label: string; hint: string }[] = [
  { key: 'list', label: '清单', hint: '按紧急度 / 优先级 / 截止日期合并排序的统一清单' },
  { key: 'orbit', label: '星图', hint: '把工作项投射为 3D 风险关系图，节点越亮越急' },
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

// ============ 小吴：行内风险 → 一键交给小吴（无对话框，AI 带上下文接手）============
/** 行内风险徽标点击：带上下文把这项交给小吴跟进（LLM 未配置则不响应，徽标仅作信息提示） */
function askXiaowu(it: InboxItem) {
  if (!chat.configured || !it.risk) return
  chat.show()
  void chat.send(it.risk.action)
}
/** 状态条「让小吴排一下」：把今天的风险概况交给小吴排出处理顺序与节奏 */
function askXiaowuToPlan() {
  if (!chat.configured) return
  const s = summary.value
  const parts = [
    s.overdue && `${s.overdue} 项逾期`,
    s.dueSoon && `${s.dueSoon} 项今明到期`,
    s.stalled && `${s.stalled} 项停滞`,
  ]
    .filter(Boolean)
    .join('、')
  // 有风险 → 排处理顺序；清闲 → 看看怎么安排顺手
  const body = parts
    ? `今天有 ${parts}，帮我排出处理顺序和节奏，先点名最该收的。`
    : '我手头这几项都没有紧迫的，帮我看看今天怎么安排比较顺手。'
  chat.show()
  void chat.send(body)
}
/** 「小吴的洞察」卡 → 让小吴就这条洞察展开分析（带上下文） */
function askXiaowuInsight(ins?: Insight) {
  if (!chat.configured || !ins) return
  chat.show()
  void chat.send(ins.action)
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
  return kind === 'task' ? '任务' : kind === 'bug' ? 'Bug' : '本地'
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
      riskLabel: it.risk?.label ?? (isUrgent(it) ? '紧急' : '稳定'),
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

// ============ 生命周期：按需加载禅道指派项 ============
onMounted(() => {
  if (taskStore.configured) taskStore.loadAssigned()
  if (bugStore.configured) bugStore.loadAssigned()
})
onUnmounted(() => {
  taskStore.stop()
  bugStore.stop()
})
</script>

<template>
  <section class="zt-panel" :class="{ 'is-orbit-view': activeView === 'orbit' }">
    <!-- 头部 -->
    <header class="zt-head">
      <div class="zt-head-main">
        <span class="zt-pulse" :class="{ 'is-active': total > 0, 'is-urgent': urgentCount > 0 }" />
        <h2 class="text-white/90 text-sm font-medium">统一收件箱</h2>
        <span
          v-if="total"
          class="tabular-nums text-[11px] font-medium px-1.5 py-0.5 rounded-full text-teal-200 bg-teal-400/15 ring-1 ring-teal-400/25"
        >{{ total }}</span>
        <span
          v-if="urgentCount > 0"
          class="tabular-nums text-[11px] font-medium px-1.5 py-0.5 rounded-full text-rose-200 bg-rose-400/15 ring-1 ring-rose-400/25"
        >{{ urgentCount }} 紧急</span>
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
          {{ tab.label }}
        </button>
      </nav>

      <div class="zt-head-actions">
        <button
          v-if="localStore.doneCount"
          class="text-[11px] text-white/40 hover:text-rose-300/90 transition-colors"
          title="清除所有已完成"
          @click="localStore.clearDone()"
        >
          清除已完成 ({{ localStore.doneCount }})
        </button>
        <button
          class="flex items-center gap-1 px-2.5 h-7 rounded-md text-[12px] font-medium text-teal-100 bg-teal-400/15 ring-1 ring-teal-400/30 hover:bg-teal-400/25 transition-colors"
          title="新建本地待办"
          @click="openCreate"
        >
          <IconPlus class="w-3.5 h-3.5" />
          新建
        </button>
      </div>
    </header>

    <!-- 小吴已就绪：只要清单非空就常驻；有风险给出概况 + 点题，清闲时一句平稳收尾（无对话框，AI 先动） -->
    <div
      v-if="total > 0"
      class="zt-insight"
      :class="{ 'is-clickable': chat.configured, 'is-calm': summary.total === 0 }"
      :title="chat.configured ? '让小吴排出处理顺序' : ''"
      @click="askXiaowuToPlan"
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
        <span v-if="chat.configured" class="zt-insight-go">让小吴排一下 →</span>
      </template>
      <span v-else class="zt-insight-head">一切平稳，没有需要紧急处理的，按自己的节奏来。</span>
    </div>

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

    <!-- 加载中 -->
    <div v-if="loading" class="px-4 py-8 text-center text-sm text-white/45">
      {{ zentaoLoggingIn ? '正在登录禅道…' : '加载中…' }}
    </div>

    <!-- 禅道加载出错且清单无内容可兜底：占满提示 + 重试（本地待办存在时走下面的清单，不被遮蔽） -->
    <div
      v-else-if="hasError && total === 0"
      class="flex flex-col items-center gap-2 py-8 text-center"
    >
      <IconAlert class="w-7 h-7 text-rose-300/70" />
      <p class="text-sm text-white/55">{{ errorMessage }}</p>
      <button
        class="mt-1 px-3 h-7 rounded-md text-xs bg-white/10 text-white/80 hover:bg-white/15 transition-colors"
        @click="retryZentao"
      >
        重试
      </button>
    </div>

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

    <!-- 统一清单 -->
    <ul v-else class="zt-list-scroll">
      <template v-for="g in groups" :key="g.key">
        <!-- 需求线分组头（仅 ≥2 项的簇显示；可折叠） -->
        <li
          v-if="g.isCluster"
          class="zt-group-head"
          :style="{ '--thread': threadColor(g.label) }"
          @click="toggleGroup(g.key)"
        >
          <span class="zt-group-chev" :class="{ 'is-collapsed': !groupOpen(g.key) }">▾</span>
          <span class="zt-group-dot" />
          <span class="zt-group-label">需求线 · {{ g.label }}</span>
          <span class="zt-group-count">{{ g.items.length }}</span>
        </li>
        <!-- 组内条目（簇折叠时隐藏；其他组始终显示） -->
        <li
          v-for="it in g.items"
          :key="it.key"
          v-show="g.isCluster ? groupOpen(g.key) : true"
          class="zt-row"
          :class="{ 'is-urgent': isUrgent(it), 'is-clickable': it.kind !== 'local', 'in-thread': g.isCluster }"
          @click="onRowClick(it)"
        >
          <span v-if="g.isCluster" class="zt-thread-mark" :style="{ '--thread': threadColor(g.label) }" />
        <!-- 禅道任务 -->
        <template v-if="it.kind === 'task'">
          <IconCheckboxOutline class="w-4 h-4 text-sky-300/80 shrink-0" />
          <span class="zt-kind text-sky-200/90 bg-sky-400/10">任务</span>
          <span class="flex-1 min-w-0 truncate text-sm text-white/85">{{ (it.ref as ZentaoTask).name }}</span>
          <span
            v-if="it.risk"
            class="zt-risk"
            :class="[`is-${it.risk.level}`, { 'is-ask': chat.configured }]"
            :title="it.risk.why + (chat.configured ? '（点击让小吴跟进）' : '')"
            @click.stop="askXiaowu(it)"
          >
            <IconAlert v-if="it.risk.level === 'overdue'" class="w-3 h-3" />
            <IconCalendarClock v-else-if="it.risk.level === 'due-soon'" class="w-3 h-3" />
            <IconPause v-else class="w-3 h-3" />
            {{ it.risk.label }}
          </span>
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
            class="hidden sm:inline shrink-0 text-[11px] text-white/40 tabular-nums w-[4.5rem] text-right"
            :class="{ '!text-rose-300/80': ztIsOverdue((it.ref as ZentaoTask).deadline) }"
          >{{ (it.ref as ZentaoTask).deadline }}</span>
        </template>

        <!-- 禅道 Bug -->
        <template v-else-if="it.kind === 'bug'">
          <IconBug class="w-4 h-4 text-rose-300/80 shrink-0" />
          <span class="zt-kind text-rose-200/90 bg-rose-400/10">Bug</span>
          <span class="flex-1 min-w-0 truncate text-sm text-white/85">{{ (it.ref as ZentaoBug).title }}</span>
          <span
            v-if="it.risk"
            class="zt-risk"
            :class="[`is-${it.risk.level}`, { 'is-ask': chat.configured }]"
            :title="it.risk.why + (chat.configured ? '（点击让小吴跟进）' : '')"
            @click.stop="askXiaowu(it)"
          >
            <IconAlert v-if="it.risk.level === 'overdue'" class="w-3 h-3" />
            <IconCalendarClock v-else-if="it.risk.level === 'due-soon'" class="w-3 h-3" />
            <IconPause v-else class="w-3 h-3" />
            {{ it.risk.label }}
          </span>
          <span
            v-if="severityBadge((it.ref as ZentaoBug).severity)"
            class="zt-badge ring-1 ring-inset"
            :class="severityBadge((it.ref as ZentaoBug).severity)!.class"
          >{{ severityBadge((it.ref as ZentaoBug).severity)!.label }}</span>
          <span class="zt-badge ring-1 ring-inset" :class="bugStatusBadge((it.ref as ZentaoBug).status).class">
            {{ bugStatusBadge((it.ref as ZentaoBug).status).label }}
          </span>
        </template>

        <!-- 本地待办 -->
        <template v-else>
          <button
            class="zt-check"
            title="标记完成"
            @click.stop="localStore.toggle((it.ref as LocalTask).id)"
          >
            <IconCircle class="w-[18px] h-[18px]" />
          </button>
          <span class="zt-kind text-teal-200/90 bg-teal-400/10">本地</span>
          <div class="flex-1 min-w-0">
            <span
              class="zt-title truncate text-sm text-white/90 cursor-text block"
              :title="(it.ref as LocalTask).title"
              @click.stop="openEdit(it.ref as LocalTask)"
            >{{ (it.ref as LocalTask).title }}</span>
            <p v-if="(it.ref as LocalTask).note" class="zt-note truncate">{{ (it.ref as LocalTask).note }}</p>
          </div>
          <span
            v-if="it.risk"
            class="zt-risk"
            :class="[`is-${it.risk.level}`, { 'is-ask': chat.configured }]"
            :title="it.risk.why + (chat.configured ? '（点击让小吴跟进）' : '')"
            @click.stop="askXiaowu(it)"
          >
            <IconAlert v-if="it.risk.level === 'overdue'" class="w-3 h-3" />
            <IconCalendarClock v-else-if="it.risk.level === 'due-soon'" class="w-3 h-3" />
            <IconPause v-else class="w-3 h-3" />
            {{ it.risk.label }}
          </span>
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
        </template>
        </li>
      </template>

      <!-- 已完成（本地待办）折叠 -->
      <template v-if="localStore.doneCount">
        <li class="zt-done-head" @click="showDone = !showDone">
          <IconCheck class="w-3.5 h-3.5 text-teal-300/60" />
          <span class="text-[12px] text-white/45">已完成 {{ localStore.doneCount }}</span>
          <span class="zt-chevron text-white/30 transition-transform" :class="{ 'rotate-180': showDone }">▾</span>
        </li>
        <template v-if="showDone">
          <li
            v-for="t in localStore.done"
            :key="`done-${t.id}`"
            class="zt-row is-done"
          >
            <button class="zt-check" title="取消完成" @click.stop="localStore.toggle(t.id)">
              <IconCheck class="w-[18px] h-[18px] text-teal-300" />
            </button>
            <span class="flex-1 min-w-0 truncate text-sm text-white/40 line-through" :title="t.title">
              {{ t.title }}
            </span>
            <button
              class="zt-act"
              :class="{ 'is-confirm': pendingDelete === t.id }"
              :title="pendingDelete === t.id ? '再点一次确认删除' : '删除'"
              @click.stop="onDelete(t.id)"
            >
              <IconTrash v-if="pendingDelete !== t.id" class="w-4 h-4" />
              <IconCheck v-else class="w-4 h-4" />
            </button>
          </li>
        </template>
      </template>
    </ul>

    <!-- 详情 / 编辑弹窗 -->
    <TaskDetailModal />
    <BugDetailModal />
    <LocalTaskFormModal v-model:open="formOpen" :task="editing" @submit="onSubmit" />
  </section>
</template>

<style scoped>
.zt-panel {
  position: relative;
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 26px;
  border: 1px solid var(--hud-line);
  background:
    linear-gradient(180deg, rgba(2, 6, 23, 0.68), rgba(15, 23, 42, 0.42)),
    radial-gradient(circle at 80% 0, rgba(56, 189, 248, 0.14), transparent 34%),
    repeating-linear-gradient(0deg, rgba(125, 211, 252, 0.03) 0 1px, transparent 1px 32px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 24px 90px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px) saturate(130%);
}
.zt-panel.is-orbit-view {
  border-color: rgba(125, 211, 252, 0.12);
  background: rgba(2, 6, 23, 0.16);
  box-shadow: 0 24px 90px rgba(0, 0, 0, 0.28);
}
.zt-head {
  display: grid;
  grid-template-columns: minmax(190px, 1fr) auto minmax(160px, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--hud-line-soft);
  background: linear-gradient(90deg, rgba(2, 6, 23, 0.64), rgba(2, 6, 23, 0.2));
  backdrop-filter: blur(14px);
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
  border: 1px solid rgba(125, 211, 252, 0.14);
  border-radius: 999px;
  background: rgba(2, 6, 23, 0.24);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.16);
  backdrop-filter: blur(10px) saturate(120%);
  transform: translateX(-50%);
}
.zt-panel.is-orbit-view .zt-head-main h2,
.zt-panel.is-orbit-view .zt-head-main > span:not(.zt-pulse),
.zt-panel.is-orbit-view .zt-head-actions button:first-child {
  display: none;
}
.zt-panel.is-orbit-view .zt-head-actions {
  min-width: auto;
}
.zt-panel.is-orbit-view .zt-insight,
.zt-panel.is-orbit-view .zt-ic {
  display: none;
}
.zt-head-main,
.zt-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.zt-head-actions {
  justify-content: flex-end;
}
.zt-tabs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(2, 6, 23, 0.58);
  border: 1px solid rgba(125, 211, 252, 0.16);
}
.zt-tab {
  position: relative;
  height: 29px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  color: rgba(226, 232, 240, 0.5);
  cursor: pointer;
  transition: color 0.18s, background 0.18s, box-shadow 0.18s;
}
.zt-tab:hover { color: rgba(255,255,255,0.82); }
.zt-tab.is-active {
  color: #ecfeff;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.18), rgba(94, 234, 212, 0.12));
  box-shadow: 0 0 18px rgba(34, 211, 238, 0.18), inset 0 0 0 1px rgba(125, 211, 252, 0.26);
}
.zt-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.zt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(125, 211, 252, 0.08);
  transition: background-color 0.15s, box-shadow 0.15s;
}
.zt-row:last-child {
  border-bottom: 0;
}
.zt-row.is-clickable {
  cursor: pointer;
}
.zt-row:hover {
  background: rgba(125, 211, 252, 0.07);
  box-shadow: inset 2px 0 0 rgba(125, 211, 252, 0.46);
}
.zt-row.is-urgent {
  background: rgba(244, 63, 94, 0.04);
  border-left: 2px solid rgba(244, 63, 94, 0.5);
  padding-left: 14px;
}
.zt-row.is-urgent:hover {
  background: rgba(244, 63, 94, 0.08);
}
.zt-row.is-done {
  opacity: 0.7;
}
.zt-row.is-done:hover {
  opacity: 1;
}

/* 需求线分组头（可折叠） */
.zt-group-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 16px 6px;
  margin-top: 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.zt-group-head:hover { background: rgba(255, 255, 255, 0.04); }
.zt-group-chev { font-size: 10px; color: rgba(255, 255, 255, 0.4); transition: transform 0.15s; }
.zt-group-chev.is-collapsed { transform: rotate(-90deg); }
.zt-group-dot {
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: var(--thread);
  box-shadow: 0 0 6px var(--thread);
  flex-shrink: 0;
}
.zt-group-label {
  font-size: 11.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zt-group-count {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.4);
  padding: 0 6px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.06);
}

/* 簇内条目：左侧线索色细条，与分组头圆点呼应——即使被紧急度打散也「连成线」 */
.zt-thread-mark {
  flex-shrink: 0;
  width: 2px;
  align-self: stretch;
  margin: 3px 0;
  border-radius: 2px;
  background: var(--thread);
  opacity: 0.55;
}

.zt-kind {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 5px;
}
.zt-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
}

/* 小吴风险徽标（AI 预测：逾期 / 临期 / 停滞）；why 走 title，LLM 已配置时整枚可点 → 交给小吴 */
.zt-risk {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
}
.zt-risk.is-overdue { color: #fda4af; background: rgba(244, 63, 94, 0.12); box-shadow: inset 0 0 0 1px rgba(244, 63, 94, 0.3); }
.zt-risk.is-due-soon { color: #fcd34d; background: rgba(251, 191, 36, 0.1); box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.28); }
.zt-risk.is-stalled { color: #c4b5fd; background: rgba(139, 92, 246, 0.1); box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.25); }
.zt-risk.is-ask { cursor: pointer; transition: filter 0.15s, transform 0.15s; }
.zt-risk.is-ask:hover { filter: brightness(1.15); transform: translateY(-1px); }
/* 逾期且可交互时，给一个克制的呼吸脉冲，强化「最该先处理」的提示 */
.zt-risk.is-overdue.is-ask { animation: zt-risk-pulse 2.4s ease-in-out infinite; }
@keyframes zt-risk-pulse {
  0%, 100% { box-shadow: inset 0 0 0 1px rgba(244, 63, 94, 0.3); }
  50% { box-shadow: inset 0 0 0 1px rgba(244, 63, 94, 0.55), 0 0 0 3px rgba(244, 63, 94, 0.1); }
}
@media (prefers-reduced-motion: reduce) {
  .zt-risk.is-overdue.is-ask { animation: none; }
}

/* 「小吴已就绪」状态条：首页 AI 主动风险概况（玻璃渐变，区别于清单的 teal，与晨报卡同语言） */
.zt-insight {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 9px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: linear-gradient(120deg, rgba(129, 140, 248, 0.1), rgba(56, 189, 248, 0.04));
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
}
.zt-insight.is-clickable { cursor: pointer; transition: background 0.15s; }
.zt-insight.is-clickable:hover { background: linear-gradient(120deg, rgba(129, 140, 248, 0.18), rgba(56, 189, 248, 0.08)); }
/* 清闲态（无风险）：转 teal，呼应「一切平稳」 */
.zt-insight.is-calm { background: linear-gradient(120deg, rgba(45, 212, 191, 0.08), rgba(56, 189, 248, 0.03)); }
.zt-insight.is-calm .zt-insight-spark { color: #5eead4; background: rgba(45, 212, 191, 0.16); }
.zt-insight.is-calm.is-clickable:hover { background: linear-gradient(120deg, rgba(45, 212, 191, 0.14), rgba(56, 189, 248, 0.06)); }
.zt-insight-spark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: #a5b4fc;
  background: rgba(129, 140, 248, 0.18);
  flex-shrink: 0;
}
.zt-insight-name { font-weight: 600; color: rgba(255, 255, 255, 0.9); }
.zt-insight-stats { display: inline-flex; gap: 6px; }
.zt-insight-stats span { padding: 1px 6px; border-radius: 5px; font-weight: 500; }
.zt-insight-stats .is-overdue { color: #fda4af; background: rgba(244, 63, 94, 0.12); }
.zt-insight-stats .is-due { color: #fcd34d; background: rgba(251, 191, 36, 0.1); }
.zt-insight-stats .is-stall { color: #c4b5fd; background: rgba(139, 92, 246, 0.1); }
.zt-insight-head { color: rgba(255, 255, 255, 0.55); }
.zt-insight-go { margin-left: auto; color: #a5b4fc; flex-shrink: 0; }

/* 「小吴的洞察」卡：LLM 主动开口的深度发现（与状态条同语言，更突出） */
.zt-ic {
  padding: 0 16px 11px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: linear-gradient(120deg, rgba(129, 140, 248, 0.08), rgba(56, 189, 248, 0.03));
}
.zt-ic-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 0 7px;
}
.zt-ic-spark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: #a5b4fc;
  background: rgba(129, 140, 248, 0.18);
  flex-shrink: 0;
}
.zt-ic-title { font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.85); }
.zt-ic-refresh {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.zt-ic-refresh:hover:not(:disabled) { color: rgba(255, 255, 255, 0.85); background: rgba(255, 255, 255, 0.08); }
.zt-ic-refresh:disabled { cursor: default; }
.zt-ic-refresh.is-spinning svg { animation: zt-risk-spin 0.9s linear infinite; }
@keyframes zt-risk-spin { to { transform: rotate(360deg); } }

.zt-ic-body {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.78);
}

/* 检测模板列表（LLM 未配置 / 尚未生成时的兜底） */
.zt-ic-list { margin: 0; padding: 0; list-style: none; }
.zt-ic-list li {
  position: relative;
  padding: 3px 0 3px 14px;
  font-size: 12.5px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.75);
}
.zt-ic-bullet {
  position: absolute;
  left: 2px;
  top: 11px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(165, 180, 252, 0.7);
}

/* LLM 生成中骨架 */
.zt-ic-loading { display: flex; align-items: center; gap: 5px; padding: 2px 0; }
.zt-ic-loading-text { margin-left: 6px; font-size: 12.5px; color: rgba(255, 255, 255, 0.5); }
.zt-ic-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(165, 180, 252, 0.7);
  animation: zt-ic-bounce 1.2s ease-in-out infinite;
}
.zt-ic-dot:nth-child(2) { animation-delay: 0.15s; }
.zt-ic-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes zt-ic-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}

/* 「让小吴展开」入口 */
.zt-ic-foot { padding: 7px 0 0; }
.zt-ic-ask {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 7px;
  font-size: 11.5px;
  color: rgba(199, 210, 254, 0.85);
  background: rgba(129, 140, 248, 0.12);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.zt-ic-ask:hover { background: rgba(129, 140, 248, 0.22); color: #e0e7ff; }

@media (prefers-reduced-motion: reduce) {
  .zt-ic-refresh.is-spinning svg { animation: none; }
  .zt-ic-dot { animation: none; }
}
.zt-dl {
  flex-shrink: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}
.zt-dl.is-overdue {
  color: #fda4af;
}
.zt-att {
  flex-shrink: 0;
  align-items: center;
}

/* 本地待办：完成勾选圆 */
.zt-check {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: rgba(255, 255, 255, 0.4);
  border-radius: 9999px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.zt-check:hover {
  color: #5eead4;
  background: rgba(45, 212, 191, 0.12);
}
.zt-title {
  line-height: 1.3;
}
.zt-title:hover {
  color: #fff;
}
.zt-note {
  margin-top: 2px;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.4);
}

/* 行内操作（编辑 / 删除）：默认极淡，hover 行或自身才显形 */
.zt-act {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.25);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
  cursor: pointer;
}
.zt-row:hover .zt-act {
  opacity: 1;
}
.zt-act:hover {
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.08);
}
.zt-act.is-confirm {
  opacity: 1;
  color: #fda4af;
  background: rgba(244, 63, 94, 0.14);
}
.zt-act-edit {
  width: 20px;
  height: 20px;
}

/* 已完成折叠头 */
.zt-done-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.15s;
}
.zt-done-head:hover {
  background: rgba(255, 255, 255, 0.04);
}
.zt-chevron {
  margin-left: auto;
  font-size: 11px;
}

/* 空态 */
.zt-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 36px 16px;
  text-align: center;
}
.zt-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-bottom: 4px;
  border-radius: 9999px;
  color: #5eead4;
  background: rgba(45, 212, 191, 0.1);
  box-shadow: 0 0 22px rgba(45, 212, 191, 0.15);
}
.zt-empty-title {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.72);
}
.zt-empty-sub {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.4);
}
.zt-empty-create {
  margin-top: 4px;
  font-size: 12.5px;
  color: #5eead4;
}
.zt-empty-create:hover {
  color: #99f6e4;
}

/* 头部状态点 */
.zt-pulse {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: rgba(148, 163, 184, 0.5);
  flex-shrink: 0;
}
.zt-pulse.is-active {
  background: #2dd4bf;
  box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.6);
  animation: zt-ping 2s ease-out infinite;
}
.zt-pulse.is-urgent {
  background: #fb7185;
  box-shadow: 0 0 0 0 rgba(251, 113, 133, 0.6);
  animation: zt-ping-urgent 2s ease-out infinite;
}
@keyframes zt-ping {
  0% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.5); }
  70% { box-shadow: 0 0 0 7px rgba(45, 212, 191, 0); }
  100% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0); }
}
@keyframes zt-ping-urgent {
  0% { box-shadow: 0 0 0 0 rgba(251, 113, 133, 0.5); }
  70% { box-shadow: 0 0 0 7px rgba(251, 113, 133, 0); }
  100% { box-shadow: 0 0 0 0 rgba(251, 113, 133, 0); }
}
@media (max-width: 760px) {
  .zt-head {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
  .zt-tabs,
  .zt-head-actions {
    justify-content: flex-start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .zt-pulse.is-active,
  .zt-pulse.is-urgent { animation: none; }
}
</style>
