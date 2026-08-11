<script setup lang="ts">
/**
 * 过程抽屉：一次问答中已执行的工具步骤，默认折叠成一行摘要。
 * 展开后每步一个 ToolActivityRow + 结果预览；pending 步内联审批卡。
 * 答案优先原则：过程永远是次要信息，但一步可审计。
 */
import { ref, computed } from 'vue'
import type { Turn, ToolStep } from '../turns'
import { useChatStore } from '../store'
import ToolActivityRow from './ToolActivityRow.vue'
import IconChevron from '~icons/mdi/chevron-down'
import { summarizeReachResult } from '@/features/reach'

const props = defineProps<{
  turn: Turn
}>()

const store = useChatStore()

const open = ref(false)
const expandedSteps = ref<Set<number>>(new Set())

const steps = computed(() => props.turn.steps ?? [])
const errCount = computed(() => steps.value.filter((s) => s.status === 'error').length)
const doneCount = computed(() => steps.value.filter((s) => s.status === 'done').length)

/** 折叠态摘要：人类可读标签，不裸示 reach__search */
const summary = computed(() => {
  const n = steps.value.length
  if (!n) return ''
  const parts = [`${n} 个动作`]
  if (doneCount.value) parts.push(`${doneCount.value} 成功`)
  if (errCount.value) parts.push(`${errCount.value} 失败`)
  if (steps.value.some((s) => s.status === 'pending')) parts.push('待确认')
  return parts.join(' · ')
})

function stepStatus(si: number): string {
  const acts = steps.value[si]
  if (!acts) return 'done'
  if (acts.status === 'pending') return 'pending'
  if (acts.status === 'running') return 'running'
  if (acts.status === 'error') return 'error'
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
  const d = steps.value[si]?.duration
  if (!d) return '—'
  return d < 1000 ? `${d}ms` : `${(d / 1000).toFixed(1)}s`
}

function toolIcon(name: string): string {
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

function toggleStep(si: number) {
  const next = new Set(expandedSteps.value)
  if (next.has(si)) next.delete(si)
  else next.add(si)
  expandedSteps.value = next
}

function actResult(s: ToolStep): string {
  if (!s.result) return ''
  const reach = summarizeReachResult(s.tool, s.result)
  if (reach) return reach
  try { return JSON.stringify(JSON.parse(s.result), null, 2) } catch { return s.result }
}

/** 审批参数（step.args 转成可展示的 key-value） */
function approvalArgs(s: ToolStep): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(s.args ?? {})) {
    out[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
  }
  return out
}

function onApprove(si: number) {
  void store.approveTool(props.turn.id, si)
}
function onReject(si: number) {
  void store.rejectTool(props.turn.id, si)
}
function onRetry(si: number) {
  void store.retryTool(props.turn.id, si)
}
</script>

