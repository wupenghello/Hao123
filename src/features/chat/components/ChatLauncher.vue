<script setup lang="ts">
/**
 * 助手入口（可拖拽，默认右下角）。
 *
 * - 默认固定在视口右下角；用户可按住拖动到任意位置，松手后位置持久化到 localStorage。
 * - 拖拽与点击区分：移动距离 > 5px 视为拖拽（不打开面板），否则视为点击（打开面板）。
 * - 用 Pointer Events 统一鼠标与触屏；setPointerCapture 保证拖出元素也能跟踪。
 * - 边界约束：拖拽时和窗口 resize 时都 clamp 到视口内，避免拖丢。
 */
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useChatStore } from '../store'
import { useConnectivity } from '../connectivity'
import { ASSISTANT_NAME } from '../config'
import { activeModel, activeProvider, configured as modelConfigured, hasUiConfig } from '@/features/model-config'
import {
  AvatarStage,
  AVATAR_MODELS,
  getAvatarModelUrl,
  DEFAULT_MODEL_ID,
  SCALE_FACTOR_STEP,
  SCALE_FACTOR_MIN,
  SCALE_FACTOR_MAX,
  clampScaleFactor,
  STORAGE_KEY_MODEL,
  STORAGE_KEY_SCALE,
} from '@/features/avatar'
import type { AvatarExpression } from '@/features/avatar'
import { useStorage } from '@/composables/useStorage'
import IconCheckNetwork from '~icons/mdi/check-network-outline'
import IconNetworkOff from '~icons/mdi/network-off-outline'
import IconDrag from '~icons/mdi/drag'
import IconZoomIn from '~icons/mdi/magnify-plus-outline'
import IconZoomOut from '~icons/mdi/magnify-minus-outline'
import IconReset from '~icons/mdi/refresh'
import IconCheck from '~icons/mdi/check'
import IconChat from '~icons/mdi/chat-outline'
import IconClose from '~icons/mdi/close'

const store = useChatStore()
const { status: connectivityStatus, message: connectivityMsg } = useConnectivity()

const avatarRef = ref<InstanceType<typeof AvatarStage> | null>(null)

/** 角色立绘主体尺寸——角色直接占据 launcher，不再是小图标 */
const AVATAR_W = 130
const AVATAR_H = 168

// ── 形象与缩放（持久化）──
/** 当前选中的形象 id */
const modelId = useStorage<string>(STORAGE_KEY_MODEL, DEFAULT_MODEL_ID)
/** 当前缩放倍数（相对自适应 fit，边界 [SCALE_FACTOR_MIN, SCALE_FACTOR_MAX]） */
const scaleFactor = useStorage<number>(STORAGE_KEY_SCALE, 1)
/** 当前形象的中文标签（菜单标题用） */
const currentModelLabel = computed(
  () => AVATAR_MODELS.find((m) => m.id === modelId.value)?.label ?? '形象',
)

/** 给 AvatarStage 的配置：url 随形象切换；scaleFactor 用于渲染器初始化 */
const avatarConfig = computed(() => ({
  url: getAvatarModelUrl(modelId.value),
  scaleFactor: clampScaleFactor(scaleFactor.value),
}))

/** 缩放倍数变化 → 实时应用到渲染器（不重建） */
watch(
  scaleFactor,
  (f) => avatarRef.value?.setScaleFactor?.(clampScaleFactor(f)),
)

// ── 右键菜单 ──
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  // 菜单边界约束，避免贴边溢出（形象较多，预留充足高度）
  const menuW = 196
  const menuH = 500
  menuX.value = Math.max(8, Math.min(e.clientX, window.innerWidth - menuW - 8))
  menuY.value = Math.max(8, Math.min(e.clientY, window.innerHeight - menuH - 8))
  menuOpen.value = true
}

function closeMenu() {
  menuOpen.value = false
}

function zoomIn() {
  scaleFactor.value = clampScaleFactor(scaleFactor.value + SCALE_FACTOR_STEP)
}
function zoomOut() {
  scaleFactor.value = clampScaleFactor(scaleFactor.value - SCALE_FACTOR_STEP)
}
function resetZoom() {
  scaleFactor.value = 1
}
function selectModel(id: string) {
  modelId.value = id
  closeMenu()
}
function openChat() {
  store.show()
  closeMenu()
}

/** 把连通性状态映射到 avatar 表情 */
function expressionForStatus(): AvatarExpression {
  if (!store.configured) return 'neutral'
  if (connectivityStatus.value === 'unreachable') return 'sad'
  return 'neutral'
}

