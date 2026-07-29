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
import { useLocalTaskStore } from '@/features/local-tasks'
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
      <DeckViz :items="deck" :active="active" :theme="theme" @jump="setActive" />
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

    <!-- 三颗来源卫星（数量 count-up + 风险构成迷你条） -->
    <div class="deck-sats">
      <div
        v-for="(s, i) in satellites"
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

    <div class="deck-hint" :class="{ gone: interacted }">
      滚轮 / 拖拽 / ↑↓ 翻动 · 点标题看详情 · <b>FOCUS</b> 卡可操作
    </div>
  </div>

  <!-- 空态：克制、不空洞 -->
  <div v-else class="deck-empty">
    <div class="de-ring" />
    <div class="de-t">收件箱已清空</div>
    <div class="de-s">小吴待命 · 有新指派会在这里立起来</div>
    <button type="button" class="gbtn" style="margin-top:14px" @click="openCreate">+ 新建本地待办</button>
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
  perspective-origin: 50% 45%;
  touch-action: none;
  cursor: grab;
}
.deck-scene.dragging,
.deck-scene.dragging * { cursor: grabbing; }
/* 拖拽跟手层：translateY 跟手位移；preserve-3d 把舞台透视链透传给内层卡堆 */
.deck-drag {
  transform-style: preserve-3d;
  transform: translateY(var(--drag-y, 0px));
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
  animation: deck-drift 24s ease-in-out infinite alternate;
}
@keyframes deck-drift {
  from { transform: rotateX(15deg) rotateY(-21deg) rotateZ(1.5deg); }
  to { transform: rotateX(12deg) rotateY(-15deg) rotateZ(-0.5deg); }
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
  font: 700 9px/1 var(--font-mono); letter-spacing: 0.2em; color: var(--rc);
  opacity: 0; transition: opacity 0.3s;
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
}
.c3.is-active .focus { opacity: 1; }
.c3.is-active .ttl { font-family: var(--font-display); font-size: 19px; letter-spacing: -0.01em; }
.c3.is-active .tag { color: var(--rc); border-color: color-mix(in srgb, var(--rc) 38%, transparent); background: color-mix(in srgb, var(--rc) 14%, transparent); }
.c3.is-active .only-active { display: block; }

/* ============ 环绕 HUD（方案 B） ============ */
/* 大总数 + 风险概况 */
.deck-total {
  position: absolute; top: 6px; left: 50%; transform: translateX(-50%); z-index: 5;
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
.sat:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--c, var(--color-accent)) 55%, var(--color-line)); }
.sat .lb { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--color-ink-2); }
.sat .lb i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); box-shadow: 0 0 9px var(--c); }
.sat b { font: 700 27px/1 var(--font-display); letter-spacing: -0.01em; color: var(--color-ink); }
.sat .mini { display: flex; gap: 2px; height: 3px; border-radius: 2px; overflow: hidden; }
.sat .mini i { border-radius: 2px; }
.sat .mini i.ok { background: color-mix(in srgb, var(--c) 55%, transparent); }
.sat.s1 { left: 5%; top: 19%; }
.sat.s2 { right: 5%; top: 23%; }
.sat.s3 { left: 9%; bottom: 12%; }

/* 当前位置读数 */
.deck-pos { position: absolute; right: 9%; bottom: 14%; z-index: 5; text-align: center; pointer-events: none; }
.deck-pos span { display: block; font: 500 9.5px var(--font-mono); letter-spacing: 0.22em; color: var(--color-ink-3); }
.deck-pos b {
  font: 700 36px/1.1 var(--font-display); letter-spacing: -0.02em; color: var(--color-ink);
  text-shadow: 0 0 18px color-mix(in srgb, var(--color-accent) 30%, transparent);
}
.deck-pos b i { font-style: normal; font-size: 16px; color: var(--color-ink-3); margin-left: 2px; }

.deck-hint {
  position: absolute; bottom: 74px; left: 50%; transform: translateX(-50%); z-index: 5;
  padding: 7px 14px; border-radius: 999px; white-space: nowrap;
  background: rgba(4, 8, 16, 0.42); border: 1px solid var(--color-line);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  font: 500 10.5px/1 var(--font-mono); letter-spacing: 0.06em; color: var(--color-ink-2);
  transition: opacity 0.6s;
}
.deck-hint b { color: var(--color-alive); }
.deck-hint.gone { opacity: 0; pointer-events: none; }

.deck-empty { position: relative; width: 100%; height: 100%; min-height: 360px; display: grid; place-content: center; gap: 10px; text-align: center; }
.deck-empty .de-ring {
  width: 64px; height: 64px; margin: 0 auto 6px; border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--color-alive) 40%, transparent);
  box-shadow: 0 0 30px -4px color-mix(in srgb, var(--color-alive) 45%, transparent), inset 0 0 18px -6px color-mix(in srgb, var(--color-alive) 40%, transparent);
}
.deck-empty .de-t { font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--color-ink); }
.deck-empty .de-s { font-size: 12.5px; color: var(--color-ink-2); }
.deck-empty .gbtn {
  padding: 9px 16px; border-radius: 10px; cursor: pointer; border: 1px solid color-mix(in srgb, var(--color-accent) 36%, transparent);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-accent); font: 600 12px/1 var(--font-mono);
}

@keyframes deck-ping { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* 窄屏：卫星收拢为底部横排、细线隐藏、位置 / 新建贴角，避免绝对定位互相压盖 */
@media (max-width: 1100px) {
  .deck-sats { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 5; display: flex; gap: 10px; }
  .sat { position: static; min-width: 0; }
  .deck-pos { right: 16px; bottom: 12px; }
  .deck-add { right: 16px; top: 8px; }
  .deck-hint { bottom: 108px; }
}
@media (prefers-reduced-motion: reduce) {
  .deck-stack { animation: none; }
  .c3 { transition: opacity 0.2s; }
  .c3 .ai .h .d { animation: none; }
  .hh-prog, .hh-tick, .hh-mk, .hh-mk-h, .sat { transition: none; }
}
</style>
