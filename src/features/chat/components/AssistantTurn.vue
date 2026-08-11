<script setup lang="ts">
/**
 * 回合容器（Console 风格）：左侧纵轴时间线 + 可折叠步骤卡 + 结论卡片。
 *
 * - 左侧纵轴：每个中间步骤一个状态色点 + 最终结论节点
 * - 步骤卡：默认折叠（显示名称+耗时），点击展开看参数/结果/审批
 * - 结论卡：绿色边框，最终回答（AssistantAnswer）
 * - 头部：阶段 + 进度 + 耗时 + 「继续生成」（停止/失败时）
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
  if (m.activities?.some((a) => a.status === 'pending')) return PHASES.pending
  if (store.streaming) return PHASES[store.turnPhase] ?? PHASES.thinking
  if (props.isLastAssistant && (store.turnPhase === 'aborted' || store.turnPhase === 'failed')) {
    return PHASES[store.turnPhase]
  }
  return PHASES.done
})

const showResume = computed(() =>
  !store.streaming
  && props.isLastAssistant
  && (phaseInfo.value.cls === 'is-aborted' || phaseInfo.value.cls === 'is-error'),
)
function onResume() {
  void store.resumeAfterStop()
}

/** 回合内所有活动的计数（跨中间轮累计） */
const allActivities = computed<ToolActivity[]>(() =>
  props.steps.flatMap((s) => s.msg.activities ?? []),
)
const errCount = computed(() => allActivities.value.filter((a) => a.status === 'error').length)
const actTotal = computed(() => allActivities.value.length)

const startTime = computed(() => props.steps[0]?.msg.ts ?? props.final.msg.ts)
const elapsed = ref(0)
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

/** 头部进度文案 */
const progressText = computed(() => {
  if (phaseInfo.value.cls === 'is-pending') {
    const pending = allActivities.value.filter((a) => a.status === 'pending').length
    return `${pending} 项操作待确认`
  }
  if (phaseInfo.value.cls === 'is-aborted' || phaseInfo.value.cls === 'is-error') {
    return '保留已生成的部分'
  }
  if (!store.streaming) return null
  switch (store.turnPhase) {
    case 'thinking': return '思考中'
    case 'working': return `正在执行 ${Math.min(store.turnActDone, store.turnActTotal)}/${store.turnActTotal} 个动作`
    case 'composing': return '正在组织回答'
    default: return null
  }
})

// ── 步骤折叠 ──
const expandedSteps = ref<Set<number>>(new Set())
function toggleStep(si: number) {
  const next = new Set(expandedSteps.value)
  if (next.has(si)) next.delete(si)
  else next.add(si)
  expandedSteps.value = next
}

/** 步骤状态：取该步骤内最严重的活动状态 */
function stepStatus(si: number): string {
  const acts = props.steps[si]?.msg.activities ?? []
  if (acts.some((a) => a.status === 'pending')) return 'pending'
  if (acts.some((a) => a.status === 'running')) return 'running'
  if (acts.some((a) => a.status === 'error')) return 'error'
  return 'done'
}
function stepStatusLabel(si: number): string {
  const s = stepStatus(si)
  if (s === 'pending') return '待确认'
  if (s === 'running') return '执行中'
  if (s === 'error') return '失败'
  return '完成'
}
function stepDuration(si: number): string {
  const acts = props.steps[si]?.msg.activities ?? []
  const total = acts.reduce((sum, a) => sum + (a.duration ?? 0), 0)
  return fmtDuration(total)
}

/** 工具图标 */
function toolIcon(si: number): string {
  const name = props.steps[si]?.msg.activities?.[0]?.name ?? ''
  if (name.startsWith('reach')) return '🔍'
  if (name.startsWith('weather')) return '⛅'
  if (name.startsWith('zentao')) return '📋'
  if (name.startsWith('git')) return '⎇'
  if (name.startsWith('local')) return '📝'
  if (name.startsWith('kb')) return '📚'
  if (name.startsWith('wbscf')) return '⚙'
  if (name.startsWith('claude')) return '✦'
  return '⚡'
}