// 驱动 avatar：streaming → 说话；连通性 → 表情
watch(
  () => store.streaming,
  (s) => {
    avatarRef.value?.setSpeaking?.(s)
    if (s) avatarRef.value?.setExpression?.('happy')
    else avatarRef.value?.setExpression?.(expressionForStatus())
  },
)
watch(
  () => connectivityStatus.value,
  () => {
    if (!store.streaming) avatarRef.value?.setExpression?.(expressionForStatus())
  },
)
watch(
  () => store.configured,
  () => {
    if (!store.streaming) avatarRef.value?.setExpression?.(expressionForStatus())
  },
)

/** 鼠标在 launcher 上移动时，让 avatar 视线追随 */
function onMouseMove(e: MouseEvent) {
  avatarRef.value?.focus?.(e.clientX, e.clientY)
}
function onMouseLeave() {
  avatarRef.value?.focusReset?.()
}

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
const cachedSize = { width: 130, height: 168 }

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

function onDocClick(e: MouseEvent) {
  if (!menuOpen.value) return
  const menu = document.querySelector('.avatar-context-menu')
  // 点在菜单外（且不是右键 launcher 本身）则关闭；菜单项自带 closeMenu
  if (menu && !menu.contains(e.target as Node)) closeMenu()
}

function onDocKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && menuOpen.value) closeMenu()
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
  // 延迟绑定 click，避免触发右键的同一手势立即关闭菜单
  setTimeout(() => {
    window.addEventListener('click', onDocClick)
    window.addEventListener('keydown', onDocKeydown)
  }, 0)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onDocKeydown)
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
    class="avatar-launcher"
    :class="{ 'has-unread': store.unread, 'is-unreachable': statusState === 'down', 'is-dragging': dragging }"
    :style="launcherStyle"
    :title="launcherTitle"
    :aria-label="launcherTitle"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @click="onClick"
    @contextmenu="onContextMenu"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
  >
    <AvatarStage
      ref="avatarRef"
      :width="AVATAR_W"
      :height="AVATAR_H"
      :config="avatarConfig"
      :aria-label="ASSISTANT_NAME + ' 虚拟形象'"
      class="avatar-launcher-stage"
    />
    <!-- 连通性色点：右上角悬浮小徽标 -->
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
    <!-- 未读徽标：左上角 -->
    <span v-if="store.unread" class="launcher-unread" aria-hidden="true">新</span>
    <!-- 拖拽手柄：底部居中，hover 时浮现 -->
    <IconDrag class="launcher-drag-handle" aria-hidden="true" />
  </button>

  <!-- 右键菜单：缩放 / 切换形象 / 打开小吴 -->
  <Teleport to="body">
    <div
      v-if="menuOpen"
      class="avatar-context-menu"
      :style="{ left: menuX + 'px', top: menuY + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <div class="ctx-header">
        <span class="ctx-title">{{ ASSISTANT_NAME }} · {{ currentModelLabel }}</span>
        <button type="button" class="ctx-close" title="关闭" @click="closeMenu">
          <IconClose class="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="ctx-group">
        <div class="ctx-group-label">大小</div>
        <button type="button" class="ctx-item" :disabled="scaleFactor >= SCALE_FACTOR_MAX" @click="zoomIn">
          <IconZoomIn class="w-4 h-4" /><span>放大</span>
        </button>
        <button type="button" class="ctx-item" :disabled="scaleFactor <= SCALE_FACTOR_MIN" @click="zoomOut">
          <IconZoomOut class="w-4 h-4" /><span>缩小</span>
        </button>
        <button type="button" class="ctx-item" @click="resetZoom">
          <IconReset class="w-4 h-4" /><span>重置 <em class="ctx-pct">{{ Math.round(scaleFactor * 100) }}%</em></span>
        </button>
      </div>

      <div class="ctx-group">
        <div class="ctx-group-label">形象</div>
        <button
          v-for="m in AVATAR_MODELS"
          :key="m.id"
          type="button"
          class="ctx-item"
          :class="{ 'is-active': m.id === modelId }"
          @click="selectModel(m.id)"
        >
          <span class="ctx-check"><IconCheck v-if="m.id === modelId" class="w-3.5 h-3.5" /></span>
          <span class="ctx-name">{{ m.label }}</span>
          <span v-if="m.desc" class="ctx-desc">{{ m.desc }}</span>
        </button>
      </div>

      <div class="ctx-group ctx-group--action">
        <button type="button" class="ctx-item ctx-item--primary" @click="openChat">
          <IconChat class="w-4 h-4" /><span>打开 {{ ASSISTANT_NAME }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 角色立绘主体：透明背景，角色直接占据右下角 */
.avatar-launcher {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(8px, env(safe-area-inset-bottom));
  z-index: 40;
  display: block;
  width: 130px;
  height: 168px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  cursor: grab;
  touch-action: none;
  user-select: none;
  transition: transform var(--duration-fast) var(--ease-out-quint), filter var(--duration-fast) var(--ease-out-quint);
}

.avatar-launcher-stage {
  width: 100%;
  height: 100%;
  pointer-events: none; /* 点击交给外层 button，避免 canvas 抢手势 */
}

/* hover 时角色微微上浮 + 提亮，提示可交互 */
.avatar-launcher:hover {
  transform: translateY(-3px);
  filter: drop-shadow(0 6px 18px color-mix(in srgb, var(--color-accent) 35%, transparent));
}

.avatar-launcher:not(.is-dragging):active {
  cursor: grabbing;
  transform: translateY(0);
}

.avatar-launcher.is-dragging {
  cursor: grabbing;
  transition: none;
  transform: none;
  filter: drop-shadow(0 0 10px color-mix(in srgb, var(--color-accent) 50%, transparent));
}

/* 连通性色点：右上角小圆点，跟随角色 */
.launcher-status {
  position: absolute;
  top: 14px;
  right: 8px;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 50%;
  backdrop-filter: blur(6px);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.launcher-status.is-ok {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-success) 50%, transparent);
}