<template>
  <div v-if="steps.length" class="process" :class="{ 'is-open': open }">
    <!-- 折叠头 -->
    <button type="button" class="process-head" @click="open = !open">
      <IconChevron class="process-chevron w-3.5 h-3.5" aria-hidden="true" />
      <span class="process-summary">{{ summary }}</span>
      <span class="spacer" />
      <span class="process-toggle">{{ open ? '收起' : '展开过程' }}</span>
    </button>

    <!-- 步骤列表 -->
    <div v-if="open" class="process-body">
      <div
        v-for="(s, si) in steps"
        :key="s.callId ?? si"
        class="step"
        :class="{ 'is-open': expandedSteps.has(si) }"
      >
        <div class="step-head" @click="toggleStep(si)">
          <span class="step-icon">{{ toolIcon(s.tool) }}</span>
          <span class="step-name">{{ s.label }}</span>
          <span class="spacer" />
          <span class="step-dur">{{ stepDuration(si) }}</span>
          <span class="step-status" :class="`is-${stepStatus(si)}`">{{ stepStatusLabel(si) }}</span>
          <span class="step-chevron" aria-hidden="true">▸</span>
        </div>

        <div v-if="expandedSteps.has(si)" class="step-body">
          <p v-if="s.intent?.trim()" class="step-intent">{{ s.intent.trim() }}</p>
          <ToolActivityRow :step="s" :compact="true" />

          <!-- 审批卡（pending 内嵌） -->
          <div v-if="s.status === 'pending' && s.approval" class="approval-card">
            <div class="approval-head">
              <span class="approval-title">{{ s.approval.title }}</span>
              <span class="approval-risk">{{ s.approval.risk }}</span>
            </div>
            <p v-if="s.approval.description" class="approval-desc">{{ s.approval.description }}</p>
            <dl v-if="Object.keys(approvalArgs(s)).length" class="approval-args">
              <template v-for="(v, k) in approvalArgs(s)" :key="k">
                <dt>{{ k }}</dt>
                <dd>{{ v }}</dd>
              </template>
            </dl>
            <div class="approval-btns">
              <button type="button" class="approval-btn is-approve" @click.stop="onApprove(si)">批准</button>
              <button type="button" class="approval-btn is-reject" @click.stop="onReject(si)">拒绝</button>
            </div>
          </div>

          <!-- 失败 → 重试 -->
          <button
            v-else-if="s.status === 'error'"
            type="button"
            class="retry-btn"
            :disabled="store.streaming"
            @click.stop="onRetry(si)"
          >重试</button>

          <!-- 成功且有结果 → 折叠预览 -->
          <details v-else-if="s.result" class="result-details">
            <summary>查看结果</summary>
            <pre class="result-pre">{{ actResult(s) }}</pre>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.process {
  border: 1px solid var(--color-line-hair);
  border-radius: 6px;
  margin-bottom: 10px;
  overflow: hidden;
}
.process-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 30px;
  padding: 0 10px;
  border: none;
  background: color-mix(in srgb, var(--color-base) 45%, transparent);
  color: var(--color-ink-2);
  font-size: 11.5px;
  cursor: pointer;
}
.process-head:hover {
  color: var(--color-ink);
}
.process-chevron {
  transition: transform 0.15s ease;
  color: var(--color-ink-3);
}
.process.is-open .process-chevron {
  transform: rotate(180deg);
}
.process-summary {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  color: var(--color-ink-3);
}
.process-toggle {
  font-size: 10.5px;
  color: var(--color-ink-3);
}
.spacer { flex: 1; }

.process-body {
  border-top: 1px solid var(--color-line-hair);
}
.step {
  border-bottom: 1px solid var(--color-line-hair);
}
.step:last-child { border-bottom: none; }
.step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.12s ease;
}
.step-head:hover {
  background: color-mix(in srgb, var(--color-accent) 3%, transparent);
}
.step-icon { width: 16px; text-align: center; font-size: 13px; flex-shrink: 0; }
.step-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.step-chevron { font-size: 10px; color: var(--color-ink-4); transition: transform 0.15s ease; flex-shrink: 0; }
.step.is-open .step-chevron { transform: rotate(90deg); }

.step-body {
  padding: 0 12px 12px 38px;
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

.approval-card {
  padding: 9px 11px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 28%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-warning) 5%, transparent);
}
.approval-head { display: flex; align-items: center; gap: 8px; }
.approval-title { color: var(--color-ink); font-size: 12px; font-weight: 700; }
.approval-risk { color: var(--color-warning); font: 400 10px/1 var(--font-mono, ui-monospace, monospace); }
.approval-desc { margin: 5px 0 0; color: var(--color-ink-2); font-size: 11px; line-height: 1.55; }
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
.approval-args dt { font: 700 10px/1.5 var(--font-mono, ui-monospace, monospace); color: var(--color-ink-3); }
.approval-args dd { margin: 0; font: 400 10px/1.5 var(--font-mono, ui-monospace, monospace); color: var(--color-ink-2); word-break: break-all; }
.approval-btns { display: flex; gap: 6px; margin-top: 8px; }
.approval-btn {
  height: 24px;
  padding: 0 12px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.approval-btn.is-approve { background: var(--color-accent); border: 1px solid var(--color-accent); color: var(--color-accent-contrast); }
.approval-btn.is-approve:hover { background: var(--color-accent-strong); }
.approval-btn.is-reject { border: 1px solid var(--color-line); background: transparent; color: var(--color-ink-2); }
.approval-btn.is-reject:hover { border-color: color-mix(in srgb, var(--color-danger) 50%, transparent); color: var(--color-danger); }

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
.retry-btn:hover:not(:disabled) { color: var(--color-ink); background: var(--color-base); }
.retry-btn:disabled { opacity: 0.4; cursor: not-allowed; }

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
.result-details summary:hover { color: var(--color-ink-2); }
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
</style>
