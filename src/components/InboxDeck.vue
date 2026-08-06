<script setup lang="ts">
/**
 * InboxDeck —— 首页视觉主角：把「统一收件箱」重做成浮在空间里、可翻动的 3D 玻璃卡堆。
 *
 * 数据完全来自真实 store（经 useInboxInsights 归一化）：
 *   - 边色 / 聚焦辉光 = 风险预测等级（逾期 / 临期 / 停滞 / 正常）；
 *   - 卡堆顺序 = 推荐处理序（风险严重度 → 优先级 → 截止日），非朴素列表序；
 *   - 默认聚焦 = 小吴挑的「此刻最该清的」（首条逾期，否则队首）——停在哪也是数据定的；
 *   - 主角卡上的动作 = 真实能力：禅道/Bug → 查看详情弹窗；本地 → 编辑/完成；全部 → 交给小吴。
 *
 * 环绕 HUD（方案 B，取代原左数据柱 + 顶部圆点 chip）：计数不独立占栏，全部收拢到舞台——
 *   顶部大总数 + 风险概况 / 三颗来源「卫星」（数量 count-up + 风险构成迷你条）/
 *   右下位置读数 / 全息底座刻度盘（与卡堆同处 3D 空间、独立倾斜垫在卡堆之下；
 *   一项一格可点跳卡、亮弧 = 进度、光点 = 当前位置）。
 * 交互：滚轮 / 上下拖拽 / ↑↓ / Home·End / 点侧卡 / 点底座刻度 翻动队列；标题可点直接看详情。
 * 本组件承担原 UnifiedInbox 的数据拉取触发 + 详情弹窗宿主，避免换视图丢能力。
 */
import { computed, ref, watch, onMounted, onBeforeUnmount, type CSSProperties } from 'vue'
import { useCountUp } from '@/composables/useCountUp'
import { useDeckTheme } from '@/composables/useDeckTheme'
import { useInboxInsights } from '@/features/insights'
import type { WorkItem } from '@/features/insights'
import { useChatStore } from '@/features/chat'
import { useTaskStore, useBugStore, TaskDetailModal, BugDetailModal } from '@/features/zentao'
import { useLocalTaskStore, MAX_ATTACHMENT_SIZE } from '@/features/local-tasks'
import { useFeedback } from '@/features/feedback'
import type { LocalTask, LocalTaskFormPayload } from '@/features/local-tasks'
import LocalTaskFormModal from '@/features/local-tasks/components/LocalTaskFormModal.vue'
import DeckViz from '@/components/viz/DeckViz.vue'

type RiskKey = 'overdue' | 'due-soon' | 'stalled' | 'ok'
const RISK: Record<RiskKey, { c: string; t: string }> = {
  overdue: { c: 'var(--color-danger)', t: '逾期' },
  'due-soon': { c: 'var(--color-warning)', t: '临期' },
  stalled: { c: 'var(--color-steel)', t: '停滞' },
  ok: { c: 'var(--color-alive)', t: '正常' },
}
const KIND_LABEL: Record<WorkItem['kind'], string> = { task: '任务', bug: 'Bug', local: '本地' }
/** 卡片主题色按来源区分：禅道任务绿 / Bug 红 / 本地待办蓝 */
const KIND_COLOR: Record<WorkItem['kind'], string> = {
  task: 'var(--color-alive)',
  bug: 'var(--color-danger)',
  local: 'var(--color-accent)',
}
const STATUS_LABEL: Record<string, string> = {
  doing: '进行中', wait: '待办', active: '进行中', open: '待办',
  done: '完成', resolved: '已解决', closed: '已关闭',
}
const RANK: Record<RiskKey, number> = { overdue: 3, 'due-soon': 2, stalled: 1, ok: 0 }

interface DeckItem {
  key: string
  /** 原始工作项 id（禅道任务/Bug 的 id、本地待办的 id）——详情弹窗 / 编辑 / 完成全靠它，漏掉会让详情请求打到 task-view-undefined 上 */
  id: string
  kind: WorkItem['kind']
  kindLabel: string
  title: string
  pri: number
  statusText: string
  thread: string
  deadline: string
  risk: RiskKey
  riskColor: string
  riskLabel: string
  /** 卡片主题色（按来源区分），驱动 --rc */
  kindColor: string
  why: string
  action: string
  filled: number
}

const { workItems, predictions } = useInboxInsights()
const chat = useChatStore()
const feedback = useFeedback()
const taskStore = useTaskStore()
const bugStore = useBugStore()
const localStore = useLocalTaskStore()

const deck = computed<DeckItem[]>(() => {
  const list: DeckItem[] = workItems.value.map((w) => {
    const p = predictions.value.get(`${w.kind}-${w.id}`)
    const risk: RiskKey = p ? p.level : 'ok'
    return {
      key: `${w.kind}-${w.id}`,
      id: w.id,
      kind: w.kind,
      kindLabel: KIND_LABEL[w.kind],
      title: w.title,
      pri: w.pri,
      statusText: STATUS_LABEL[w.status] ?? w.status,
      thread: w.thread ?? '',
      deadline: w.deadline && w.deadline !== '0000-00-00' ? w.deadline : '—',
      risk,
      riskColor: RISK[risk].c,
      riskLabel: RISK[risk].t,
      kindColor: KIND_COLOR[w.kind],
      why: p?.why ?? '当前无逾期 / 临期 / 停滞信号，按既有节奏推进即可。',
      action: p?.action ?? `帮我看一下「${w.title}」接下来怎么安排最合适。`,
      filled: Math.max(1, Math.min(4, 5 - w.pri)),
    }
  })
  list.sort((a, b) =>
    RANK[b.risk] - RANK[a.risk] ||
    a.pri - b.pri ||
    (a.deadline === '—' ? 1 : 0) - (b.deadline === '—' ? 1 : 0) ||
    a.deadline.localeCompare(b.deadline),
  )
  return list
})

const N = computed(() => deck.value.length)


// 队列可视化主题（f/g/h/i/j），由状态栏的 <DeckThemeSwitch> 切换，默认「j 弧面副卡」
const { current: theme } = useDeckTheme()