.launcher-status.is-down {
  color: var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-warning) 50%, transparent);
}

/* 未读徽标：左上角 */
.launcher-unread {
  position: absolute;
  top: 12px;
  left: 6px;
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 85%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-danger) 40%, transparent);
  font-size: 10px;
  font-weight: 700;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  animation: launcher-unread-pulse 1.8s ease-in-out infinite;
}

@keyframes launcher-unread-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
}

/* 拖拽手柄：底部居中，hover 时浮现 */
.launcher-drag-handle {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 16px;
  height: 16px;
  transform: translateX(-50%);
  color: var(--color-ink-3);
  opacity: 0;
  transition: opacity 0.2s, color 0.2s;
}
.avatar-launcher:hover .launcher-drag-handle {
  opacity: 0.7;
  color: var(--color-accent-strong);
}

/* ── 右键菜单 ── */
.avatar-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 196px;
  max-width: 240px;
  padding: 6px;
  color: var(--color-ink);
  background: color-mix(in srgb, var(--color-raised) 92%, transparent);
  backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid var(--color-line-hover);
  border-radius: 10px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3);
  font-size: 13px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  animation: ctx-pop 0.14s var(--ease-out-quint);
}

@keyframes ctx-pop {
  from { opacity: 0; transform: scale(0.96) translateY(-4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.ctx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 8px;
  border-bottom: 1px solid var(--color-line);
}
.ctx-title {
  font-weight: 700;
  font-size: 12.5px;
  color: var(--color-ink);
}
.ctx-close {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--color-ink-3);
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ctx-close:hover {
  color: var(--color-ink);
  background: var(--color-line);
}

.ctx-group {
  padding: 4px 0;
  border-bottom: 1px solid var(--color-line);
}
.ctx-group:last-child {
  border-bottom: none;
}
.ctx-group-label {
  padding: 4px 10px 2px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-ink-3);
  letter-spacing: 0.04em;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 10px;
  color: var(--color-ink-2);
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.13s, color 0.13s;
}
.ctx-item:hover:not(:disabled) {
  color: var(--color-ink);
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
}
.ctx-item:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.ctx-item.is-active {
  color: var(--color-accent-strong);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
}
.ctx-check {
  display: inline-grid;
  place-items: center;
  width: 16px;
  flex: 0 0 16px;
  color: var(--color-accent-strong);
}
.ctx-name {
  flex: 0 0 auto;
  font-weight: 600;
}
.ctx-desc {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-ink-3);
}
.ctx-pct {
  margin-left: 6px;
  font-style: normal;
  font-size: 11px;
  color: var(--color-ink-3);
  font-family: var(--font-mono, ui-monospace, monospace);
}
.ctx-item--primary {
  color: var(--color-accent-strong);
  font-weight: 600;
}
.ctx-group--action {
  padding-top: 6px;
}

@media (prefers-reduced-motion: reduce) {
  .avatar-context-menu {
    animation: none;
  }
}

@media (max-width: 480px) {
  .avatar-launcher {
    right: max(8px, env(safe-area-inset-right));
    bottom: max(4px, env(safe-area-inset-bottom));
    width: 110px;
    height: 142px;
  }
  .launcher-drag-handle {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .avatar-launcher {
    transition: none;
  }
  .avatar-launcher:hover {
    transform: none;
    filter: none;
  }
  .avatar-launcher:not(.is-dragging):active {
    transform: none;
  }
  .launcher-unread {
    animation: none;
  }
}
</style>
