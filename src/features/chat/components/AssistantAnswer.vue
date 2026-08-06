<script setup lang="ts">
/** assistant 正文渲染：markdown + 生成式 UI 卡 + 动作行（复制/重答/赞/踩）+ reach 信任徽标与继续调研 chips。 */
import { computed, ref, watch } from 'vue'
import type { ChatMessage } from '../types'
import { useChatStore } from '../store'
import { renderMarkdown } from '../markdown'
import { isRawJsonLeak } from '../utils'
import GenerativeUiBlock from './GenerativeUiBlock.vue'
import IconCopy from '~icons/mdi/content-copy'
import IconRefresh from '~icons/mdi/refresh'
import IconThumbUp from '~icons/mdi/thumb-up-outline'
import IconThumbDown from '~icons/mdi/thumb-down-outline'

const props = defineProps<{
  message: ChatMessage
  /** 该消息在 store messages 数组中的真实下标（rate/审批等接口锚点） */
  index: number
  isLastAssistant: boolean
  streaming: boolean
}>()

const store = useChatStore()

/** JSON 泄漏兜底：当前消息正文是模型贴出的工具原始 JSON（或流式期间命中抑制），不渲染原文。 */
const isLeak = computed(() => {
  if (store.leakSuppressed) return true
  return isRawJsonLeak(props.message.content)
})

const mdHtml = computed(() =>
  isLeak.value ? '' : renderMarkdown(props.message.content, { streaming: props.streaming }),
)

/** 是否展示「复制」：assistant 有正文且有内容 */
const canCopy = computed(() => props.message.content.trim().length > 0)

// 复制反馈
const copied = ref(false)
async function copyMessage() {
  if (!canCopy.value) return
  const text = props.message.content
  if (!navigator.clipboard?.writeText) return
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch { /* 忽略 */ }
}