// 传给 DeckViz 的归一化工作项（含标题，供 J 弧面副卡显示序号 + 标题）
const vizItems = computed(() => deck.value.map((d) => ({ kind: d.kind, title: d.title })))

// ============ 环绕 HUD：大总数 / 风险概况 / 来源卫星（全部由 deck 派生，与卡堆天然同步） ============
const SOURCE_META = [
  { key: 'task' as const, label: '指派任务', color: 'var(--color-alive)' },
  { key: 'bug' as const, label: '待修 Bug', color: 'var(--color-danger)' },
  { key: 'local' as const, label: '本地待办', color: 'var(--color-accent)' },
]
/** 每个来源一颗「卫星」：总数 + 风险构成（逾期 / 临期 / 停滞 / 正常）迷你条 */
const satellites = computed(() =>
  SOURCE_META.map((m) => {
    const items = deck.value.filter((it) => it.kind === m.key)
    const seg: Record<RiskKey, number> = { overdue: 0, 'due-soon': 0, stalled: 0, ok: 0 }
    for (const it of items) seg[it.risk]++
    return { ...m, total: items.length, seg }
  }),
)
/** 卫星数字滚动（沿用旧左数据柱的 count-up 语言） */
const satCountUp = {
  task: useCountUp(() => deck.value.filter((it) => it.kind === 'task').length),
  bug: useCountUp(() => deck.value.filter((it) => it.kind === 'bug').length),
  local: useCountUp(() => deck.value.filter((it) => it.kind === 'local').length),
}
const riskSummary = computed(() => {
  const r = { overdue: 0, 'due-soon': 0, stalled: 0 }
  for (const it of deck.value) if (it.risk !== 'ok') r[it.risk]++
  return r
})
const hasRiskItems = computed(
  () => riskSummary.value.overdue + riskSummary.value['due-soon'] + riskSummary.value.stalled > 0,
)

const active = ref(0)
const interacted = ref(false)
const sceneRef = ref<HTMLElement | null>(null)

// 默认聚焦 = 首条逾期（最该先清的），否则队首；数据到位后只初始化一次，之后不抢用户选择
let initialized = false
watch(
  deck,
  (d) => {
    if (!d.length) { active.value = 0; return }
    if (active.value > d.length - 1) active.value = d.length - 1
    if (!initialized) {
      const i = d.findIndex((x) => x.risk === 'overdue')
      active.value = i >= 0 ? i : 0
      initialized = true
    }
  },
  { immediate: true },
)

function itemStyle(idx: number): CSSProperties {
  const off = idx - active.value
  const abs = Math.abs(off)
  const it = deck.value[idx]
  if (abs > 2) {
    return {
      '--rc': it.kindColor,
      opacity: 0,
      filter: 'blur(4px)',
      pointerEvents: 'none',
      transform: `translate(-50%,-50%) translateY(${off * 94}px) translateZ(-760px)`,
      zIndex: 0,
    } as CSSProperties
  }
  const z = off === 0 ? 320 : -(abs === 1 ? 120 : 210)
  const ty = off * 94
  const ry = -off * 1.7
  const rx = off === 0 ? 0 : Math.max(-9, Math.min(9, -off * 3))
  const sc = off === 0 ? 1.07 : 1 - abs * 0.035
  const op = off === 0 ? 1 : abs === 1 ? 0.84 : 0.55
  const bl = off === 0 ? 0 : abs === 1 ? 0.6 : 1.6
  return {
    '--rc': it.kindColor,
    opacity: op,
    filter: `blur(${bl}px)`,
    pointerEvents: off === 0 ? 'default' : 'auto',
    transform: `translate(-50%,-50%) translateY(${ty}px) translateZ(${z}px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${sc})`,
    zIndex: 100 - abs,
  } as CSSProperties
}

function setActive(i: number) {
  const n = N.value
  if (n === 0) return
  // 循环滚动：到头不停止，末卡继续翻 → 回首页，首卡往回翻 → 末尾
  const c = ((i % n) + n) % n
  if (c === active.value) return
  active.value = c
  interacted.value = true
}
const next = () => setActive(active.value + 1)
const prev = () => setActive(active.value - 1)

function onCardClick(idx: number) {
  // 位移超阈值后，这次 click 是拖拽翻页的尾迹——吞掉，避免松手时误切到指尖下的卡片
  if (movedTotal > 10) return
  if (idx !== active.value) setActive(idx)
}

// ============ 真实能力：详情 / 本地编辑·完成 / 新建 / 交给小吴 ============
function openDetailFor(it: DeckItem) {
  if (it.kind === 'task') taskStore.openDetail(it.id)
  else if (it.kind === 'bug') bugStore.openDetail(it.id)
  else openLocalEdit(it)
}
const formOpen = ref(false)
const editing = ref<LocalTask | null>(null)
function openLocalEdit(it: DeckItem) {
  editing.value = localStore.tasks.find((t) => String(t.id) === it.id) ?? null
  formOpen.value = true
}
function openCreate() {
  editing.value = null
  formOpen.value = true
}
function completeLocal(it: DeckItem) {
  localStore.toggle(it.id)
}
async function onSubmit(payload: LocalTaskFormPayload) {
  // 与旧 UnifiedInbox 同口径：编辑=先删附件再更新再加附件；新建= add 后加附件
  const id = editing.value?.id
  if (id) {
    const base = { title: payload.title, note: payload.note, pri: payload.pri, deadline: payload.deadline }
    for (const attId of payload.removeAttachmentIds) await localStore.removeAttachment(id, attId)
    localStore.update(id, base)
    for (const file of payload.newFiles) await localStore.addAttachment(id, file)
  } else {
    const created = localStore.add({ title: payload.title, note: payload.note, pri: payload.pri, deadline: payload.deadline })
    if (created) for (const file of payload.newFiles) await localStore.addAttachment(created.id, file)
  }
  formOpen.value = false
}
function handoff(it: DeckItem) {
  try {
    chat.show()
    void chat.send(it.action)
  } catch {
    /* 小吴未就绪时静默，不破坏 3D 视图 */
  }
}
function openChat() {
  try {
    chat.show()
  } catch {
    /* 小吴未就绪时静默，不破坏 3D 视图 */
  }
}

