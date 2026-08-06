<script setup lang="ts">
/**
 * 回合容器：把同一次 agent 循环（思考 → 执行 → 组织回答）渲染为一个整体，而非折叠卡 + 气泡。
 *
 * - 头部：阶段徽标（思考中 / 正在执行 N 个动作 / 正在组织回答 / 完成 / 已停止 / 出错了）
 *   + 进度 + 动作数/失败数 + 实时耗时；停止/失败的最后一回合提供「继续生成」。
 * - 时间线：始终可见（不再默认折叠）。每个中间步骤的意图正文与工具活动逐条展示，
 *   进行中的高亮、完成的打勾、失败可重试；pending 审批内嵌确认卡（批准 / 拒绝）。
 * - 尾部：最终回答（AssistantAnswer，markdown + 生成式 UI 卡 + 动作行 + reach 徽标）。
 */
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import type { ChatMessage, ToolActivity } from '../types'
import { useChatStore } from '../store'
import { summarizeReachResult } from '@/features/reach'
import IconPlay from '~icons/mdi/play'
import ToolActivityRow from './ToolActivityRow.vue'
import AssistantAnswer from './AssistantAnswer.vue'

const props = defineProps<{
  /** 中间轮（非最终）assistant 消息，按顺序 */
  steps: { msg: ChatMessage; index: number }[]
  /** 最终回答消息 */
  final: { msg: ChatMessage; index: number }
  /** 该回合是否以最后一条 assistant 消息收尾（动作行「重答」与 reach chips 的锚点） */
  isLastAssistant: boolean
}>()

const store = useChatStore()

const PHASES: Record<string, { label: string; cls: string }> = {
  thinking: { label: '思考中', cls: 'is-active' },
  working: { label: '正在执行', cls: 'is-active' },
  composing: { label: '正在组织回答', cls: 'is-active' },
  pending: { label: '等待确认', cls: 'is-pending' },
  done: { label: '完成', cls: 'is-done' },
  aborted: { label: '已停止', cls: 'is-aborted' },
  failed: { label: '出错了', cls: 'is-error' },
}
const phaseInfo = computed(() => {
  const m = props.final.msg
  // 审批暂停：final 轮挂 pending 活动 → 显示「等待确认」
  if (m.activities?.some((a) => a.status === 'pending')) return PHASES.pending
  if (store.streaming) return PHASES[store.turnPhase] ?? PHASES.thinking
  // 非流式时让最后一个回合反映真实的停止/失败态（也是「继续生成」的锚点）
  if (props.isLastAssistant && (store.turnPhase === 'aborted' || store.turnPhase === 'failed')) {
    return PHASES[store.turnPhase]
  }
  return PHASES.done
})

/** 「继续生成」：仅最后一个回合在停止/失败后可见（从半成品处续跑，不重复提问） */
const showResume = computed(() =>
  !store.streaming
  && props.isLastAssistant
  && (phaseInfo.value.cls === 'is-aborted' || phaseInfo.value.cls === 'is-error'),
)
function onResume() {
  void store.resumeAfterStop()
}

/** 回合内所有活动的计数（跨中间轮累计，不含 final——final 不挂活动） */
const allActivities = computed<ToolActivity[]>(() =>
  props.steps.flatMap((s) => s.msg.activities ?? []),
)
const errCount = computed(() => allActivities.value.filter((a) => a.status === 'error').length)
const actTotal = computed(() => allActivities.value.length)

const startTime = computed(() => props.steps[0]?.msg.ts ?? props.final.msg.ts)
const elapsed = ref(0)
/** 进行中（或审批暂停）时每秒刷新耗时，其余状态定格 */
const liveClock = computed(() => store.streaming || phaseInfo.value.cls === 'is-pending')
let timer: ReturnType<typeof setInterval> | null = null
function tick() {
  if (!startTime.value) return
  elapsed.value = Date.now() - startTime.value
}
function startTimer() {
  stopTimer()
  timer = setInterval(tick, 1000)
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
}
// 挂载即算一次（无 timer 时也有初值）；watch 驱动 start/stop
tick()
watch(liveClock, (on) => (on ? startTimer() : (stopTimer(), tick())))
onBeforeUnmount(stopTimer)

