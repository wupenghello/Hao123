<script setup lang="ts">
/** 单条消息渲染：user 气泡 / 单条 assistant（无 loop 的简单回答委托 AssistantAnswer）。 */
import { computed, ref, watch } from 'vue'
import type { ChatMessage } from '../types'
import AssistantAnswer from './AssistantAnswer.vue'

const props = defineProps<{
  message: ChatMessage
  /** 该消息在 store messages 数组中的真实下标（rate/审批等接口锚点） */
  index: number
  isLastAssistant: boolean
  streaming: boolean
}>()

// ── user 图片：缩略图 + 大图预览 overlay ──
const previewUrl = ref<string | null>(null)
const images = computed(() => props.message.images ?? [])
watch(images, (imgs) => {
  if (previewUrl.value && !imgs.includes(previewUrl.value)) previewUrl.value = null
})

function fmtTime(ts: number | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div v-if="message.role === 'user'" class="msg-user">
    <div class="msg-user-top">
      <span class="msg-eyebrow">我</span>
      <span class="msg-time">{{ fmtTime(message.ts) }}</span>
    </div>
    <div class="msg-user-bubble">
      <p class="msg-user-text">{{ message.content }}</p>
      <div v-if="images.length" class="msg-images">
        <button
          v-for="(img, i) in images"
          :key="i"
          type="button"
          class="msg-thumb"
          title="点击查看大图"
          @click="previewUrl = img"
        >
          <img :src="img" alt="用户附图" />
        </button>
      </div>
    </div>

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

  <AssistantAnswer
    v-else
    :message="message"
    :index="index"
    :is-last-assistant="isLastAssistant"
    :streaming="streaming"
  />
</template>

<style scoped>
.msg-user {
  margin-bottom: 14px;
}
.msg-user-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}
.msg-eyebrow {
  font: 700 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.12em;
  color: var(--color-ink-3);
}
.msg-time {
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.msg-user-bubble {
  max-width: 88%;
  margin-left: auto;
  padding: 9px 12px;
  border: 1px solid var(--color-line);
  border-left: 2px solid var(--color-accent);
  border-radius: 4px;
  background: var(--color-raised);
}
.msg-user-text {
  margin: 0;
  color: var(--color-ink);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.msg-thumb {
  padding: 0;
  border: 1px solid var(--color-line);
  border-radius: 4px;
  overflow: hidden;
  background: transparent;
  cursor: zoom-in;
}
.msg-thumb img {
  display: block;
  width: 72px;
  height: 48px;
  object-fit: cover;
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
</style>
