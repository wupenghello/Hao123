<script setup lang="ts">
/**
 * 小吴 · 常驻卡通 AI 伙伴（桌宠）本体。
 *
 * 形态：御姐 Senko（Live2D，OhMyLive2D 驱动）；reduced-motion / 无 WebGL / 加载失败 → 占位光球。
 * 行为：mood 由 useCompanion 算出（确定性），驱动容器辉光 + 徽标 + 气泡。
 * 交互：点击身体 → 打开命令面板；按住拖拽 → 重定位 + 持久化；右键/菜单按钮 → 控制菜单。
 * 无障碍：role=button + 动态 aria-label + 键盘 Enter/Space；Escape 分级（先关菜单）。
 * 性能：切后台暂停 renderer；reduced-motion 走占位（CSS 静止）；oh-my-live2d 动态 import 懒加载。
 */
import { ref, computed, shallowRef, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useCompanion } from '../composable'
import { useChatStore } from '@/features/chat'
import { createRenderer, PlaceholderRenderer } from '../renderer'
import { COMPANION_DISABLED } from '../config'
import type { CompanionRenderer, BubblePayload } from '../types'
import CompanionBubble from './CompanionBubble.vue'
import IconDots from '~icons/mdi/dots-vertical'
import IconRestore from '~icons/mdi/robot-happy-outline'

const comp = useCompanion()
const chat = useChatStore()
const { state, mood, bubble, visual, hidden } = comp

// ── renderer ──
const stageRef = ref<HTMLElement | null>(null)
const renderer = shallowRef<CompanionRenderer | null>(null)
const ready = ref(false)

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}
function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

async function fallbackPlaceholder(): Promise<void> {
  if (!stageRef.value) return
  const r = new PlaceholderRenderer()
  renderer.value = r
  try {
    await r.mount(stageRef.value, { modelSource: '', reducedMotion: true, parentMood: mood.value })
    r.setMood(mood.value)
  } catch {
    /* 占位即使失败也不应阻断工作台 */
  }
}

async function mountRenderer(): Promise<void> {
  if (!stageRef.value || renderer.value) return
  // reduced-motion 或无 WebGL → 直接占位（不加载 Live2D）
  if (prefersReducedMotion() || !webglAvailable()) {
    await fallbackPlaceholder()
    return
  }
  const r = await createRenderer('live2d')
  renderer.value = r
  try {
    await r.mount(stageRef.value, {
      modelSource: state.value.modelSource ?? '',
      reducedMotion: false,
      parentMood: mood.value,
      onReady: () => {
        ready.value = true
      },
      onError: (e) => {
        console.warn('[companion] Live2D 加载失败，降级占位光球', e)
        void fallbackPlaceholder()
      },
    })
    r.setMood(mood.value)
  } catch (e) {
    console.warn('[companion] Live2D mount 异常，降级占位', e)
    await fallbackPlaceholder()
  }
}

watch(mood, (m) => {
  renderer.value?.setMood(m)
})

// ── 拖拽（复用 ChatLauncher 的 Pointer Events + clamp + 持久化模式）──
const DRAG_THRESHOLD = 5
const dragging = ref(false)
let moved = false
let startX = 0
let startY = 0
let startPosX = 0
let startPosY = 0
const cachedSize = { width: 180, height: 240 }

function clampToViewport(left: number, top: number) {
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - cachedSize.width - 8)),
    top: Math.max(8, Math.min(top, window.innerHeight - cachedSize.height - 8)),
  }
}

function isOnChrome(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.closest('.cp-bubble, .companion-menu, .companion-menu-btn')
}

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (isOnChrome(e.target)) return
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  cachedSize.width = rect.width
  cachedSize.height = rect.height
  // 首次拖拽：把 CSS 的 right/bottom 固化为 left/top
  if (state.value.position === null) {
    state.value = { ...state.value, position: { left: rect.left, top: rect.top } }
  }
  dragging.value = true
  moved = false
  startX = e.clientX
  startY = e.clientY
  startPosX = rect.left
  startPosY = rect.top
  try {
    el.setPointerCapture(e.pointerId)
  } catch {
    /* 忽略捕获失败 */
  }
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) moved = true
  if (moved) {
    state.value = { ...state.value, position: clampToViewport(startPosX + dx, startPosY + dy) }
  }
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  const el = e.currentTarget as HTMLElement
  try {
    el.releasePointerCapture(e.pointerId)
  } catch {
    /* 忽略 */
  }
  dragging.value = false
}