// ============ 空态卡槽交互：点击新建 / 拖放创建 ============
// 「把今天的事丢进来」不是装饰：点卡槽开新建弹窗；拖文字 / 文件进来直接立成一张本地卡。
const dropHot = ref(false)
let dropDepth = 0
function onDropEnter() {
  dropDepth++
  dropHot.value = true
}
function onDropLeave() {
  dropDepth = Math.max(0, dropDepth - 1)
  if (dropDepth === 0) dropHot.value = false
}
function onDropOver(e: DragEvent) {
  e.preventDefault()
  dropHot.value = true
}
async function onDrop(e: DragEvent) {
  e.preventDefault()
  dropHot.value = false
  dropDepth = 0
  const files = Array.from(e.dataTransfer?.files ?? [])
  const text = (e.dataTransfer?.getData('text/plain') ?? '').trim()
  // 与新建弹窗同一套边界：单文件 ≤ MAX_ATTACHMENT_SIZE，超限跳过；全部超限则不建空附件卡
  const valid = files.filter((f) => f.size <= MAX_ATTACHMENT_SIZE)
  const skipped = files.length - valid.length
  let created = false
  let createdId = ''
  let progressToast: number | null = null
  if (valid.length) {
    const task = localStore.add({ title: text || '拖入的附件', pri: 3 })
    if (task) {
      created = true
      createdId = task.id
      // 多文件 / 大体量文件写入耗时，先亮进度 toast；单文件秒写不闪进度
      const totalBytes = valid.reduce((sum, f) => sum + f.size, 0)
      if (valid.length > 1 || totalBytes > 2 * 1024 * 1024) {
        progressToast = feedback.info({
          title: '正在写入附件…',
          message: `0 / ${valid.length}`,
          duration: 0,
        })
      }
      try {
        for (let i = 0; i < valid.length; i++) {
          await localStore.addAttachment(task.id, valid[i])
          if (progressToast !== null) {
            feedback.updateToast(progressToast, { message: `${i + 1} / ${valid.length}` })
          }
        }
      } catch { /* 附件落库失败不阻塞建卡 */ }
    }
  } else if (text) {
    const t = localStore.add({ title: text.slice(0, 100), pri: 3 })
    created = !!t
    createdId = t?.id ?? ''
  } else if (!skipped) {
    openCreate()
    return
  }
  // 拖入成功：自动翻到新卡堆顶部（聚焦刚立起来的那张卡）
  if (created && createdId) {
    const idx = deck.value.findIndex((it) => it.kind === 'local' && it.id === createdId)
    if (idx >= 0) setActive(idx)
  }
  // 进度 toast 无论是否混有超限文件都要收尾成成功态，避免 duration:0 永久停留
  if (progressToast !== null) {
    feedback.updateToast(progressToast, {
      title: '已立成一张本地卡',
      message: text ? `「${text.slice(0, 18)}${text.length > 18 ? '…' : ''}」` : `附件已就位（${valid.length} 个）`,
      tone: 'success',
      duration: 4200,
    })
  }
  if (skipped) {
    feedback.warning({
      title: `${skipped} 个文件超过 ${Math.round(MAX_ATTACHMENT_SIZE / 1024 / 1024)}MB，已跳过`,
      message: '单个附件上限 25MB，超大文件建议放网盘后把链接写进备注。'
    })
  } else if (!created && !progressToast) {
    // 既没建卡也没亮进度（纯文字拖入失败兜底），无事发生
  } else if (created && progressToast === null) {
    feedback.success({
      title: '已立成一张本地卡',
      message: text ? `「${text.slice(0, 18)}${text.length > 18 ? '…' : ''}」` : '文件已作为附件挂上',
    })
  }
}

// 滚轮需 passive:false 才能 preventDefault，故手动绑定。
// 舞台是 v-if="N" 条件渲染：首挂载时数据往往未到（N=0，sceneRef 为 null），
// 数据清空再回填时场景也会销毁重建——只在 onMounted 绑一次会永久错过，
// 故跟随 ref 生命周期绑定/解绑（watch 在元素替换时先解旧、再绑新）。
watch(sceneRef, (el, oldEl) => {
  if (oldEl) oldEl.removeEventListener('wheel', onWheel)
  if (el) el.addEventListener('wheel', onWheel, { passive: false })
})
function onWheel(e: WheelEvent) {
  e.preventDefault()
  acc += e.deltaY
  if (acc > 38) { next(); acc = 0 }
  else if (acc < -38) { prev(); acc = 0 }
  interacted.value = true
}
let acc = 0
let down = false
let sy = 0          // 翻页阈值基线（每次翻页后重置，支持一次拖动连续翻多张）
let dy = 0
let lastY = 0       // 上一帧指针 Y，用于累计真实位移
let movedTotal = 0  // 本次拖动累计位移：抑制拖尾点击 + 判定 interacted

/**
 * 拖拽视觉回显：卡堆整体跟手位移（橡皮筋：45% 阻尼 + 84px 上限）。
 * 翻页瞬间 / 松手时归零，非按压态带弹簧回位过渡——「粘手且有重量」。
 */
const dragging = ref(false)
const dragY = ref(0)
const dragStyle = computed(() => ({ '--drag-y': `${dragY.value}px` }))

function onDown(e: PointerEvent) {
  // 按钮 / 链接是点击手势，不发起拖动（查看详情 / 交给小吴 / 新建 / 圆点导航）
  const t = e.target as HTMLElement | null
  if (t?.closest('button, a')) return
  down = true
  sy = lastY = e.clientY
  dy = 0
  movedTotal = 0
  dragging.value = true
}
function onMove(e: PointerEvent) {
  if (!down) return
  movedTotal += Math.abs(e.clientY - lastY)
  lastY = e.clientY
  dy = e.clientY - sy
  dragY.value = Math.sign(dy) * Math.min(Math.abs(dy) * 0.45, 84)
  if (dy > 58) { next(); sy = e.clientY; dy = 0; dragY.value = 0 }
  else if (dy < -58) { prev(); sy = e.clientY; dy = 0; dragY.value = 0 }
}
function onUp() {
  if (!down) return
  down = false
  dragging.value = false
  dragY.value = 0
  if (movedTotal > 4) interacted.value = true
}
function onKey(e: KeyboardEvent) {
  // 焦点在表单控件内时不截获方向键（输入框光标移动 / 弹窗表单优先，不抢给卡堆）
  const t = e.target as HTMLElement | null
  if (t?.closest('input, textarea, select, [contenteditable]')) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') { next(); e.preventDefault() }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') { prev(); e.preventDefault() }
  else if (e.key === 'Home') setActive(0)
  else if (e.key === 'End') setActive(N.value - 1)
}