function fmtDuration(ms: number | undefined): string {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
function fmtElapsed(): string {
  if (!elapsed.value) return ''
  if (elapsed.value < 1000) return ''
  if (elapsed.value < 60_000) return `${(elapsed.value / 1000).toFixed(0)}s`
  return `${Math.floor(elapsed.value / 60_000)}m${String(Math.floor((elapsed.value % 60_000) / 1000)).padStart(2, '0')}s`
}

/** 当前进行中的活动 label（「正在执行什么」） */
const runningLabel = computed(() => {
  for (let i = allActivities.value.length - 1; i >= 0; i--) {
    const a = allActivities.value[i]
    if (a.status === 'running') return a.label
  }
  return null
})

/** 头部进度文案：思考中 → 正在执行 2/4 · 查询天气 → 正在组织回答 */
const progressText = computed(() => {
  if (phaseInfo.value.cls === 'is-pending') {
    const pending = allActivities.value.filter((a) => a.status === 'pending').length
    return `${pending} 项操作待确认`
  }
  // 停止/失败回合：说明已生成的部分被保留（可继续生成）
  if (phaseInfo.value.cls === 'is-aborted' || phaseInfo.value.cls === 'is-error') {
    return '保留已生成的部分'
  }
  if (!store.streaming) return null
  switch (store.turnPhase) {
    case 'thinking': return '思考中'
    case 'working': return `正在执行 ${Math.min(store.turnActDone, store.turnActTotal)}/${store.turnActTotal} 个动作${runningLabel.value ? ` · ${runningLabel.value}` : ''}`
    case 'composing': return '正在组织回答'
    default: return null
  }
})

// ── 活动行交互：展开结果 / 重试 / 审批 ──
const expandedActs = ref<Set<number>>(new Set())
function toggleAct(globalIdx: number) {
  const next = new Set(expandedActs.value)
  if (next.has(globalIdx)) next.delete(globalIdx)
  else next.add(globalIdx)
  expandedActs.value = next
}
function actResult(a: ToolActivity): string {
  if (!a.result) return ''
  const reach = summarizeReachResult(a.name, a.result)
  if (reach) return reach
  try { return JSON.stringify(JSON.parse(a.result), null, 2) } catch { return a.result }
}

/** 审批参数：定位到该活动所属中间轮的同下标 tool_call，解析 arguments 只读展示 */
function approvalArgs(stepIdx: number, actIdx: number): Record<string, string> {
  const call = props.steps[stepIdx]?.msg.tool_calls?.[actIdx]
  if (!call?.function.arguments) return {}
  try {
    const obj = JSON.parse(call.function.arguments) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj)) {
      out[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
    }
    return out
  } catch { return {} }
}

function onApprove(stepIdx: number, actIdx: number) {
  void store.approveTool(props.steps[stepIdx].index, actIdx)
}
function onReject(stepIdx: number, actIdx: number) {
  void store.rejectTool(props.steps[stepIdx].index, actIdx)
}
function onRetry(stepIdx: number, actIdx: number) {
  void store.retryTool(props.steps[stepIdx].index, actIdx)
}
</script>