function onClick() {
  if (moved) {
    moved = false
    return
  }
  comp.openPalette()
}

function onKeyActivate(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    comp.openPalette()
  }
}

function onResize() {
  if (state.value.position) {
    state.value = {
      ...state.value,
      position: clampToViewport(state.value.position.left, state.value.position.top),
    }
  }
}

// ── 菜单 ──
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

function openMenu(e: MouseEvent | null) {
  e?.preventDefault()
  e?.stopPropagation()
  menuOpen.value = true
  void nextTick(() => {
    const first = menuRef.value?.querySelector<HTMLElement>('button')
    first?.focus()
  })
}
function closeMenu() {
  menuOpen.value = false
}
function act(fn: () => void) {
  fn()
  closeMenu()
}
function onMenuKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    closeMenu()
  }
}

// ── 气泡 ──
const showBubble = computed(() => !!bubble.value && !chat.open && !hidden.value)
function onBubbleDismiss() {
  comp.dismissBubble()
}
function onBubbleHandoff(p: BubblePayload) {
  p.handoff?.()
}

// ── 徽标 ──
const badge = computed<'unread' | 'alert' | null>(() => {
  if (chat.unread && !chat.open) return 'unread'
  if (mood.value === 'offline' || mood.value === 'concerned') return 'alert'
  return null
})

// ── aria / 定位 ──
const ariaLabel = computed(
  () => `${visual.value.aria}｜点击打开对话｜按住可拖动｜右键打开菜单`,
)
const positionStyle = computed(() => {
  const p = state.value.position
  if (!p) return {}
  return { left: `${p.left}px`, top: `${p.top}px`, right: 'auto', bottom: 'auto' } as Record<string, string>
})
const shellStyle = computed(() => ({
  ...positionStyle.value,
  '--cp-tone': visual.value.tone,
  '--cp-glow': visual.value.glow,
}))

// ── visibility 暂停 ──
function onVis() {
  renderer.value?.setPaused(document.hidden)
}

// Escape 分级：菜单开着时优先关菜单（capture，避免冒泡触发命令面板）
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && menuOpen.value) {
    e.stopPropagation()
    closeMenu()
  }
}

onMounted(() => {
  void mountRenderer()
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVis)
  document.addEventListener('keydown', onDocKey, true)
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  document.removeEventListener('visibilitychange', onVis)
  document.removeEventListener('keydown', onDocKey, true)
  renderer.value?.destroy()
  renderer.value = null
})
</script>

<template>
  <div v-if="!COMPANION_DISABLED" class="companion-shell">
    <!-- 收起态：只显示一个恢复按钮 -->
    <button
      v-if="hidden"
      type="button"
      class="companion-restore"
      :style="shellStyle"
      aria-label="显示小吴（伙伴已收起）"
      title="显示小吴"
      @click="comp.toggleHide"
    >
      <IconRestore class="w-5 h-5" />
    </button>

    <!-- 伙伴本体 -->
    <div
      v-else
      class="companion"
      :class="[`mood-${mood}`, { 'is-dragging': dragging, 'is-ready': ready }]"
      :style="shellStyle"
      role="button"
      tabindex="0"
      :aria-label="ariaLabel"
      :title="ariaLabel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click="onClick"
      @keydown="onKeyActivate"
      @contextmenu="openMenu"
    >
      <div ref="stageRef" class="companion-stage" :data-mood="mood" aria-hidden="true" />

      <span v-if="badge" class="companion-badge" :class="`badge-${badge}`" aria-hidden="true" />

      <button
        type="button"
        class="companion-menu-btn"
        aria-label="伙伴菜单"
        aria-haspopup="true"
        :aria-expanded="menuOpen"
        @click.stop="openMenu($event)"
      >
        <IconDots class="w-3.5 h-3.5" />
      </button>

      <CompanionBubble
        v-if="showBubble && bubble"
        :bubble="bubble"
        @dismiss="onBubbleDismiss"
        @handoff="onBubbleHandoff"
      />

      <div v-if="menuOpen" ref="menuRef" class="companion-menu" role="menu" @click.stop @keydown="onMenuKey">
        <button role="menuitem" @click="act(comp.mute30)">静音 30 分钟</button>
        <button role="menuitem" @click="act(comp.sleepUntilMorning)">免打扰到明早</button>
        <button role="menuitem" @click="act(comp.resetPosition)">回到右下角</button>
        <button role="menuitem" @click="act(comp.toggleHide)">收起伙伴</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.companion-shell {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 40;
}
.companion {
  position: relative;
  width: 180px;
  height: 240px;
  border-radius: 14px;
  cursor: grab;
  touch-action: none;
  user-select: none;
  outline: none;
  /* 容器辉光：mood 色光晕（Live2D 模型保持原画色，不染色） */
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--cp-tone, #22d3ee) 22%, transparent),
    0 0 30px -6px var(--cp-glow, rgba(34, 211, 238, 0.2)), 0 10px 30px rgba(2, 6, 23, 0.3);
  transition: box-shadow 0.4s ease;
}
.companion:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cp-tone, #22d3ee) 55%, transparent),
    0 0 30px -6px var(--cp-glow, rgba(34, 211, 238, 0.2));
}
.companion.is-dragging {
  cursor: grabbing;
  transition: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--cp-tone, #22d3ee) 60%, transparent),
    0 0 40px -4px var(--cp-glow, rgba(34, 211, 238, 0.3));
}
.companion::before {
  content: '';
  position: absolute;
  inset: -14%;
  z-index: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 55%, var(--cp-glow, rgba(34, 211, 238, 0.28)), transparent 60%);
  pointer-events: none;
  animation: cp-aura 4.8s ease-in-out infinite;
}
@keyframes cp-aura {
  0%, 100% { opacity: 0.4; transform: scale(0.94); }
  50% { opacity: 0.78; transform: scale(1.06); }
}