onMounted(() => {
  // 承担原 UnifiedInbox 的数据拉取触发（store 不自加载）；门控口径与原实现一致
  if (taskStore.configured) void taskStore.loadAssigned()
  if (bugStore.configured) void bugStore.loadAssigned()
  // wheel 监听由 watch(sceneRef) 跟随舞台 v-if 生命周期绑定，不在此处一次性绑定
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKey)
  // 校验钩子（仅 dev 用，便于无头断言 3D/数据联动）
  ;(window as unknown as Record<string, unknown>).__deck = {
    getActive: () => active.value,
    setActive: (i: number) => setActive(i),
    title: () => deck.value[active.value]?.title ?? '',
    count: () => N.value,
    openDetail: () => { const it = deck.value[active.value]; if (it) openDetailFor(it) },
  }
})
onBeforeUnmount(() => {
  sceneRef.value?.removeEventListener('wheel', onWheel)
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('keydown', onKey)
  delete (window as unknown as Record<string, unknown>).__deck
})
</script>

<template>
  <div v-if="N" class="deck-root">
    <!-- 3D 舞台（.deck-drag 为拖拽跟手层：只承担跟手位移，与内层 drift 动画的 transform 互不占用） -->
    <div ref="sceneRef" class="deck-scene" :class="{ dragging }" @pointerdown="onDown">
      <!-- 队列可视化：5 种真 3D 结构（轨道光珠 / 螺旋天梯 / 纵深回廊 / 全息晶柱 / 弧面副卡），按主题切换 -->
      <DeckViz :items="vizItems" :active="active" :theme="theme" @jump="setActive" />
      <div class="deck-drag" :style="dragStyle">
      <div class="deck-stack">
        <div
          v-for="(it, idx) in deck"
          :key="it.key"
          class="c3"
          :class="{ 'is-active': idx === active }"
          :style="itemStyle(idx)"
          @click="onCardClick(idx)"
        >
          <span class="edge" />
          <span class="focus">FOCUS</span>
          <span class="tag"><span class="d" />{{ it.kindLabel }}<template v-if="it.thread"> · {{ it.thread }}</template></span>
          <div class="ttl" title="查看详情" @click.stop="openDetailFor(it)">{{ it.title }}</div>
          <div class="meta">
            <span class="pri-meter" aria-label="优先级">
              <i v-for="n in 4" :key="n" :class="{ lit: n <= it.filled }" />
            </span>
            <span class="pri">P{{ it.pri }} · {{ it.statusText }}</span>
          </div>

          <!-- 数据 + 真实操作：仅聚焦卡揭示 -->
          <div class="only-active">
            <div class="dl">
              <div class="r"><span>风险</span><b :style="{ color: it.riskColor }">{{ it.riskLabel }}</b></div>
              <div class="r"><span>截止</span><b>{{ it.deadline }}</b></div>
              <div class="r"><span>状态</span><b>{{ it.statusText }}</b></div>
            </div>
            <div class="ai">
              <div class="h"><span class="d" />小吴的判断</div>
              <div class="why">{{ it.why }}</div>
              <div class="act">→ {{ it.action }}</div>
            </div>
            <div class="acts">
              <button v-if="it.kind !== 'local'" type="button" class="gbtn" @click="openDetailFor(it)">查看详情</button>
              <template v-else>
                <button type="button" class="gbtn" @click="openLocalEdit(it)">编辑</button>
                <button type="button" class="gbtn ok" @click="completeLocal(it)">完成</button>
              </template>
              <button type="button" class="gbtn ghost" @click="handoff(it)">交给小吴</button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>

    <!-- 大总数 + 风险概况 -->
    <div class="deck-total">
      <b>{{ N }}</b>
      <span>项在队列</span>
      <em v-if="hasRiskItems">
        <i class="c-danger">逾期 {{ riskSummary.overdue }}</i> · <i class="c-warn">临期 {{ riskSummary['due-soon'] }}</i> · <i class="c-steel">停滞 {{ riskSummary.stalled }}</i>
      </em>
      <em v-else class="c-alive">全部节奏正常</em>
    </div>
    <button type="button" class="deck-add" title="新建本地待办" @click="openCreate">+ 新建</button>

    <!-- 三颗来源卫星（数量 count-up + 风险构成迷你条）；数量为 0 的来源不显示 -->
    <div class="deck-sats">
      <div
        v-for="(s, i) in satellites"
        v-show="s.total > 0"
        :key="s.key"
        class="sat"
        :class="`s${i + 1}`"
        :style="{ '--c': s.color }"
      >
        <span class="lb"><i />{{ s.label }}</span>
        <b>{{ satCountUp[s.key].value }}</b>
        <span class="mini">
          <i v-if="s.seg.overdue" :style="{ flex: s.seg.overdue, background: 'var(--color-danger)' }" />
          <i v-if="s.seg['due-soon']" :style="{ flex: s.seg['due-soon'], background: 'var(--color-warning)' }" />
          <i v-if="s.seg.stalled" :style="{ flex: s.seg.stalled, background: 'var(--color-steel)' }" />
          <i v-if="s.seg.ok" class="ok" :style="{ flex: s.seg.ok }" />
        </span>
      </div>
    </div>

    <!-- 当前位置读数 -->
    <div class="deck-pos">
      <span>当前位置</span>
      <b>{{ String(active + 1).padStart(2, '0') }}<i>/{{ String(N).padStart(2, '0') }}</i></b>
    </div>
  </div>

  <!-- 空态：方案 B「漂浮空卡槽」—— 复用同一套 3D 倾斜卡堆（deck-drift + translateZ 视差），
       卡面换成 3 张「掏空的卡槽」：聚焦槽 alive 绿边框 + 发光上沿 + 上升光柱 + 虚线投放区，
       暗示「新指派会在这里立起来」。背景槽依次退后、淡出。 -->
  <div v-else class="deck-root is-empty">
    <div ref="sceneRef" class="deck-scene" :class="{ dragging }">
      <div class="deck-drag" :style="dragStyle">
        <div class="deck-stack">
          <div class="floor" aria-hidden="true" />
          <div class="slot s1" aria-hidden="true" />
          <div class="slot s2" aria-hidden="true" />
          <div
            class="slot top"
            :class="{ hot: dropHot }"
            role="button"
            tabindex="0"
            aria-label="把今天的事丢进来，新建本地待办"
            @click="openCreate"
            @keydown.enter.prevent="openCreate"
            @keydown.space.prevent="openCreate"
            @dragenter.prevent="onDropEnter"
            @dragover.prevent="onDropOver"
            @dragleave="onDropLeave"
            @drop.prevent="onDrop"
          >
            <span class="rim" aria-hidden="true" />
            <div class="beam" aria-hidden="true" />
            <span class="slot-tag"><i />Empty slot · 待接收</span>
            <div class="drop">
              <span class="drop-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
              <p class="drop-t">把今天的事丢进来</p>
              <p class="drop-s">{{ dropHot ? '松手 · 立成一张卡' : '点击新建 · 或拖入文字 / 文件' }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 说明文字 + 双按钮：纯文字，无背景板，不抢卡槽的视差 -->
    <div class="de-overlay">
      <div class="de-led" aria-hidden="true" />
      <div class="de-t">收件箱已清空</div>
      <div class="de-s">小吴待命 · 有新指派会<b>在这里立起来</b></div>
      <div class="de-actions">
        <button type="button" class="gbtn primary" @click="openCreate">+ 新建本地待办</button>
        <button type="button" class="gbtn ghost" @click="openChat">叫小吴聊聊</button>
      </div>
    </div>
  </div>

  <!-- 详情 / 编辑弹窗宿主（原 UnifiedInbox 承担，换视图后由本组件挂载，避免丢能力） -->
  <TaskDetailModal />
  <BugDetailModal />
  <LocalTaskFormModal v-model:open="formOpen" :task="editing" @submit="onSubmit" />
</template>

<style scoped>
.deck-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 460px;
  display: grid;
  place-items: center;
  /* 抑制系统级文字选中：拖拽翻卡时不再出现「框选高亮」，观感干净 */
  user-select: none;
  -webkit-user-select: none;
}
.deck-scene {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  perspective: 1500px;
  perspective-origin: 50% 42%;
  touch-action: none;
  cursor: grab;
  /* 整体上移 + 随视口缩放：大屏不至于过小、小屏不至于拥挤 */
  --deck-scale: clamp(0.62, 0.58 + 100vh * 0.00038, 1);
  --deck-lift: clamp(11vh, 16vh, 120px);
}
.deck-scene.dragging,
.deck-scene.dragging * { cursor: grabbing; }
/* 拖拽跟手层：translateY 跟手位移；preserve-3d 把舞台透视链透传给内层卡堆 */
.deck-drag {
  transform-style: preserve-3d;
  transform: translateY(calc(var(--drag-y, 0px) - var(--deck-lift, 0px))) scale(var(--deck-scale, 1));
  transform-origin: center top;
}
/* 非按压态才带弹簧回位（翻页瞬间 / 松手归零）；按压中禁用过渡，避免跟手延迟 */
.deck-scene:not(.dragging) .deck-drag {
  transition: transform 0.42s var(--ease-out-expo);
}
.deck-stack {
  position: relative;
  width: 480px;
  height: 480px;
  transform-style: preserve-3d;
  transform: rotateX(15deg) rotateY(-21deg) rotateZ(1.5deg);
  animation: deck-drift 12s ease-in-out infinite alternate;
}
@keyframes deck-drift {
  from { transform: rotateX(15deg) rotateY(-21deg) rotateZ(1.5deg) translateY(-8px); }
  to { transform: rotateX(9deg) rotateY(-15deg) rotateZ(-2.5deg) translateY(8px); }
}