<template>
  <section class="turn" :class="`is-${phaseInfo.cls}`">
    <!-- 回合头部：阶段 + 进度 + 耗时 -->
    <div class="turn-head">
      <span class="turn-dot" aria-hidden="true" />
      <span class="turn-phase">{{ phaseInfo.label }}</span>
      <span v-if="progressText" class="turn-progress">{{ progressText }}</span>
      <span class="turn-meta">
        <template v-if="actTotal"> {{ actTotal }} 个动作
          <template v-if="errCount"> · {{ errCount }} 失败</template>
        </template>
        <template v-if="fmtElapsed()"> · {{ fmtElapsed() }}</template>
      </span>
      <button
        v-if="showResume"
        type="button"
        class="turn-resume"
        title="从已生成的部分继续"
        @click="onResume"
      >
        <IconPlay class="w-3 h-3" />
        <span>继续生成</span>
      </button>
    </div>

    <!-- 时间线：中间步骤的意图正文 + 工具活动，始终可见 -->
    <div v-if="steps.length" class="turn-body">
      <template v-for="(s, si) in steps" :key="s.msg.id ?? s.index">
        <!-- 步骤的意图正文（模型写的「为什么这么做」） -->
        <p v-if="s.msg.content.trim()" class="turn-intent">{{ s.msg.content.trim() }}</p>

        <div
          v-for="(a, ai) in s.msg.activities ?? []"
          :key="`${s.msg.id ?? s.index}-${ai}`"
          class="turn-row"
          :class="`is-${a.status}`"
        >
          <ToolActivityRow :activity="a" class="turn-row-main" />
          <span class="turn-row-status">
            {{ a.status === 'running' ? '执行中' : a.status === 'pending' ? '待确认' : a.status === 'error' ? (a.approval?.decision === 'rejected' ? '已取消' : '失败') : '完成' }}
          </span>
          <span class="turn-row-dur">{{ fmtDuration(a.duration) }}</span>

          <!-- 审批确认卡（pending 内嵌，原地批准/拒绝） -->
          <div v-if="a.status === 'pending' && a.approval" class="turn-approval">
            <div class="turn-approval-head">
              <span class="turn-approval-title">{{ a.approval.title }}</span>
              <span class="turn-approval-risk">{{ a.approval.risk }}</span>
            </div>
            <p v-if="a.approval.description" class="turn-approval-desc">{{ a.approval.description }}</p>
            <dl v-if="Object.keys(approvalArgs(si, ai)).length" class="turn-approval-args">
              <template v-for="(v, k) in approvalArgs(si, ai)" :key="k">
                <dt>{{ k }}</dt>
                <dd>{{ v }}</dd>
              </template>
            </dl>
            <div class="turn-approval-btns">
              <button type="button" class="turn-btn is-approve" @click="onApprove(si, ai)">批准</button>
              <button type="button" class="turn-btn is-reject" @click="onReject(si, ai)">拒绝</button>
            </div>
          </div>

          <!-- 失败 → 重试；成功且有结果 → 展开 -->
          <button
            v-else-if="a.status === 'error'"
            type="button"
            class="turn-row-btn"
            :disabled="store.streaming"
            @click="onRetry(si, ai)"
          >重试</button>
          <button
            v-else-if="a.result && !expandedActs.has(si * 100 + ai)"
            type="button"
            class="turn-row-btn"
            @click="toggleAct(si * 100 + ai)"
          >展开结果</button>

          <pre v-if="a.result && expandedActs.has(si * 100 + ai)" class="turn-result">{{ actResult(a) }}</pre>
        </div>
      </template>
    </div>

    <!-- 最终回答 -->
    <div class="turn-answer">
      <AssistantAnswer
        :message="final.msg"
        :index="final.index"
        :is-last-assistant="isLastAssistant"
        :streaming="store.streaming"
      />
    </div>
  </section>
</template>

<style scoped>
.turn {
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-raised);
  overflow: hidden;
}
.turn.is-active { border-color: color-mix(in srgb, var(--color-accent) 30%, transparent); }
.turn.is-pending { border-color: color-mix(in srgb, var(--color-warning) 40%, transparent); }
.turn.is-error { border-color: color-mix(in srgb, var(--color-danger) 35%, transparent); }

/* ── 头部 ── */
.turn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--color-line-hair);
  color: var(--color-ink-3);
  font: 400 10.5px/1 var(--font-mono, ui-monospace, monospace);
}
.turn-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 2px;
  background: var(--color-ink-3);
}
.turn.is-active .turn-dot {
  background: var(--color-accent);
  animation: turn-pulse 1.1s ease-in-out infinite;
}
.turn.is-pending .turn-dot { background: var(--color-warning); }
.turn.is-done .turn-dot { background: var(--color-success); }
.turn.is-aborted .turn-dot { background: var(--color-ink-4); }
.turn.is-error .turn-dot { background: var(--color-danger); }
@keyframes turn-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
.turn-phase {
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--color-ink-2);
}
.turn.is-active .turn-phase { color: var(--color-accent); }
.turn.is-pending .turn-phase { color: var(--color-warning); }
.turn.is-aborted .turn-phase { color: var(--color-ink-3); }
.turn.is-error .turn-phase { color: var(--color-danger); }
.turn-progress {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-ink-3);
}
.turn-meta {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--color-ink-4);
  tabular-nums: auto;
}

