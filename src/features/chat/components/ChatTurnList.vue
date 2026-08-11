<script setup lang="ts">
/** Turn 列表：遍历 activeTurns 渲染 TurnCard + 滚动跟随 + 回到最新 + 时间分隔线。 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch, computed } from 'vue'
import type { Turn } from '../turns'
import { useChatStore } from '../store'
import TurnCard from './TurnCard.vue'
import '../styles/markdown.css'

const store = useChatStore()

/** 时间分隔线标签：跨天显示日期，同一天超 2 小时间隙显示时段 */
function timeSeparator(aTs: number | undefined, bTs: number): string | null {
  if (!aTs) return null
  const pa = new Date(aTs)
  const pb = new Date(bTs)
  const sameDay = pa.toDateString() === pb.toDateString()
  if (!sameDay) {
    return pb.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
  }
  if (pb.getTime() - pa.getTime() > 2 * 3_600_000) {
    return pb.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return null
}

interface RenderBlock {
  sep: string | null
  index: number
  turn: Turn
}
const renderBlocks = computed<RenderBlock[]>(() => {
  const blocks: RenderBlock[] = []
  let prevTs: number | undefined
  const turns = store.activeTurns
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]
    blocks.push({ sep: timeSeparator(prevTs, t.createdAt), index: i, turn: t })
    prevTs = t.createdAt
  }
  return blocks
})

// ── 滚动跟随 ──
const scrollEl = ref<HTMLElement | null>(null)
const stickToBottom = ref(true)
const showBackToLatest = ref(false)
const atBottomThreshold = 80

function syncScrollState() {
  const el = scrollEl.value
  if (!el) return
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < atBottomThreshold
  if (atBottom) {
    stickToBottom.value = true
    showBackToLatest.value = false
  } else {
    stickToBottom.value = false
  }
}

function scrollToBottom(smooth = false) {
  const el = scrollEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  stickToBottom.value = true
  showBackToLatest.value = false
}

watch(
  () => store.activeTurns.length,
  async () => {
    if (stickToBottom.value) {
      await nextTick()
      const el = scrollEl.value
      if (el) el.scrollTop = el.scrollHeight
    } else {
      showBackToLatest.value = true
    }
  },
  { flush: 'post' },
)

onMounted(() => scrollToBottom(false))
onBeforeUnmount(() => {
  scrollEl.value?.removeEventListener('scroll', syncScrollState)
})
</script>

<template>
  <div class="turn-wrap">
    <div
      ref="scrollEl"
      class="turn-scroll"
      @scroll="syncScrollState"
    >
      <template v-for="(b, bi) in renderBlocks" :key="bi">
        <div v-if="b.sep" class="turn-date">
          <span class="turn-date-line" aria-hidden="true" />
          <span class="turn-date-text">{{ b.sep }}</span>
          <span class="turn-date-line" aria-hidden="true" />
        </div>
        <TurnCard
          :turn="b.turn"
          :index="b.index"
          :is-last-turn="b.index === store.activeTurns.length - 1"
          :streaming="store.streaming"
          class="turn-block"
          :data-msg-index="b.index"
        />
      </template>
    </div>

    <button
      v-show="showBackToLatest"
      type="button"
      class="turn-back"
      @click="scrollToBottom(true)"
    >
      ↓ 回到最新
    </button>
  </div>
</template>

<style scoped>
.turn-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.turn-scroll {
  height: 100%;
  overflow-y: auto;
  padding: 14px 12px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-accent) 20%, transparent) transparent;
}
.turn-date {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 0 14px;
}
.turn-date-line {
  flex: 1;
  height: 1px;
  background: var(--color-line-hair);
}
.turn-date-text {
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.08em;
  color: var(--color-ink-4);
  white-space: nowrap;
}
.turn-block {
  margin-bottom: 14px;
}
.turn-back {
  position: absolute;
  right: 14px;
  bottom: 12px;
  z-index: 5;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 4px;
  background: var(--color-raised);
  color: var(--color-ink-2);
  font: 600 11px/1 var(--font-mono, ui-monospace, monospace);
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
.turn-back:hover {
  color: var(--color-accent-strong);
  border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
}
</style>