// ── 活动行交互：重试 / 审批 / 结果预览 ──
function onApprove(stepIdx: number, actIdx: number) {
  void store.approveTool(props.steps[stepIdx].index, actIdx)
}
function onReject(stepIdx: number, actIdx: number) {
  void store.rejectTool(props.steps[stepIdx].index, actIdx)
}
function onRetry(stepIdx: number, actIdx: number) {
  void store.retryTool(props.steps[stepIdx].index, actIdx)
}
function actResult(a: ToolActivity): string {
  if (!a.result) return ''
  const reach = summarizeReachResult(a.name, a.result)
  if (reach) return reach
  try { return JSON.stringify(JSON.parse(a.result), null, 2) } catch { return a.result }
}

/** 审批参数：定位到该活动所属中间轮的同下标 tool_call */
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
</script>

<template>
  <section class="turn console" :class="`is-${phaseInfo.cls}`">
    <!-- 左侧纵轴 -->
    <div class="axis">
      <div class="axis-line" aria-hidden="true" />
      <div
        v-for="(s, si) in steps"
        :key="s.msg.id ?? s.index"
        class="node"
        :class="`is-${stepStatus(si)}`"
        aria-hidden="true"
      >
        <div class="node-dot" />
      </div>
      <div class="node is-final" aria-hidden="true">
        <div class="node-dot" />
      </div>
    </div>

    <!-- 右侧内容 -->
    <div class="content">
      <!-- 头部：阶段 + 进度 + 耗时 -->
      <div class="turn-head">
        <span class="turn-phase">{{ phaseInfo.label }}</span>
        <span v-if="progressText" class="turn-progress">{{ progressText }}</span>
        <span class="spacer" />
        <span v-if="actTotal" class="turn-meta">
          {{ actTotal }} 个动作<template v-if="errCount"> · {{ errCount }} 失败</template>
        </span>
        <span v-if="fmtElapsed()" class="turn-meta"> · {{ fmtElapsed() }}</span>
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

      <!-- 步骤列表（可折叠） -->
      <div v-if="steps.length" class="steps">
        <div
          v-for="(s, si) in steps"
          :key="s.msg.id ?? s.index"
          class="step"
          :class="{ 'is-open': expandedSteps.has(si) }"
        >
          <!-- 步骤头（点击展开） -->
          <div class="step-head" @click="toggleStep(si)">
            <span class="step-icon">{{ toolIcon(si) }}</span>
            <span class="step-name">{{ s.msg.activities?.[0]?.label || '思考中…' }}</span>
            <span class="step-fn">{{ s.msg.activities?.[0]?.name || 'thinking' }}</span>
            <span class="spacer" />
            <span class="step-dur">{{ stepDuration(si) }}</span>
            <span class="step-status" :class="`is-${stepStatus(si)}`">{{ stepStatusLabel(si) }}</span>
            <span class="step-chevron" aria-hidden="true">▸</span>
          </div>

          <!-- 步骤体（展开后显示） -->
          <div v-if="expandedSteps.has(si)" class="step-body">
            <!-- 意图正文 -->
            <p v-if="s.msg.content.trim()" class="step-intent">{{ s.msg.content.trim() }}</p>

            <!-- 每个活动 -->
            <div
              v-for="(a, ai) in s.msg.activities ?? []"
              :key="`${s.msg.id ?? s.index}-${ai}`"
              class="activity"
            >
              <ToolActivityRow :activity="a" :compact="true" />

              <!-- 审批确认卡（pending 内嵌，原地批准/拒绝） -->
              <div v-if="a.status === 'pending' && a.approval" class="approval-card">
                <div class="approval-head">
                  <span class="approval-title">{{ a.approval.title }}</span>
                  <span class="approval-risk">{{ a.approval.risk }}</span>
                </div>
                <p v-if="a.approval.description" class="approval-desc">{{ a.approval.description }}</p>
                <dl v-if="Object.keys(approvalArgs(si, ai)).length" class="approval-args">
                  <template v-for="(v, k) in approvalArgs(si, ai)" :key="k">
                    <dt>{{ k }}</dt>
                    <dd>{{ v }}</dd>
                  </template>
                </dl>
                <div class="approval-btns">
                  <button type="button" class="approval-btn is-approve" @click.stop="onApprove(si, ai)">批准</button>
                  <button type="button" class="approval-btn is-reject" @click.stop="onReject(si, ai)">拒绝</button>
                </div>
              </div>

              <!-- 失败 → 重试 -->
              <button
                v-else-if="a.status === 'error'"
                type="button"
                class="retry-btn"
                :disabled="store.streaming"
                @click.stop="onRetry(si, ai)"
              >重试</button>

              <!-- 成功且有结果 → 折叠预览 -->
              <details v-else-if="a.result" class="result-details">
                <summary>查看结果</summary>
                <pre class="result-pre">{{ actResult(a) }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>

      <!-- 结论卡片 -->
      <div v-if="final" class="conclusion">
        <div class="conclusion-head">
          <span class="conclusion-tag">结论</span>
          <span class="conclusion-title">综合回答</span>
        </div>
        <div class="conclusion-body">
          <AssistantAnswer
            :message="final.msg"
            :index="final.index"
            :is-last-assistant="isLastAssistant"
            :streaming="store.streaming"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.turn {
  position: relative;
  display: grid;
  grid-template-columns: 24px 1fr;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-raised);
  overflow: hidden;
}
.turn.is-active { border-color: color-mix(in srgb, var(--color-accent) 28%, transparent); }
.turn.is-pending { border-color: color-mix(in srgb, var(--color-warning) 36%, transparent); }
.turn.is-error { border-color: color-mix(in srgb, var(--color-danger) 32%, transparent); }