/* ── 继续生成（停止/失败回合） ── */
.turn-resume {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  height: 20px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
  border-radius: 3px;
  background: transparent;
  color: var(--color-accent-strong);
  font-size: 10.5px;
  cursor: pointer;
}
.turn-resume:hover {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}

/* ── 时间线 ── */
.turn-body {
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-line-hair);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.turn-intent {
  margin: 2px 0 4px;
  padding: 5px 8px;
  border-left: 2px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
  background: color-mix(in srgb, var(--color-accent) 5%, transparent);
  color: var(--color-ink-2);
  font-size: 12px;
  line-height: 1.6;
}
.turn-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  padding: 2px 0;
}
.turn-row-status {
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
  white-space: nowrap;
}
.turn-row.is-running .turn-row-status { color: var(--color-accent); }
.turn-row.is-pending .turn-row-status { color: var(--color-warning); }
.turn-row.is-error .turn-row-status { color: var(--color-danger); }
.turn-row-dur {
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-4);
  white-space: nowrap;
  tabular-nums: auto;
}

/* ── 审批卡 ── */
.turn-approval {
  grid-column: 1 / -1;
  margin-top: 2px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-warning) 6%, transparent);
}
.turn-approval-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.turn-approval-title {
  color: var(--color-ink);
  font-size: 12px;
  font-weight: 700;
}
.turn-approval-risk {
  color: var(--color-warning);
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
}
.turn-approval-desc {
  margin: 5px 0 0;
  color: var(--color-ink-2);
  font-size: 11px;
  line-height: 1.5;
}
.turn-approval-args {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 10px;
  margin: 8px 0 0;
  padding: 8px 10px;
  border: 1px solid var(--color-line-hair);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-base) 60%, transparent);
}
.turn-approval-args dt {
  font: 700 10.5px/1.5 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.turn-approval-args dd {
  margin: 0;
  font: 400 10.5px/1.5 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-2);
  word-break: break-all;
}
.turn-approval-btns {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.turn-btn {
  height: 24px;
  padding: 0 12px;
  border-radius: 3px;
  font-size: 11.5px;
  font-weight: 650;
  cursor: pointer;
}
.turn-btn.is-approve {
  background: var(--color-accent);
  border: 1px solid var(--color-accent);
  color: var(--color-accent-contrast);
}
.turn-btn.is-approve:hover { background: var(--color-accent-strong); }
.turn-btn.is-reject {
  border: 1px solid var(--color-line);
  background: transparent;
  color: var(--color-ink-2);
}
.turn-btn.is-reject:hover {
  border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
  color: var(--color-danger);
}

/* ── 行内小按钮 / 结果 ── */
.turn-row-btn {
  grid-column: 1 / -1;
  justify-self: start;
  height: 20px;
  padding: 0 8px;
  border: 1px solid var(--color-line);
  border-radius: 3px;
  background: transparent;
  color: var(--color-ink-3);
  font-size: 10.5px;
  cursor: pointer;
}
.turn-row-btn:hover:not(:disabled) {
  color: var(--color-ink);
  background: var(--color-base);
}
.turn-row-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.turn-result {
  grid-column: 1 / -1;
  max-height: 220px;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  border: 1px solid var(--color-line-hair);
  border-radius: 4px;
  background: var(--color-base);
  color: var(--color-ink-2);
  font: 400 11px/1.55 var(--font-mono, ui-monospace, monospace);
  scrollbar-width: thin;
}

/* ── 最终回答 ── */
.turn-answer {
  padding: 10px;
}

@media (prefers-reduced-motion: reduce) {
  .turn.is-active .turn-dot { animation: none; opacity: 0.8; }
}
</style>
