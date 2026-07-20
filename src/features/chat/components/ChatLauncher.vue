<script setup lang="ts">
/**
 * 助手入口（可拖拽，默认右下角）。
 *
 * - 默认固定在视口右下角；用户可按住拖动到任意位置，松手后位置持久化到 localStorage。
 * - 拖拽与点击区分：移动距离 > 5px 视为拖拽（不打开面板），否则视为点击（打开面板）。
 * - 用 Pointer Events 统一鼠标与触屏；setPointerCapture 保证拖出元素也能跟踪。
 * - 边界约束：拖拽时和窗口 resize 时都 clamp 到视口内，避免拖丢。
 */
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useChatStore } from '../store'
import { useConnectivity } from '../connectivity'
import { ASSISTANT_NAME } from '../config'
import { activeModel, activeProvider, configured as modelConfigured, hasUiConfig } from '@/features/model-config'
import IconRobot from '~icons/mdi/robot-happy-outline'
import IconCheckNetwork from '~icons/mdi/check-network-outline'
import IconNetworkOff from '~icons/mdi/network-off-outline'
import IconDrag from '~icons/mdi/drag'

const store = useChatStore()
const { status: connectivityStatus, message: connectivityMsg } = useConnectivity()

const isMac = computed(() =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent),
)
const keyHint = computed(() => (isMac.value ? '⌘K' : 'Alt+K'))

const statusState = computed(() => {
  if (!store.configured) return 'none'
  return connectivityStatus.value === 'unreachable' ? 'down' : 'ok'
})
const statusTitle = computed(() => {
  if (statusState.value === 'down') return connectivityMsg.value || `${ASSISTANT_NAME} 暂时连不上`
  return `${ASSISTANT_NAME} 在线`
})
const modelTitle = computed(() => {
  if (!hasUiConfig.value) return '模型未配置'
  const provider = activeProvider.value?.name || '未命名 Provider'
  const model = activeModel.value || '未选择模型'
  return `当前模型：${provider} / ${model}${modelConfigured.value ? '' : '（等待配置）'}`
})
const launcherTitle = computed(() => {
  const status = statusState.value === 'down' ? `｜${connectivityMsg.value || '连不上'}` : ''
  return `${ASSISTANT_NAME} · AI 助手（${keyHint.value}）｜${modelTitle.value}${status}｜按住可拖动`
})

// ── 拖拽 ──
const LAUNCHER_POS_KEY = 'hao123-chat-launcher-pos'
/** 拖拽阈值：移动距离超过此值视为拖拽而非点击 */
const DRAG_THRESHOLD = 5

/** 拖拽后的绝对位置（null = 用 CSS 默认右下角） */
const pos = ref<{ left: number; top: number } | null>(null)
const dragging = ref(false)
/** 本次按下是否发生过拖拽（用于点击守卫） */
let moved = false
let startX = 0
let startY = 0
let startPosX = 0
let startPosY = 0
/** 拖拽前复用的元素尺寸（拖动中尺寸不变，避免每帧查询 DOM） */
const cachedSize = { width: 130, height: 44 }

/** 把位置约束在视口内，避免拖丢。只要元素尺寸不变，复用同一份测量结果（拖拽前已固化位置，尺寸在拖动中不变）。 */
function clampToViewport(left: number, top: number): { left: number; top: number } {
  const w = cachedSize.width
  const h = cachedSize.height
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - w - 8)),
    top: Math.max(8, Math.min(top, window.innerHeight - h - 8)),
  }
}

function onPointerDown(e: PointerEvent) {
  // 鼠标仅响应主键；触屏/笔始终响应
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const el = e.currentTarget as HTMLElement
  // 固化当前 DOM 位置到 pos（从 CSS 的 right/bottom 切到 left/top），复用尺寸避免拖动中查 DOM
  const rect = el.getBoundingClientRect()
  cachedSize.width = rect.width
  cachedSize.height = rect.height
  pos.value = { left: rect.left, top: rect.top }
  dragging.value = true
  moved = false
  startX = e.clientX
  startY = e.clientY
  startPosX = rect.left
  startPosY = rect.top
  try { el.setPointerCapture(e.pointerId) } catch { /* 忽略捕获失败 */ }
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
    moved = true
  }
  if (moved) {
    pos.value = clampToViewport(startPosX + dx, startPosY + dy)
  }
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  const el = e.currentTarget as HTMLElement
  try { el.releasePointerCapture(e.pointerId) } catch { /* 忽略 */ }
  dragging.value = false
  if (moved) {
    localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify(pos.value))
  }
}

function onClick() {
  // 拖拽发生过则不打开面板；重置标记，下次点击正常
  if (moved) {
    moved = false
    return
  }
  store.show()
}

function onResize() {
  if (pos.value) {
    pos.value = clampToViewport(pos.value.left, pos.value.top)
  }
}

onMounted(() => {
  // 读持久化位置
  const stored = localStorage.getItem(LAUNCHER_POS_KEY)
  if (stored) {
    try {
      const p = JSON.parse(stored)
      if (p && typeof p.left === 'number' && typeof p.top === 'number') {
        pos.value = clampToViewport(p.left, p.top)
      }
    } catch { /* 忽略损坏的存储 */ }
  }
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})

