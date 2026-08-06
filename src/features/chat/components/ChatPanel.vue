<script setup lang="ts">
/** 右侧停靠聊天面板壳：错误横幅 + 审批提示条 + 消息区 + 输入区。 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useChatStore } from '../store'
import { useConnectivity } from '../connectivity'
import ChatPanelHeader from './ChatPanelHeader.vue'
import ApprovalBar from './ApprovalBar.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatComposer from './ChatComposer.vue'
import ChatEmptyState from './ChatEmptyState.vue'
import IconRetry from '~icons/mdi/refresh'
import IconClose from '~icons/mdi/close'

const store = useChatStore()
const { status: connectivityStatus, message: connectivityMsg } = useConnectivity()

/** 打开面板时清未读 */
watch(
  () => store.open,
  (o) => {
    if (o) store.unread = false
  },
)

function onRetry() {
  void store.retryConnection()
}

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
function onResizeDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  dragging = true
  startX = e.clientX
  startW = panelW.value
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
}
function onResizeMove(e: PointerEvent) {
  if (!dragging) return
  // 手柄在面板左边缘：向左拖（dx<0）→ 面板变宽
  panelW.value = Math.max(PANEL_W_MIN, Math.min(PANEL_W_MAX, startW - (e.clientX - startX)))
  applyPanelW()
}
function onResizeUp(e: PointerEvent) {
  if (!dragging) return
  dragging = false
  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* 忽略 */ }
  try { localStorage.setItem(PANEL_W_KEY, String(panelW.value)) } catch { /* 忽略 */ }
}
onBeforeUnmount(() => {
  if (dragging) dragging = false
})

/** 审批提示条点击 → 滚动定位到对应活动卡（approve/reject 前置回滚 + 目标消息滚入视野） */
function locateApproval() {
  const first = store.pendingApprovals[0]
  if (!first) return
  // 先折叠展示态（活动卡展开态是组件本地状态，这里通过重新渲染兜底：点击消息列表重渲染区）
  const el = document.querySelector('.msg-scroll')
  if (!el) return
  const targets = el.querySelectorAll<HTMLElement>('[data-msg-index]')
  const target = Array.from(targets).find(
    (n) => Number(n.dataset.msgIndex) === first.messageIndex,
  )
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

    <!-- 连通性降级（网络可达性，琥珀；非业务错误） -->
    <div
      v-show="connectivityStatus === 'unreachable'"
      class="degraded"
      role="status"
    >
      <span class="degraded-dot" aria-hidden="true" />
      <span class="degraded-text">
        {{ connectivityMsg || '连不上模型服务，正在自动重试' }}
      </span>
      <button type="button" class="degraded-retry" @click="onRetry">
        <IconRetry class="w-3.5 h-3.5" />
        <span>重试</span>
      </button>
    </div>

    <!-- 业务错误（红条；点击关闭） -->
    <div
      v-show="store.error"
      class="error-bar"
      role="alert"
      @click="store.error = null"
    >
      <span class="error-dot" aria-hidden="true" />
      <span class="error-text">{{ store.error }}</span>
      <IconClose class="error-x w-3.5 h-3.5" aria-hidden="true" />
    </div>

    <ApprovalBar @locate="locateApproval" />

    <ChatEmptyState v-if="!store.hasMessages" />
    <ChatMessageList v-else />
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
  background: var(--color-raised);
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

/* ── 连通性降级 ── */
.degraded {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
  background: color-mix(in srgb, var(--color-warning) 7%, transparent);
  color: var(--color-warning);
  font-size: 12px;
}
.degraded-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 2px;
  background: var(--color-warning);
}
.degraded-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.degraded-retry {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  height: 22px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 45%, transparent);
  border-radius: 3px;
  background: transparent;
  color: var(--color-warning);
  font-size: 11px;
  cursor: pointer;
}
.degraded-retry:hover {
  background: color-mix(in srgb, var(--color-warning) 14%, transparent);
}

/* ── 业务错误 ── */
.error-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  color: var(--color-danger);
  font-size: 12px;
  cursor: pointer;
}
.error-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 2px;
  background: var(--color-danger);
}
.error-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.error-x {
  flex: 0 0 auto;
  opacity: 0.7;
}
</style>