.c3 {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 430px;
  border-radius: 17px;
  padding: 15px 17px 15px 20px;
  overflow: hidden;
  cursor: pointer;
  background: linear-gradient(155deg, #141b29 0%, #0d1320 100%);
  border: 1px solid color-mix(in srgb, var(--rc) 26%, rgba(255, 255, 255, 0.1));
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 24px 60px -22px rgba(0, 8, 16, 0.75),
    0 0 34px -8px color-mix(in srgb, var(--rc) 32%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  transition:
    transform 0.62s var(--ease-out-expo),
    opacity 0.42s var(--ease-out-expo),
    filter 0.42s var(--ease-out-expo),
    box-shadow 0.42s, border-color 0.42s;
  will-change: transform, opacity;
}
.c3 .edge {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: var(--rc, var(--color-steel));
  box-shadow: 0 0 16px var(--rc, var(--color-steel));
}
.c3 .tag {
  display: inline-flex; align-items: center; gap: 6px;
  font: 600 10px/1 var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--color-ink-2); padding: 3px 8px; border-radius: 6px;
  border: 1px solid var(--color-line); background: rgba(255, 255, 255, 0.05);
}
.c3 .tag .d { width: 6px; height: 6px; border-radius: 50%; background: var(--rc); box-shadow: 0 0 8px var(--rc); }
.c3 .ttl {
  font-size: 15px; font-weight: 600; margin: 11px 0 10px; color: var(--color-ink); line-height: 1.3;
  cursor: pointer; border-radius: 4px; transition: color 0.2s;
}
.c3 .ttl:hover { color: var(--rc); text-decoration: underline; }
.c3 .meta { display: flex; align-items: center; gap: 9px; }
.pri-meter { display: inline-flex; gap: 3px; }
.pri-meter i { width: 14px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.14); }
.pri-meter i.lit { background: var(--rc); box-shadow: 0 0 6px color-mix(in srgb, var(--rc) 50%, transparent); }
.c3 .pri { font: 600 10px/1 var(--font-mono); color: var(--color-ink-2); }
.c3 .focus {
  position: absolute; right: 15px; top: 15px;
  display: inline-flex; align-items: center; gap: 5px;
  font: 700 9px/1 var(--font-mono); letter-spacing: 0.2em; color: var(--rc);
  opacity: 0; transition: opacity 0.3s;
}
/* FOCUS 标签脉动 LED：与 card-breath 同频（4.5s），给小吴「正在监视」的潜意识信号 */
.c3 .focus::before {
  content: '';
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--rc);
  box-shadow: 0 0 6px var(--rc);
  animation: focus-led 3s ease-in-out infinite;
}
@keyframes focus-led {
  0%, 100% { opacity: 0.35; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.15); }
}

