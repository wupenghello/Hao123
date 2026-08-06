<script setup lang="ts">
/** 消息列表：_loopGroup 分组 + 滚动跟随 + 回到最新。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ChatMessage } from '../types'
import { useChatStore } from '../store'
import ChatMessageItem from './ChatMessageItem.vue'
import AssistantTurn from './AssistantTurn.vue'
import '../styles/markdown.css'

const store = useChatStore()

/** 代码块复制：事件委托（markdown 经 v-html 注入的按钮不归 Vue 管） */
async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch { /* 走降级 */ }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch { /* 忽略 */ }
  document.body.removeChild(ta)
  return ok
}

async function onMarkdownClick(e: MouseEvent) {
  const target = e.target as Element | null
  if (!(target instanceof Element)) return
  const btn = target.closest<HTMLButtonElement>('.code-copy-btn')
  if (!btn) return
  e.preventDefault()
  e.stopPropagation()
  if (btn.disabled || btn.dataset.copyDisabled === 'true') return

  const wrapper = btn.closest('.code-block-wrapper')
  const code =
    wrapper?.querySelector('pre code')?.textContent ??
    wrapper?.querySelector('pre')?.textContent ??
    ''
  const originalText = btn.textContent || '复制'
  const ok = await writeClipboardText(code)

  btn.textContent = ok ? '已复制' : '复制失败'
  btn.classList.toggle('copied', ok)
  btn.classList.toggle('copy-failed', !ok)
  setTimeout(() => {
    btn.textContent = originalText
    btn.classList.remove('copied', 'copy-failed')
  }, 1500)
}

/** 分组：同一次 agent 循环（同 _loopGroup 且有最终回答）→ 回合（AssistantTurn）；其余单条 */
interface Group {
  kind: 'turn' | 'single'
  steps: { msg: ChatMessage; index: number }[]
  final: { msg: ChatMessage; index: number } | null
  msg: ChatMessage | null
  index: number
}

/** 时间分隔线标签：跨天显示日期，同一天超 2 小时间隙显示时段 */
function timeSeparator(a: ChatMessage | null, b: ChatMessage): string | null {
  if (!a?.ts || !b.ts) return null
  const pa = new Date(a.ts)
  const pb = new Date(b.ts)
  const sameDay = pa.toDateString() === pb.toDateString()
  if (!sameDay) {
    return pb.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
  }
  if (pb.getTime() - pa.getTime() > 2 * 3_600_000) {
    return pb.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return null
}

const groups = computed<Group[]>(() => {
  const out: Group[] = []
  const msgs = store.messages
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    // 仅当该 loop 组在后续消息中存在最终回答时才归组为回合；否则（历史中途停止的数据）
    // 中间轮各自单条渲染，保证内容始终可见可读。
    if (m.role === 'assistant' && m._loopGroup && !m._loopFinal) {
      let hasFinal = false
      let j = i + 1
      while (j < msgs.length && msgs[j]._loopGroup === m._loopGroup) {
        if (msgs[j]._loopFinal) { hasFinal = true; break }
        j++
      }
      if (hasFinal) {
        // 组头：收集同组后续消息
        const steps: Group['steps'] = [{ msg: m, index: i }]
        let final: Group['final'] = null
        j = i + 1
        while (j < msgs.length && msgs[j]._loopGroup === m._loopGroup) {
          if (msgs[j]._loopFinal) {
            final = { msg: msgs[j], index: j }
          } else {
            steps.push({ msg: msgs[j], index: j })
          }
          j++
        }
        out.push({ kind: 'turn', steps, final, msg: null, index: i })
        i = j - 1
        continue
      }
    }
    out.push({ kind: 'single', steps: [], final: null, msg: m, index: i })
  }
  return out
})

/** 渲染块：在分组间插入时间分隔线 */
interface RenderBlock {
  sep: string | null
  group: Group
}
const renderBlocks = computed<RenderBlock[]>(() => {
  const blocks: RenderBlock[] = []
  let prev: ChatMessage | null = null
  for (const g of groups.value) {
    const anchor = g.kind === 'turn' ? (g.steps[0]?.msg ?? g.final?.msg) : g.msg
    if (anchor) {
      blocks.push({ sep: timeSeparator(prev, anchor), group: g })
      prev = anchor
    } else {
      blocks.push({ sep: null, group: g })
    }
  }
  return blocks
})

/** 是否以 assistant 消息收尾（isLastAssistant 锚点：重答 / reach chips） */
function isLastAssistantAt(index: number): boolean {
  const last = store.messages[store.messages.length - 1]
  return !!last && last.role === 'assistant' && last.id === store.messages[index]?.id && last.id !== undefined
}

// ── 滚动跟随 ──
const scrollEl = ref<HTMLElement | null>(null)
const stickToBottom = ref(true)
const showBackToLatest = ref(false)
const atBottomThreshold = 80
/** 用户上滚断开跟随；回底恢复 */
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

/** 有新增内容且停留在底部时跟随；上滚过则提示回到最新 */
watch(
  () => [store.messages.length, store.messages.map((m) => m.content.length).reduce((a, b) => a + b, 0)],
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
  <div class="msg-wrap">
    <div
      ref="scrollEl"
      class="msg-scroll"
      @scroll="syncScrollState"
      @click="onMarkdownClick"
    >
      <div v-if="!store.hasMessages" class="msg-none" />
      <template v-for="(b, bi) in renderBlocks" :key="bi">
        <div v-if="b.sep" class="msg-date">
          <span class="msg-date-line" aria-hidden="true" />
          <span class="msg-date-text">{{ b.sep }}</span>
          <span class="msg-date-line" aria-hidden="true" />
        </div>
        <AssistantTurn
          v-if="b.group.kind === 'turn' && b.group.final"
          :steps="b.group.steps"
          :final="b.group.final"
          :is-last-assistant="isLastAssistantAt(b.group.final.index)"
          class="msg-block"
          :data-msg-index="b.group.final.index"
        />
        <ChatMessageItem
          v-else-if="b.group.msg"
          :message="b.group.msg"
          :index="b.group.index"
          :is-last-assistant="isLastAssistantAt(b.group.index)"
          :streaming="store.streaming"
          class="msg-block"
          :data-msg-index="b.group.index"
        />
      </template>
    </div>

    <button
      v-show="showBackToLatest"
      type="button"
      class="msg-back"
      @click="scrollToBottom(true)"
    >
      ↓ 回到最新
    </button>
  </div>
</template>

<style scoped>
.msg-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.msg-scroll {
  height: 100%;
  overflow-y: auto;
  padding: 14px 12px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-accent) 20%, transparent) transparent;
}
.msg-none {
  height: 100%;
}
.msg-date {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 0 14px;
}
.msg-date-line {
  flex: 1;
  height: 1px;
  background: var(--color-line-hair);
}
.msg-date-text {
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.08em;
  color: var(--color-ink-4);
  white-space: nowrap;
}
.msg-block {
  margin-bottom: 14px;
}
.msg-back {
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
.msg-back:hover {
  color: var(--color-accent-strong);
  border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
}
</style>
