<script setup lang="ts">
/** 右侧停靠聊天面板壳：Header + 通知区 + Turn 流 + 输入区。 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useChatStore } from '../store'
import ChatPanelHeader from './ChatPanelHeader.vue'
import NotificationBar from './NotificationBar.vue'
import ChatTurnList from './ChatTurnList.vue'
import ChatComposer from './ChatComposer.vue'
import ChatEmptyState from './ChatEmptyState.vue'

const store = useChatStore()

/** 打开面板时清未读 */
watch(
  () => store.open,
  (o) => {
    if (o) store.unread = false
  },
)

// ── 面板宽度：左边缘拖拽缩放（持久化；范围 320–760px） ──
const PANEL_W_KEY = 'hao123-chat-panel-size'
const PANEL_W_MIN = 320
const PANEL_W_MAX = 760

const panelW = ref(400)
function loadPanelW() {
  try {
    const raw = localStorage.getItem(PANEL_W_KEY)
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n)) panelW.value = Math.max(PANEL_W_MIN, Math.min(PANEL_W_MAX, n))
    }
  } catch { /* 忽略损坏的存储 */ }
}
function applyPanelW() {
  document.documentElement.style.setProperty('--chat-panel-w', `${panelW.value}px`)
}
onMounted(() => {
  loadPanelW()
  applyPanelW()
})

let dragging = false
let startX = 0
let startW = 0
/** 拖动期间禁用 aside 的 width transition（否则 340ms 缓动让左边缘跟不上光标，视觉像整块在滑） */
function setResizing(on: boolean) {
  document.documentElement.classList.toggle('chat-resizing', on)
}
function onResizeDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  dragging = true
  startX = e.clientX
  startW = panelW.value
  setResizing(true)
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
}
function onResizeMove(e: PointerEvent) {
  if (!dragging) return
  // 手柄在面板左边缘，右边缘固定贴视口：左边缘跟随光标位置。
  // 往左拖（dx<0）→ 左边缘左移 → 面板变宽；往右拖（dx>0）→ 变窄。
  panelW.value = Math.max(PANEL_W_MIN, Math.min(PANEL_W_MAX, startW - (e.clientX - startX)))
  applyPanelW()
}
function onResizeUp(e: PointerEvent) {
  if (!dragging) return
  dragging = false
  setResizing(false)
  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* 忽略 */ }
  try { localStorage.setItem(PANEL_W_KEY, String(panelW.value)) } catch { /* 忽略 */ }
}
onBeforeUnmount(() => {
  if (dragging) {
    dragging = false
    setResizing(false)
  }
})

/** 审批条点击 → 滚动定位到对应 Turn 卡 */
function locateApproval() {
  const first = store.pendingApprovals[0]
  if (!first) return
  const el = document.querySelector('.turn-scroll')
  if (!el) return
  const targets = el.querySelectorAll<HTMLElement>('[data-msg-index]')
  const target = Array.from(targets).find((n) => Number(n.dataset.msgIndex) === Number(first.stepIndex))
  if (target) {
    target.scrollIntoView({ block: 'center' })
    return
  }
  el.scrollTop = el.scrollHeight
}
</script>

<template>
  <div class="panel">
    <div
      class="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整面板宽度"
      @pointerdown="onResizeDown"
      @pointermove="onResizeMove"
      @pointerup="onResizeUp"
      @pointercancel="onResizeUp"
    />
    <ChatPanelHeader @close="store.close()" />

    <NotificationBar @locate="locateApproval" />

    <ChatEmptyState v-if="!store.hasMessages" />
    <ChatTurnList v-else />
    <ChatComposer />
  </div>
</template>

<style scoped>
.panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  /* 深色玻璃拟态：半透明深蓝 + 强 blur 透出主页光晕，与 dock/菜单同款配方（对齐 glass-strong 档） */
  background: linear-gradient(180deg, rgba(14, 22, 34, 0.82), rgba(7, 11, 20, 0.9));
  border-left: 1px solid color-mix(in srgb, var(--color-accent) 22%, var(--color-line));
  box-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.08),
    -12px 0 40px -20px rgba(0, 8, 16, 0.7),
    0 0 32px -10px color-mix(in srgb, var(--color-accent) 18%, transparent);
  -webkit-backdrop-filter: blur(22px) saturate(170%);
  backdrop-filter: blur(22px) saturate(170%);
}

/* 左边缘拖拽手柄：调整面板宽度 */
.panel-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
  z-index: 5;
  cursor: col-resize;
  touch-action: none;
}
.panel-resizer:hover::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  background: color-mix(in srgb, var(--color-accent) 45%, transparent);
}
.panel-resizer:active::after {
  background: var(--color-accent);
}
</style>