.c3 .only-active { display: none; }
.c3 .dl { display: flex; flex-direction: column; gap: 6px; margin: 13px 0 2px; font-size: 11.5px; color: var(--color-ink-2); }
.c3 .dl .r { display: flex; justify-content: space-between; gap: 10px; }
.c3 .dl .r b { color: var(--color-ink); font-weight: 600; }
.c3 .ai { margin-top: 11px; border-top: 1px solid var(--color-line); padding-top: 10px; }
.c3 .ai .h {
  display: flex; align-items: center; gap: 6px;
  font: 700 9px/1 var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--rc);
}
.c3 .ai .h .d { width: 6px; height: 6px; border-radius: 50%; background: var(--rc); box-shadow: 0 0 8px var(--rc); animation: deck-ping 2s ease-in-out infinite; }
.c3 .ai .why { font-size: 12.5px; color: var(--color-ink); margin: 7px 0 4px; line-height: 1.5; }
.c3 .ai .act { font-size: 11.5px; color: var(--rc); line-height: 1.45; }
.c3 .acts { display: flex; gap: 8px; margin-top: 12px; }
.c3 .gbtn {
  flex: 1 1 0; padding: 9px 6px; border-radius: 10px; cursor: pointer;
  font: 600 11px/1 var(--font-mono); letter-spacing: 0.04em; color: var(--color-accent-contrast);
  background: linear-gradient(180deg, var(--color-accent-strong), var(--color-accent));
  border: 1px solid transparent;
  box-shadow: 0 8px 20px -8px color-mix(in srgb, var(--color-accent) 70%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transition: transform 0.12s, box-shadow 0.2s, filter 0.2s;
}
.c3 .gbtn:hover { filter: brightness(1.08); box-shadow: 0 10px 26px -8px color-mix(in srgb, var(--color-accent) 80%, transparent), 0 0 18px -4px color-mix(in srgb, var(--color-accent) 60%, transparent); }
.c3 .gbtn:active { transform: scale(0.97); }
.c3 .gbtn.ok { color: var(--color-alive); background: color-mix(in srgb, var(--color-alive) 14%, transparent); border-color: color-mix(in srgb, var(--color-alive) 40%, transparent); box-shadow: none; }
.c3 .gbtn.ok:hover { background: color-mix(in srgb, var(--color-alive) 22%, transparent); }
.c3 .gbtn.ghost { color: var(--color-ink-2); background: rgba(255, 255, 255, 0.05); border-color: var(--color-line); box-shadow: none; }
.c3 .gbtn.ghost:hover { color: var(--color-ink); background: rgba(255, 255, 255, 0.09); }

.c3.is-active {
  cursor: default; width: 468px; padding: 18px 20px 18px 23px;
  background: linear-gradient(155deg, color-mix(in srgb, var(--rc) 16%, #141b29) 0%, #0c1420 100%);
  border-color: color-mix(in srgb, var(--rc) 48%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--rc) 44%, transparent),
    0 30px 80px -20px rgba(0, 8, 16, 0.82),
    0 0 64px -4px color-mix(in srgb, var(--rc) 55%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
  animation: card-breath 3s ease-in-out infinite;
}
/* 主动态呼吸：闲置时辉光缓慢「充放」，给主角卡一个活着的心跳；
   与 deck-drift（12s）周期互质，避免形成可感知的拍频 */
@keyframes card-breath {
  0%, 100% {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--rc) 44%, transparent),
      0 30px 80px -20px rgba(0, 8, 16, 0.82),
      0 0 52px -4px color-mix(in srgb, var(--rc) 45%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.32);
  }
  50% {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--rc) 44%, transparent),
      0 30px 80px -20px rgba(0, 8, 16, 0.82),
      0 0 72px -4px color-mix(in srgb, var(--rc) 70%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.32);
  }
}
.c3.is-active .focus { opacity: 1; }
.c3.is-active .ttl { font-family: var(--font-display); font-size: 19px; letter-spacing: -0.01em; }
.c3.is-active .tag { color: var(--rc); border-color: color-mix(in srgb, var(--rc) 38%, transparent); background: color-mix(in srgb, var(--rc) 14%, transparent); }
.c3.is-active .only-active { display: block; }

/* ============ 环绕 HUD（方案 B） ============ */
/* 大总数 + 风险概况 */
.deck-total {
  position: absolute; top: -42px; left: 50%; transform: translateX(-50%) translateY(calc(-1 * var(--deck-lift, 0px))); z-index: 5;
  display: grid; grid-template-columns: auto auto; align-items: center; column-gap: 13px;
  pointer-events: none; text-align: left;
}
.deck-total b {
  grid-row: 1 / 3;
  font: 700 46px/1 var(--font-display); letter-spacing: -0.03em; color: var(--color-ink);
  text-shadow: 0 0 30px color-mix(in srgb, var(--color-accent) 35%, transparent);
}
.deck-total span { font: 500 11px var(--font-mono); letter-spacing: 0.18em; color: var(--color-ink-2); }
.deck-total em { margin-top: 4px; font: 500 10.5px var(--font-mono); font-style: normal; color: var(--color-ink-3); white-space: nowrap; }
.deck-total em i { font-style: normal; }
.c-danger { color: var(--color-danger); }
.c-warn { color: var(--color-warning); }
.c-steel { color: var(--color-steel); }
.c-alive { color: var(--color-alive); }

