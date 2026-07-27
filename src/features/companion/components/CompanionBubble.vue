<script setup lang="ts">
/**
 * 伙伴语音气泡。
 * - role="status" aria-live="polite"：屏幕阅读器朗读。
 * - 自动消失（insight 不自动消失，需用户处理）；hover 暂停计时。
 * - ✕ 关闭（emit dismiss）；hand-off chip（emit handoff + dismiss）。
 * - 容器用 v-show + opacity（避免流式高频 patch 下 Transition leave 卡住）。
 */
import { watch, onUnmounted } from 'vue'
import type { BubblePayload } from '../types'
import { BUBBLE_AUTO_DISMISS_MS } from '../config'
import IconClose from '~icons/mdi/close'
import IconArrow from '~icons/mdi/arrow-right-circle-outline'

const props = defineProps<{ bubble: BubblePayload }>()
const emit = defineEmits<{
  dismiss: []
  handoff: [BubblePayload]
}>()

let timer: ReturnType<typeof setTimeout> | undefined

function arm(): void {
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
  // insight 需用户处理，不自动消失；其余 BUBBLE_AUTO_DISMISS_MS 后自动关
  if (props.bubble.kind !== 'insight') {
    timer = setTimeout(() => emit('dismiss'), BUBBLE_AUTO_DISMISS_MS)
  }
}

watch(
  () => props.bubble.id,
  () => arm(),
  { immediate: true },
)

function onEnter(): void {
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
}
function onLeave(): void {
  arm()
}
function close(): void {
  emit('dismiss')
}
function go(): void {
  emit('handoff', props.bubble)
  emit('dismiss')
}

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div
    class="cp-bubble"
    :class="`is-${bubble.kind}`"
    role="status"
    aria-live="polite"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <span class="cp-bubble-rail" aria-hidden="true" />
    <p class="cp-bubble-text">{{ bubble.text }}</p>
    <div class="cp-bubble-actions">
      <button
        v-if="bubble.handoff && bubble.actionLabel"
        type="button"
        class="cp-bubble-go"
        @click="go"
      >
        <IconArrow class="w-3 h-3" />
        <span>{{ bubble.actionLabel }}</span>
      </button>
      <button type="button" class="cp-bubble-x" aria-label="关闭提示" @click="close">
        <IconClose class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.cp-bubble {
  position: absolute;
  right: 100%;
  top: 12px;
  margin-right: 10px;
  max-width: 260px;
  padding: 10px 12px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(10, 20, 38, 0.94), rgba(4, 10, 22, 0.92));
  border: 1px solid color-mix(in srgb, var(--cp-tone, #22d3ee) 32%, rgba(148, 163, 184, 0.18));
  box-shadow: 0 10px 30px rgba(2, 6, 23, 0.42), 0 0 22px color-mix(in srgb, var(--cp-glow, rgba(34, 211, 238, 0.2)) 60%, transparent);
  backdrop-filter: blur(8px);
  color: rgba(248, 250, 252, 0.94);
  font-size: 12.5px;
  line-height: 1.55;
  text-align: left;
  user-select: none;
}
.cp-bubble-rail {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  border-radius: 12px 0 0 12px;
  background: linear-gradient(180deg, transparent, var(--cp-tone, #22d3ee), transparent);
  opacity: 0.78;
}
.cp-bubble-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.cp-bubble-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.cp-bubble-go {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--cp-tone, #22d3ee) 45%, transparent);
  background: color-mix(in srgb, var(--cp-tone, #22d3ee) 16%, transparent);
  color: var(--cp-tone, #22d3ee);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.cp-bubble-go:hover {
  background: color-mix(in srgb, var(--cp-tone, #22d3ee) 28%, transparent);
}
.cp-bubble-x {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.5);
  color: rgba(226, 232, 240, 0.7);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.cp-bubble-x:hover {
  color: rgba(248, 250, 252, 0.95);
  border-color: rgba(148, 163, 184, 0.4);
}
.cp-bubble.is-celebration {
  border-color: color-mix(in srgb, #34d399 38%, rgba(148, 163, 184, 0.18));
}
.cp-bubble.is-recovery {
  border-color: color-mix(in srgb, #34d399 30%, rgba(148, 163, 184, 0.18));
}
.cp-bubble.is-insight {
  border-color: color-mix(in srgb, #2dd4bf 34%, rgba(148, 163, 184, 0.18));
}
@media (max-width: 480px) {
  .cp-bubble {
    top: auto;
    bottom: 100%;
    right: 50%;
    transform: translateX(50%);
    margin-right: 0;
    margin-bottom: 10px;
    max-width: 80vw;
  }
}
</style>