/* ── 左侧纵轴 ── */
.axis {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 14px;
  padding-bottom: 14px;
}
.axis-line {
  position: absolute;
  top: 20px;
  bottom: 20px;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: linear-gradient(180deg, var(--color-line) 0%, var(--color-line-hair) 100%);
}
.node {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  margin: 6px 0;
}
.node-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--color-raised);
  background: var(--color-ink-4);
  transition: background 0.2s ease, box-shadow 0.2s ease;
}
.node.is-done .node-dot { background: var(--color-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 22%, transparent); }
.node.is-running .node-dot { background: var(--color-warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 22%, transparent); animation: node-pulse 1.1s ease-in-out infinite; }
.node.is-pending .node-dot { background: var(--color-warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 22%, transparent); }
.node.is-error .node-dot { background: var(--color-danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-danger) 22%, transparent); }
.node.is-final .node-dot { background: var(--color-success); width: 12px; height: 12px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 25%, transparent); }
@keyframes node-pulse {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.15); }
}

/* ── 内容区 ── */
.content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
}

/* ── 头部 ── */
.turn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-line-hair);
  color: var(--color-ink-3);
  font: 400 10.5px/1 var(--font-mono, ui-monospace, monospace);
}
.turn-phase {
  font-weight: 700;
  letter-spacing: 0.05em;
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
.spacer { flex: 1; }
.turn-meta {
  flex: 0 0 auto;
  color: var(--color-ink-4);
  white-space: nowrap;
}

/* ── 继续生成 ── */
.turn-resume {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  height: 20px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 42%, transparent);
  border-radius: 4px;
  background: transparent;
  color: var(--color-accent-strong);
  font-size: 10.5px;
  cursor: pointer;
}
.turn-resume:hover {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
}

/* ── 步骤列表 ── */
.steps {
  display: flex;
  flex-direction: column;
  gap: 0;
  border-bottom: 1px solid var(--color-line-hair);
}
.step {
  border-bottom: 1px solid var(--color-line-hair);
}
.step:last-child {
  border-bottom: none;
}

/* 步骤头（可点击） */
.step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  cursor: pointer;
  transition: background 0.12s ease;
  user-select: none;
}
.step-head:hover {
  background: color-mix(in srgb, var(--color-accent) 3%, transparent);
}
.step-icon {
  width: 16px;
  text-align: center;
  font-size: 13px;
  flex-shrink: 0;
}
.step-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.step-fn {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  color: var(--color-ink-4);
  white-space: nowrap;
  flex-shrink: 0;
}
.step-dur {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--color-ink-4);
  white-space: nowrap;
  flex-shrink: 0;
}
.step-status {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
}
.step-status.is-done { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 12%, transparent); }
.step-status.is-running { color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 14%, transparent); }
.step-status.is-pending { color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 14%, transparent); }
.step-status.is-error { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 12%, transparent); }
.step-chevron {
  font-size: 10px;
  color: var(--color-ink-4);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}