/* 新建入口 */
.deck-add {
  position: absolute; top: 16px; right: 22%; z-index: 5;
  transform: translateY(calc(-1 * var(--deck-lift, 0px)));
  padding: 8px 13px; border-radius: 999px; cursor: pointer;
  font: 600 10.5px var(--font-mono); color: var(--color-accent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 36%, transparent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  transition: background 0.2s, color 0.2s;
}
.deck-add:hover { background: color-mix(in srgb, var(--color-accent) 20%, transparent); color: var(--color-accent-strong); }

/* 来源卫星（窄屏改底部横排，见媒体查询） */
.deck-sats { display: contents; }
.sat {
  position: absolute; z-index: 5; display: flex; flex-direction: column; gap: 5px; min-width: 118px;
  padding: 11px 14px 12px; border-radius: 13px;
  border: 1px solid color-mix(in srgb, var(--c, var(--color-accent)) 34%, var(--color-line));
  background: linear-gradient(160deg, rgba(20, 27, 41, 0.92), rgba(14, 20, 34, 0.92));
  box-shadow: 0 14px 34px -16px rgba(0, 8, 16, 0.8), 0 0 22px -8px color-mix(in srgb, var(--c, var(--color-accent)) 45%, transparent);
  transition: transform 0.3s var(--ease-out-expo), border-color 0.3s;
}
.sat:hover { transform: translateY(calc(-3px - var(--deck-lift, 0px))); border-color: color-mix(in srgb, var(--c, var(--color-accent)) 55%, var(--color-line)); }
.sat .lb { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--color-ink-2); }
.sat .lb i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); box-shadow: 0 0 9px var(--c); }
.sat b { font: 700 27px/1 var(--font-display); letter-spacing: -0.01em; color: var(--color-ink); }
.sat .mini { display: flex; gap: 2px; height: 3px; border-radius: 2px; overflow: hidden; }
.sat .mini i { border-radius: 2px; }
.sat .mini i.ok { background: color-mix(in srgb, var(--c) 55%, transparent); }
.sat.s1 { left: 5%; top: calc(19% - var(--deck-lift, 0px) / 9); }
.sat.s2 { right: 5%; top: calc(23% - var(--deck-lift, 0px) / 9); }
.sat.s3 { left: 9%; bottom: 12%; }

/* 当前位置读数 */
.deck-pos { position: absolute; right: 9%; bottom: 14%; z-index: 5; text-align: center; pointer-events: none; transform: translateY(calc(-1 * var(--deck-lift, 0px))); }
.deck-pos span { display: block; font: 500 9.5px var(--font-mono); letter-spacing: 0.22em; color: var(--color-ink-3); }
.deck-pos b {
  font: 700 36px/1.1 var(--font-display); letter-spacing: -0.02em; color: var(--color-ink);
  text-shadow: 0 0 18px color-mix(in srgb, var(--color-accent) 30%, transparent);
}
/* 空态：卡槽堆整体上移 + 降低抬升量，给下方标题 / 按钮留出呼吸空间 */
.is-empty .deck-scene {
  align-items: flex-start;
  padding-top: 56px;
  --deck-lift: clamp(4vh, 7vh, 56px);
}


/* ============ 空态：方案 B「漂浮空卡槽」—— 复用同一套 3D 倾斜卡堆（deck-drift + translateZ 视差），
   卡面换成 3 张「掏空的卡槽」：聚焦槽 alive 绿边框 + 发光上沿 + 上升光柱 + 虚线投放区，
   暗示「新指派会在这里立起来」；背景槽 2 张依次退后、淡出。 ============ */
/* 地面呼吸光圈：垫在卡槽下方，给「悬浮」一个锚点 */
.floor {
  position: absolute;
  left: 50%;
  bottom: -34px;
  width: 460px;
  height: 130px;
  transform: translateX(-50%) translateZ(-160px);
  background: radial-gradient(50% 50% at 50% 50%, rgba(52, 245, 163, 0.13), transparent 70%);
  animation: floor-breathe 3.8s ease-in-out infinite;
  pointer-events: none;
}
@keyframes floor-breathe {
  0%, 100% { opacity: 0.5; transform: translateX(-50%) translateZ(-160px) scale(1); }
  50%      { opacity: 1;    transform: translateX(-50%) translateZ(-160px) scale(1.08); }
}

.slot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 300px;
  height: 420px;
  margin: -210px 0 0 -150px;
  border-radius: 22px;
  border: 1px solid var(--color-line-hair);
  background: rgba(255, 255, 255, 0.02);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 26px 60px -26px rgba(0, 8, 16, 0.7);
  pointer-events: none;
}
.slot.s1 { transform: translateZ(-90px) rotateX(12deg) translateY(52px); opacity: 0.38; }
.slot.s2 { transform: translateZ(-40px) rotateX(7deg) translateY(26px); opacity: 0.62; }
.slot.top {
  transform: translateZ(30px) rotateX(2deg);
  border-color: rgba(52, 245, 163, 0.34);
  background: linear-gradient(160deg, rgba(52, 245, 163, 0.07), rgba(255, 255, 255, 0.02) 58%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 0 0 1px rgba(52, 245, 163, 0.16),
    0 0 64px -8px rgba(52, 245, 163, 0.38),
    0 30px 70px -26px rgba(0, 8, 16, 0.8);
  animation: slot-float 4.6s ease-in-out infinite;
}
@keyframes slot-float {
  0%, 100% { transform: translateZ(30px) rotateX(2deg); }
  50%      { transform: translateZ(46px) rotateX(2deg); }
}

/* 上沿发光边 */
.slot .rim {
  position: absolute;
  top: -1px;
  left: 20px;
  right: 20px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(52, 245, 163, 0.85), transparent);
  animation: rim-glow 2.8s ease-in-out infinite;
}
@keyframes rim-glow {
  0%, 100% { opacity: 0.35; }
  50%      { opacity: 1; }
}

/* 等待光柱 */
.slot .beam {
  position: absolute;
  left: 50%;
  bottom: 4px;
  width: 2px;
  height: 96px;
  margin-left: -1px;
  background: linear-gradient(transparent, rgba(52, 245, 163, 0.8));
  border-radius: 2px;
  animation: beam-rise 2.4s ease-in-out infinite;
}
@keyframes beam-rise {
  0%, 100% { opacity: 0.25; transform: scaleY(0.72); transform-origin: bottom; }
  50%      { opacity: 1;    transform: scaleY(1);    transform-origin: bottom; }
}

