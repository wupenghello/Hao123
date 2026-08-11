<script setup lang="ts">
/**
 * 答案卡：最终回答正文（markdown + 生成式 UI 卡 + 动作行）。
 * 分型渲染的共同底座：无论 answer-first / report / taskflow，答案都清晰呈现。
 */
import { computed, ref } from 'vue'
import type { Turn } from '../turns'
import { useChatStore } from '../store'
import { renderMarkdown } from '../markdown'
import GenerativeUiBlock from './GenerativeUiBlock.vue'
import IconCopy from '~icons/mdi/content-copy'
import IconRefresh from '~icons/mdi/refresh'
import IconThumbUp from '~icons/mdi/thumb-up-outline'
import IconThumbDown from '~icons/mdi/thumb-down-outline'

const props = defineProps<{
  turn: Turn
  /** 该 turn 在 store turns 数组中的真实下标（rate 锚点） */
  index: number
  isLastTurn: boolean
  streaming: boolean
}>()

const store = useChatStore()

const mdHtml = computed(() =>
  renderMarkdown(props.turn.answer, { streaming: props.streaming }),
)

const canCopy = computed(() => props.turn.answer.trim().length > 0)
const copied = ref(false)
async function copyMessage() {
  if (!canCopy.value) return
  if (!navigator.clipboard?.writeText) return
  try {
    await navigator.clipboard.writeText(props.turn.answer)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch { /* 忽略 */ }
}

function fmtTime(ts: number | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** reach 信任分层：turn 内成功执行过 reach 查询 */
const reachSteps = computed(() =>
  (props.turn.steps ?? []).filter((s) => s.tool.startsWith('reach__') && s.status === 'done'),
)
const usesExternalResearch = computed(() => reachSteps.value.length > 0)

/** reach 答案后的「继续调研」chip（仅成功 reach、非流式、且是最终回答） */
const REACH_FOLLOW_UPS: { label: string; text: string }[] = [
  { label: '再深入', text: '针对刚才的调研，挑最重要的发现再深入展开，必要时补充新来源。' },
  { label: '换来源', text: '换一批来源重新查一下刚才的问题，看看有没有不同结论。' },
  { label: '整理成文档', text: '把刚才的调研结果整理成一份 Markdown 记录，方便我存到知识库或周报。' },
]
const showReachFollowUps = computed(() => props.isLastTurn && usesExternalResearch.value && !props.streaming)

function sendFollowUp(text: string) {
  void store.send(text)
}

// 流式光标
const showCursor = computed(() => props.streaming && props.isLastTurn && !props.turn.answer.trim())
</script>

<template>
  <div class="answer">
    <div class="answer-top">
      <span class="answer-time">{{ fmtTime(turn.updatedAt) }}</span>
    </div>

    <div v-if="showCursor" class="answer-thinking" aria-hidden="true">
      <span class="answer-thinking-dots"><i /><i /><i /></span>
      <span class="answer-thinking-text">正在组织回答</span>
    </div>

    <div
      v-else-if="turn.answer.trim()"
      class="md-content"
      v-html="mdHtml"
    />

    <!-- 生成式 UI 卡片栈 -->
    <div v-if="turn.uiBlocks?.length" class="answer-ui">
      <GenerativeUiBlock v-for="b in turn.uiBlocks" :key="b.id" :block="b" />
    </div>

    <!-- reach 信任徽标 -->
    <div v-if="usesExternalResearch" class="answer-reach">
      <span class="answer-reach-badge">🌐 基于公开网络信息 · 请核实</span>
      <span v-if="reachSteps.length > 1" class="answer-reach-count">{{ reachSteps.length }} 来源</span>
    </div>

    <!-- 动作行 -->
    <div class="answer-actions">
      <button v-if="canCopy" type="button" class="answer-action" :class="{ 'is-copied': copied }" @click="copyMessage">
        <IconCopy class="w-3.5 h-3.5" />
        <span>{{ copied ? '已复制' : '复制' }}</span>
      </button>
      <button
        v-if="isLastTurn"
        type="button"
        class="answer-action"
        :disabled="store.streaming"
        title="重新生成"
        @click="store.regenerate()"
      >
        <IconRefresh class="w-3.5 h-3.5" />
        <span>重答</span>
      </button>
      <button
        type="button"
        class="answer-action"
        :class="{ 'is-active-up': turn.feedback === 'up' }"
        title="有用"
        @click="store.rate(index, 'up')"
      >
        <IconThumbUp class="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        class="answer-action"
        :class="{ 'is-active-down': turn.feedback === 'down' }"
        title="没用"
        @click="store.rate(index, 'down')"
      >
        <IconThumbDown class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- reach 继续调研 chips -->
    <div v-if="showReachFollowUps" class="answer-followups">
      <button
        v-for="f in REACH_FOLLOW_UPS"
        :key="f.label"
        type="button"
        class="answer-chip"
        @click="sendFollowUp(f.text)"
      >
        {{ f.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.answer-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.answer-time {
  margin-left: auto;
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-4);
}
.answer-thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  color: var(--color-ink-3);
}
.answer-thinking-dots {
  display: inline-flex;
  gap: 3px;
}
.answer-thinking-dots i {
  width: 4px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-accent);
  opacity: 0.35;
  animation: thinking-bounce 1.1s ease-in-out infinite;
}
.answer-thinking-dots i:nth-child(2) { animation-delay: 0.15s; }
.answer-thinking-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes thinking-bounce {
  0%, 100% { opacity: 0.35; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}
.answer-thinking-text {
  font: 400 10.5px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.04em;
}
.md-content {
  color: var(--color-ink-2);
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}
.answer-ui {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.answer-reach {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.answer-reach-badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 45%, transparent);
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-warning) 10%, transparent);
  color: var(--color-warning);
  font: 700 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.04em;
}
.answer-reach-count {
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.answer-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 8px;
  /* 默认隐藏，hover / 键盘聚焦才浮现——避免每条回答下常驻一排按钮造成视觉噪音 */
  opacity: 0;
  transition: opacity 0.15s ease;
}
.answer:hover .answer-actions,
.answer-actions:focus-within {
  opacity: 1;
}
.answer-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 7px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--color-ink-3);
  font-size: 11px;
  cursor: pointer;
}
.answer-action:hover:not(:disabled) {
  background: var(--color-raised);
  color: var(--color-ink);
}
.answer-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.answer-action.is-active-up { color: var(--color-success); }
.answer-action.is-active-down { color: var(--color-danger); }
.answer-action.is-copied { color: var(--color-success); }
.answer-action:focus-visible {
  outline: 1px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
  outline-offset: 1px;
}
.answer-followups {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.answer-chip {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--color-line);
  border-radius: 3px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: 11px;
  cursor: pointer;
}
.answer-chip:hover {
  border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  color: var(--color-accent-strong);
}

@media (prefers-reduced-motion: reduce) {
  .answer-thinking-dots i { animation: none; opacity: 0.8; }
}
</style>