.companion-stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 14px;
  /* OhMyLive2D 舞台与占位光球都挂在这里 */
}
/* 模型未就绪时给个轻提示底（加载中） */
.companion:not(.is-ready) .companion-stage::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 40%, var(--cp-glow, rgba(34, 211, 238, 0.2)), transparent 60%);
  opacity: 0.5;
}

.companion-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  pointer-events: none;
  animation: cp-badge-pulse 1.8s ease-in-out infinite;
}
.companion-badge.badge-unread {
  background: #fb7185;
  box-shadow: 0 0 10px rgba(251, 113, 133, 0.8);
}
.companion-badge.badge-alert {
  background: #fbbf24;
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.7);
}
@keyframes cp-badge-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.9;
  }
  50% {
    transform: scale(1.25);
    opacity: 1;
  }
}

.companion-menu-btn {
  position: absolute;
  top: 6px;
  left: 6px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(8, 14, 28, 0.62);
  color: rgba(226, 232, 240, 0.6);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s, color 0.18s, border-color 0.18s;
  backdrop-filter: blur(4px);
}
.companion:hover .companion-menu-btn,
.companion-menu-btn:focus-visible {
  opacity: 1;
}
.companion-menu-btn:hover {
  color: var(--cp-tone, #22d3ee);
  border-color: color-mix(in srgb, var(--cp-tone, #22d3ee) 45%, transparent);
}

.companion-menu {
  position: absolute;
  bottom: 0;
  left: 0;
  transform: translateX(-100%) translateX(-8px);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  min-width: 150px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(10, 20, 38, 0.96), rgba(4, 10, 22, 0.94));
  border: 1px solid color-mix(in srgb, var(--cp-tone, #22d3ee) 22%, rgba(148, 163, 184, 0.18));
  box-shadow: 0 12px 32px rgba(2, 6, 23, 0.5);
  backdrop-filter: blur(8px);
}
.companion-menu button {
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(226, 232, 240, 0.82);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.companion-menu button:hover,
.companion-menu button:focus-visible {
  background: color-mix(in srgb, var(--cp-tone, #22d3ee) 16%, transparent);
  color: rgba(248, 250, 252, 0.96);
  outline: none;
}

.companion-restore {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--cp-tone, #22d3ee) 30%, rgba(148, 163, 184, 0.2));
  background: rgba(8, 14, 28, 0.8);
  color: var(--cp-tone, #22d3ee);
  cursor: pointer;
  box-shadow: 0 0 22px -4px var(--cp-glow, rgba(34, 211, 238, 0.2)), 0 8px 22px rgba(2, 6, 23, 0.34);
  transition: transform 0.15s, box-shadow 0.2s;
}
.companion-restore:hover {
  transform: translateY(-1px);
}

@media (max-width: 480px) {
  .companion-shell {
    right: max(10px, env(safe-area-inset-right));
    bottom: max(10px, env(safe-area-inset-bottom));
  }
  .companion {
    width: 130px;
    height: 180px;
  }
  .companion-menu-btn {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .companion,
  .companion-menu-btn,
  .companion-restore {
    transition: none;
  }
  .companion-badge {
    animation: none;
  }
}
</style>