/* 顶部标签 */
.slot .slot-tag {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: 600 9.5px/1 var(--font-mono);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--color-ink-3);
  white-space: nowrap;
}
.slot .slot-tag i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-alive);
  box-shadow: 0 0 6px var(--color-alive);
  animation: led-pulse 2.4s ease-in-out infinite;
}

/* 虚线投放区 */
.slot .drop {
  position: absolute;
  left: 22px;
  right: 22px;
  top: 58px;
  bottom: 78px;
  border: 1.5px dashed rgba(52, 245, 163, 0.3);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(52, 245, 163, 0.025);
}
.drop-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 1px solid rgba(52, 245, 163, 0.38);
  background: rgba(52, 245, 163, 0.06);
  display: grid;
  place-items: center;
  color: var(--color-alive);
}
.drop-icon svg { width: 22px; height: 22px; }
.drop-t { font-size: 16px; font-weight: 600; color: var(--color-ink); letter-spacing: 0.02em; }
.drop-s { font-size: 11px; color: var(--color-ink-3); font-family: var(--font-mono); letter-spacing: 0.06em; }

/* 空态卡槽交互：hover 预亮 + 拖放热区（hot）——「把今天的事丢进来」是真可点的 */
.slot.top { cursor: pointer; pointer-events: auto; transition: border-color 0.3s, box-shadow 0.3s, background 0.3s; }
.slot.top:hover {
  border-color: rgba(52, 245, 163, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 0 0 1px rgba(52, 245, 163, 0.24),
    0 0 84px -8px rgba(52, 245, 163, 0.5),
    0 30px 70px -26px rgba(0, 8, 16, 0.8);
}
.slot.top .drop { transition: border-color 0.3s, background 0.3s, box-shadow 0.3s; }
.slot.top:hover .drop {
  border-color: rgba(52, 245, 163, 0.55);
  background: rgba(52, 245, 163, 0.06);
  box-shadow: inset 0 0 24px rgba(52, 245, 163, 0.08);
}
.slot.top .drop-icon { transition: transform 0.3s var(--ease-out-expo), border-color 0.3s, box-shadow 0.3s; }
.slot.top:hover .drop-icon { transform: translateY(-2px) scale(1.07); }
.slot.top:focus-visible { outline: 2px solid rgba(52, 245, 163, 0.6); outline-offset: 3px; }
.slot.top.hot {
  border-color: rgba(52, 245, 163, 0.7);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    0 0 0 2px rgba(52, 245, 163, 0.3),
    0 0 110px -6px rgba(52, 245, 163, 0.6),
    0 30px 70px -26px rgba(0, 8, 16, 0.8);
}
.slot.top.hot .drop {
  border-color: rgba(52, 245, 163, 0.85);
  background: rgba(52, 245, 163, 0.09);
  box-shadow: inset 0 0 32px rgba(52, 245, 163, 0.14);
}
.slot.top.hot .drop-icon {
  transform: translateY(-2px) scale(1.12);
  border-color: var(--color-alive);
  animation: drop-ready 1.1s ease-in-out infinite;
}
@keyframes drop-ready {
  0%, 100% { box-shadow: 0 0 12px rgba(52, 245, 163, 0.3); }
  50%      { box-shadow: 0 0 26px rgba(52, 245, 163, 0.6); }
}

/* 空态说明文字：纯文字 + 双按钮，无背景板，漂浮在 3D 卡槽下方 */
.de-overlay {
  position: absolute;
  left: 50%;
  bottom: 6%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  pointer-events: none;
  width: max-content;
  max-width: 90vw;
}
.de-led {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--color-alive);
  box-shadow: 0 0 12px var(--color-alive);
  animation: led-pulse 3s ease-in-out infinite;
}
.de-t {
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  text-shadow: 0 0 22px color-mix(in srgb, var(--color-alive) 20%, transparent);
}
.de-s {
  font-size: 12.5px;
  color: var(--color-ink-2);
}
.de-s b { color: var(--color-ink); font-weight: 600; }
.de-actions {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
.de-overlay .gbtn {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 10px 18px;
  border-radius: 10px;
  cursor: pointer;
  font: 600 12px/1 var(--font-mono);
  border: 1px solid transparent;
  transition: filter 0.2s, box-shadow 0.2s, transform 0.12s, color 0.2s, background 0.2s, border-color 0.2s;
}
.de-overlay .gbtn.primary {
  color: var(--color-accent-contrast);
  background: linear-gradient(180deg, var(--color-accent-strong), var(--color-accent));
  box-shadow: 0 8px 20px -8px color-mix(in srgb, var(--color-accent) 70%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
.de-overlay .gbtn.primary:hover {
  filter: brightness(1.08);
  box-shadow: 0 10px 26px -8px color-mix(in srgb, var(--color-accent) 80%, transparent), 0 0 18px -4px color-mix(in srgb, var(--color-accent) 60%, transparent);
}
.de-overlay .gbtn.ghost {
  color: var(--color-ink-2);
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--color-line);
  box-shadow: none;
}
.de-overlay .gbtn.ghost:hover {
  color: var(--color-ink);
  background: rgba(255, 255, 255, 0.09);
}
.de-overlay .gbtn:active { transform: scale(0.97); }

@keyframes led-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50%      { opacity: 1;   transform: scale(1.15); }
}

@keyframes deck-ping { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* 窄屏：卫星收拢为底部横排、细线隐藏、位置 / 新建贴角，避免绝对定位互相压盖 */
@container layout-main (max-width: 1100px) {
  .deck-sats { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 5; display: flex; gap: 10px; }
  .sat { position: static; min-width: 0; }
  .deck-pos { right: 16px; bottom: 12px; }
  .deck-add { right: 16px; top: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .deck-stack { animation: none; }
  .c3 { transition: opacity 0.2s; }
  .c3.is-active { animation: none; }
  .c3 .focus::before { animation: none; }
  .c3 .ai .h .d { animation: none; }
  .hh-prog, .hh-tick, .hh-mk, .hh-mk-h, .sat { transition: none; }
  .floor, .slot.top, .slot .rim, .slot .beam, .slot .slot-tag i, .slot.top.hot .drop-icon, .de-led { animation: none; }
}
</style>