function fmtTime(ts: number | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── 图片：缩略图 + 大图预览 overlay ──
const previewUrl = ref<string | null>(null)
const images = computed(() => props.message.images ?? [])
watch(images, (imgs) => {
  if (previewUrl.value && !imgs.includes(previewUrl.value)) previewUrl.value = null
})

// ── reach 信任分层：回溯同 _loopGroup 的成功 reach 活动 ──
function isDoneReach(a: { name: string; status: string }): boolean {
  return a.name.startsWith('reach__') && a.status === 'done'
}
const usesExternalResearch = computed(() => {
  const m = props.message
  if (m.activities?.some(isDoneReach)) return true
  if (m._loopGroup) {
    return store.messages.some((mm) => mm._loopGroup === m._loopGroup && mm.activities?.some(isDoneReach))
  }
  return false
})
const externalSourceCount = computed(() => {
  const m = props.message
  const group = m._loopGroup ? store.messages.filter((mm) => mm._loopGroup === m._loopGroup) : [m]
  return group.flatMap((mm) => mm.activities ?? []).filter(isDoneReach).length
})

/** reach 答案后的「继续调研」chip（仅成功 reach、非流式、且是最终回答） */
const REACH_FOLLOW_UPS: { label: string; text: string }[] = [
  { label: '再深入', text: '针对刚才的调研，挑最重要的发现再深入展开，必要时补充新来源。' },
  { label: '换来源', text: '换一批来源重新查一下刚才的问题，看看有没有不同结论。' },
  { label: '整理成文档', text: '把刚才的调研结果整理成一份 Markdown 记录，方便我存到知识库或周报。' },
]
const showReachFollowUps = computed(() => props.isLastAssistant && usesExternalResearch.value && !props.streaming)

function sendFollowUp(text: string) {
  void store.send(text)
}

// 流式光标：streaming 且内容为空（等待首 token）
const showCursor = computed(() => props.streaming && props.isLastAssistant && !props.message.content.trim())
</script>

<template>
  <div class="answer">
    <div class="answer-top">
      <span v-if="message.feedback" class="answer-feedback-tag" :class="`is-${message.feedback}`">
        {{ message.feedback === 'up' ? '赞' : '踩' }}
      </span>
      <span class="answer-time">{{ fmtTime(message.ts) }}</span>
    </div>

    <div v-if="showCursor" class="answer-thinking" aria-hidden="true">
      <span class="answer-thinking-dots"><i /><i /><i /></span>
      <span class="answer-thinking-text">正在组织回答</span>
    </div>

    <div
      v-else-if="message.content.trim()"
      class="md-content"
      v-html="mdHtml"
    />

    <!-- JSON 泄漏提示（流式抑制中：生成中提示；已收尾且确为泄漏：隐藏 + 重答入口） -->
    <div v-if="isLeak && message.content.trim()" class="answer-leak" role="note">
      <span class="answer-leak-dot" aria-hidden="true" />
      <span class="answer-leak-text">
        {{ streaming ? '小吴正在输出异常内容（原始数据），生成完成后会自动隐藏' : '小吴把工具返回的原始数据直接贴出来了，这段不显示。' }}
      </span>
      <button
        v-if="!streaming"
        type="button"
        class="answer-leak-link"
        title="让小吴把数据整理成易懂的回答"
        @click="store.send('不要贴工具返回的原始 JSON，请把结果整理成自然语言回答')"
      >让小吴重答</button>
    </div>

    <!-- 生成式 UI 卡片栈（白名单 9 kind） -->
    <div v-if="message.ui?.length" class="answer-ui">
      <GenerativeUiBlock v-for="b in message.ui" :key="b.id" :block="b" />
    </div>

    <!-- reach 信任徽标：答案基于公开网络信息 -->
    <div v-if="usesExternalResearch" class="answer-reach">
      <span class="answer-reach-badge">🌐 基于公开网络信息 · 请核实</span>
      <span v-if="externalSourceCount > 1" class="answer-reach-count">{{ externalSourceCount }} 来源</span>
    </div>

    <!-- 动作行：复制 / 重新生成 / 赞 / 踩 -->
    <div class="answer-actions">
      <button v-if="canCopy" type="button" class="answer-action" :class="{ 'is-copied': copied }" @click="copyMessage">
        <IconCopy class="w-3.5 h-3.5" />
        <span>{{ copied ? '已复制' : '复制' }}</span>
      </button>
      <button
        v-if="isLastAssistant"
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
        :class="{ 'is-active-up': message.feedback === 'up' }"
        title="有用"
        @click="store.rate(index, 'up')"
      >
        <IconThumbUp class="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        class="answer-action"
        :class="{ 'is-active-down': message.feedback === 'down' }"
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

    <!-- 图片大图预览 overlay -->
    <Teleport to="body">
      <div
        v-if="previewUrl"
        class="img-overlay"
        role="dialog"
        aria-modal="true"
        @click="previewUrl = null"
      >
        <img :src="previewUrl" class="img-full" alt="图片大图" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.answer-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.answer-feedback-tag {
  padding: 1px 5px;
  border-radius: 3px;
  font: 700 9.5px/1.3 var(--font-mono, ui-monospace, monospace);
}
.answer-feedback-tag.is-up {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 14%, transparent);
}
.answer-feedback-tag.is-down {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 14%, transparent);
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
.answer-leak {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  padding: 5px 10px;
  border: 1px dashed color-mix(in srgb, var(--color-warning) 40%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-warning) 5%, transparent);
  color: var(--color-ink-3);
  font-size: 11.5px;
}
.answer-leak-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 2px;
  background: var(--color-warning);
}
.answer-leak-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.answer-leak-link {
  flex: 0 0 auto;
  margin-left: auto;
  height: 22px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 45%, transparent);
  border-radius: 3px;
  background: transparent;
  color: var(--color-warning);
  font-size: 10.5px;
  cursor: pointer;
}
.answer-leak-link:hover {
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
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
  margin-top: 10px;
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
.img-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.72);
  cursor: zoom-out;
}
.img-full {
  max-width: 86vw;
  max-height: 86vh;
  border-radius: 6px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
}

@media (prefers-reduced-motion: reduce) {
  .answer-thinking-dots i { animation: none; opacity: 0.8; }
}
</style>