.step.is-open .step-chevron {
  transform: rotate(90deg);
}

/* 步骤体 */
.step-body {
  padding: 0 14px 12px 38px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.step-intent {
  margin: 0;
  padding: 8px 11px;
  border-left: 2px solid color-mix(in srgb, var(--color-accent) 36%, transparent);
  background: color-mix(in srgb, var(--color-accent) 4%, transparent);
  color: var(--color-ink-2);
  font-size: 12px;
  line-height: 1.65;
  border-radius: 0 4px 4px 0;
}

/* 活动 */
.activity {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── 审批卡 ── */
.approval-card {
  padding: 9px 11px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 28%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-warning) 5%, transparent);
}
.approval-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.approval-title {
  color: var(--color-ink);
  font-size: 12px;
  font-weight: 700;
}
.approval-risk {
  color: var(--color-warning);
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
}
.approval-desc {
  margin: 5px 0 0;
  color: var(--color-ink-2);
  font-size: 11px;
  line-height: 1.55;
}
.approval-args {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 10px;
  margin: 8px 0 0;
  padding: 7px 9px;
  border: 1px solid var(--color-line-hair);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-base) 60%, transparent);
}
.approval-args dt {
  font: 700 10px/1.5 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.approval-args dd {
  margin: 0;
  font: 400 10px/1.5 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-2);
  word-break: break-all;
}
.approval-btns {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.approval-btn {
  height: 24px;
  padding: 0 12px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.approval-btn.is-approve {
  background: var(--color-accent);
  border: 1px solid var(--color-accent);
  color: var(--color-accent-contrast);
}
.approval-btn.is-approve:hover { background: var(--color-accent-strong); }
.approval-btn.is-reject {
  border: 1px solid var(--color-line);
  background: transparent;
  color: var(--color-ink-2);
}
.approval-btn.is-reject:hover {
  border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
  color: var(--color-danger);
}

/* ── 重试按钮 ── */
.retry-btn {
  align-self: flex-start;
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--color-line);
  border-radius: 4px;
  background: transparent;
  color: var(--color-ink-3);
  font-size: 10.5px;
  cursor: pointer;
}
.retry-btn:hover:not(:disabled) {
  color: var(--color-ink);
  background: var(--color-base);
}
.retry-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── 结果预览 ── */
.result-details {
  border: 1px solid var(--color-line-hair);
  border-radius: 4px;
  overflow: hidden;
}
.result-details summary {
  padding: 5px 10px;
  cursor: pointer;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  color: var(--color-ink-3);
  background: color-mix(in srgb, var(--color-base) 50%, transparent);
  user-select: none;
}
.result-details summary:hover {
  color: var(--color-ink-2);
}
.result-pre {
  margin: 0;
  padding: 9px 10px;
  max-height: 200px;
  overflow: auto;
  background: var(--color-base);
  color: var(--color-ink-2);
  font: 400 10.5px/1.55 var(--font-mono, ui-monospace, monospace);
  scrollbar-width: thin;
}

/* ── 结论卡片 ── */
.conclusion {
  border: 1px solid color-mix(in srgb, var(--color-success) 22%, transparent);
  border-left: 3px solid var(--color-success);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-success) 3%, transparent);
  margin: 12px 14px 14px;
  overflow: hidden;
}
.conclusion-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-success) 14%, transparent);
  background: color-mix(in srgb, var(--color-success) 5%, transparent);
}
.conclusion-tag {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 14%, transparent);
  padding: 2px 6px;
  border-radius: 3px;
  letter-spacing: 0.04em;
}
.conclusion-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
}
.conclusion-body {
  padding: 12px 14px;
}

@media (prefers-reduced-motion: reduce) {
  .node.is-running .node-dot { animation: none; opacity: 1; }
}
</style>