/** 动态定位样式：有 pos 用 left/top，否则用 CSS 默认 right/bottom */
const launcherStyle = computed(() => {
  if (!pos.value) return {}
  return { left: `${pos.value.left}px`, top: `${pos.value.top}px`, right: 'auto', bottom: 'auto' }
})
</script>

<template>
  <button
    type="button"
    class="chat-launcher"
    :class="{ 'has-unread': store.unread, 'is-unreachable': statusState === 'down', 'is-dragging': dragging }"
    :style="launcherStyle"
    :title="launcherTitle"
    :aria-label="launcherTitle"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @click="onClick"
  >
    <span class="launcher-icon" aria-hidden="true">
      <IconRobot class="w-[18px] h-[18px]" />
    </span>
    <span class="launcher-label">问{{ ASSISTANT_NAME }}</span>
    <span
      v-if="statusState !== 'none'"
      class="launcher-status"
      :class="statusState === 'down' ? 'is-down' : 'is-ok'"
      :title="statusTitle"
      aria-hidden="true"
    >
      <IconNetworkOff v-if="statusState === 'down'" class="w-3 h-3" />
      <IconCheckNetwork v-else class="w-3 h-3" />
    </span>
    <kbd class="launcher-shortcut">{{ keyHint }}</kbd>
    <span v-if="store.unread" class="launcher-unread" aria-hidden="true">新</span>
    <IconDrag class="launcher-drag-handle" aria-hidden="true" />
  </button>
</template>

<style scoped>
.chat-launcher {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 40;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 5px 6px 5px 5px;
  color: var(--text-secondary, #a8b5c7);
  background: var(--surface-raised, #142238);
  border: 1px solid var(--border-strong, rgba(148, 163, 184, 0.3));
  border-radius: 7px;
  box-shadow: var(--shadow-raised, 0 12px 32px rgba(2, 6, 23, 0.32));
  cursor: grab;
  touch-action: none;
  user-select: none;
  transition: color var(--dur-fast, 160ms) var(--ease), background var(--dur-fast, 160ms) var(--ease), border-color var(--dur-fast, 160ms) var(--ease), transform var(--dur-fast, 160ms) var(--ease);
}

.chat-launcher:hover {
  color: var(--text-primary, #e8eef7);
  background: color-mix(in srgb, var(--surface-raised, #142238) 88%, var(--accent-primary, #38bdf8));
  border-color: var(--accent-primary, #38bdf8);
}

.chat-launcher:not(.is-dragging):active {
  cursor: grabbing;
  transform: translateY(1px);
}

.chat-launcher.is-dragging {
  cursor: grabbing;
  transition: none;
  transform: none;
  box-shadow: var(--shadow-raised, 0 12px 32px rgba(2, 6, 23, 0.32)), 0 0 0 2px color-mix(in srgb, var(--accent-primary, #38bdf8) 40%, transparent);
}

.chat-launcher.is-unreachable {
  border-color: color-mix(in srgb, var(--status-warning, #f59e0b) 58%, var(--border-default, rgba(148, 163, 184, 0.2)));
}

.launcher-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  flex: 0 0 auto;
  color: var(--accent-hover, #7dd3fc);
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  border-radius: 4px;
}

.launcher-label {
  color: inherit;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
}

.launcher-status {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 4px;
}

.launcher-status.is-ok {
  color: var(--status-success, #34d399);
  background: var(--status-success-soft, rgba(52, 211, 153, 0.1));
}

.launcher-status.is-down {
  color: var(--status-warning, #f59e0b);
  background: var(--status-warning-soft, rgba(245, 158, 11, 0.1));
}

.launcher-shortcut,
.launcher-unread {
  display: inline-grid;
  place-items: center;
  min-height: 22px;
  border-radius: 4px;
  font-weight: 700;
  white-space: nowrap;
}

.launcher-shortcut {
  min-width: 38px;
  padding: 0 6px;
  color: var(--text-muted, #74839a);
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  font: 650 9px/1 var(--font-mono, ui-monospace, monospace);
}

.launcher-unread {
  min-width: 22px;
  padding: 0 5px;
  color: var(--status-danger, #fb7185);
  background: var(--status-danger-soft, rgba(251, 113, 133, 0.1));
  border: 1px solid color-mix(in srgb, var(--status-danger, #fb7185) 40%, transparent);
  font-size: 9px;
}

/* 拖拽手柄：暗示可拖动，hover 时更显眼 */
.launcher-drag-handle {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted, #74839a);
  opacity: 0.5;
  transition: opacity 0.15s, color 0.15s;
}
.chat-launcher:hover .launcher-drag-handle {
  opacity: 0.85;
  color: var(--accent-hover, #7dd3fc);
}

@media (max-width: 480px) {
  .chat-launcher {
    right: max(10px, env(safe-area-inset-right));
    bottom: max(10px, env(safe-area-inset-bottom));
  }

  .launcher-shortcut {
    display: none;
  }
  .launcher-drag-handle {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-launcher {
    transition: none;
  }
  .chat-launcher:not(.is-dragging):active {
    transform: none;
  }
}
</style>
