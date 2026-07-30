<script setup lang="ts">
/**
 * 通用详情弹窗（项目级公共组件）
 *
 * 抽离自原禅道详情弹窗，作为「详情类弹窗」的统一壳层，后续各模块复用：
 *   - 遮罩 + 居中卡片 + 顶部渐变高光条（主题 navy→teal）
 *   - 头部（图标 / 标题区 / 关闭按钮）、可滚动主体、底部操作条
 *   - 标准的 加载中 / 错误 / 内容 三态切换（由 loading/error/hasData 驱动）
 *   - Esc 关闭、打开时锁定 body 滚动
 *   - 内置富文本图片预览：主体内点击 <img> 即弹出大图层
 *
 * 用法（具名插槽）：
 *   <DetailModal :open="open" :loading="..." :error="..." :has-data="..." accent="..." @close="...">
 *     <template #icon>…</template>
 *     <template #title>…</template>
 *     <template #body>…</template>        // 主体内容（富文本图片自动支持预览）
 *     <template #footer>…</template>       // 可选
 *   </DetailModal>
 */
import { watch, onUnmounted, ref, computed } from 'vue'
import IconLoading from '~icons/mdi/loading'
import IconClose from '~icons/mdi/close'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconPlus from '~icons/mdi/plus'
import IconMinus from '~icons/mdi/minus'
import IconRefresh from '~icons/mdi/refresh'

/**
 * body 滚动锁的全局引用计数：多个 DetailModal（任务详情、Bug 详情等）可能同时存在，
 * 任一弹窗关闭/卸载都不能无条件复位 overflow，否则会清掉仍打开弹窗的锁。
 * 仅当计数归零时才真正解锁。
 */
let scrollLockCount = 0
function lockScroll() {
  scrollLockCount += 1
  if (scrollLockCount === 1) document.body.style.overflow = 'hidden'
}
function unlockScroll() {
  if (scrollLockCount > 0) scrollLockCount -= 1
  if (scrollLockCount === 0) document.body.style.overflow = ''
}

const props = withDefaults(
  defineProps<{
    /** 是否打开 */
    open: boolean
    /** 加载中（无数据时显示加载占位） */
    loading?: boolean
    /** 错误文案（无数据时显示错误占位） */
    error?: string | null
    /** 是否已有可展示数据（决定显示主体还是占位） */
    hasData?: boolean
    /** 顶部渐变高光条的 class（如 'accent-task' / 'accent-bug'，由调用方定义样式） */
    accent?: string
    /** 加载占位文案 */
    loadingText?: string
  }>(),
  {
    loading: false,
    error: null,
    hasData: false,
    accent: '',
    loadingText: '加载详情中…',
  },
)

const emit = defineEmits<{ close: [] }>()

function close() {
  emit('close')
}

/**
 * 富文本图片预览：v-html 渲染的图片无法直接绑事件，
 * 用事件委托——点击主体时若命中 <img> 就打开大图预览层。
 */
const preview = ref<string | null>(null)
/** 预览缩放倍率（1 = 适应视口） */
const zoom = ref(1)
/** 预览拖拽平移偏移（像素） */
const panX = ref(0)
const panY = ref(0)
/** 拖拽进行中 */
const dragging = ref(false)
let dragStartX = 0
let dragStartY = 0
let dragStartPanX = 0
let dragStartPanY = 0

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const ZOOM_STEP = 0.25

/** 当前是否处于放大状态（可拖拽平移） */
const isZoomedIn = computed(() => zoom.value > 1.001)

/** 预览图最终变换 */
const previewTransform = computed(
  () => `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
)

function resetZoom() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
}

function zoomIn() {
  zoom.value = Math.min(MAX_ZOOM, +(zoom.value + ZOOM_STEP).toFixed(2))
}

function zoomOut() {
  zoom.value = Math.max(MIN_ZOOM, +(zoom.value - ZOOM_STEP).toFixed(2))
}

function onBodyClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target?.tagName === 'IMG') {
    const src = (target as HTMLImageElement).src
    if (src) {
      preview.value = src
      resetZoom()
    }
  }
}

/** 滚轮缩放（以视口中心为锚） */
function onPreviewWheel(e: WheelEvent) {
  e.preventDefault()
  if (e.deltaY < 0) zoomIn()
  else if (e.deltaY > 0) zoomOut()
}

/** 拖拽开始：仅放大态有意义 */
function onPreviewMouseDown(e: MouseEvent) {
  if (!isZoomedIn.value) return
  e.preventDefault()
  dragging.value = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartPanX = panX.value
  dragStartPanY = panY.value
}

function onPreviewMouseMove(e: MouseEvent) {
  if (!dragging.value) return
  panX.value = dragStartPanX + (e.clientX - dragStartX)
  panY.value = dragStartPanY + (e.clientY - dragStartY)
}

function onPreviewMouseUp() {
  dragging.value = false
}

/** 双击：在 1x 和 2x 之间切换 */
function onPreviewDblClick(e: MouseEvent) {
  e.stopPropagation()
  if (isZoomedIn.value) resetZoom()
  else {
    zoom.value = 2
    panX.value = 0
    panY.value = 0
  }
}

function closePreview() {
  preview.value = null
  resetZoom()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    // Esc 优先关闭图片预览，再关闭详情
    if (preview.value) closePreview()
    else close()
    return
  }
  // 预览开启时的快捷键
  if (preview.value) {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      zoomIn()
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      zoomOut()
    } else if (e.key === '0') {
      e.preventDefault()
      resetZoom()
    }
  }
}

// 本实例是否持有滚动锁 / Esc 监听，卸载时按持有情况精确归还，避免误清其它弹窗
let holdingLock = false
let holdingKeydown = false

watch(
  () => props.open,
  (open) => {
    if (open) {
      if (!holdingLock) {
        lockScroll()
        holdingLock = true
      }
      if (!holdingKeydown) {
        window.addEventListener('keydown', onKeydown)
        holdingKeydown = true
      }
    } else {
      if (holdingKeydown) {
        window.removeEventListener('keydown', onKeydown)
        holdingKeydown = false
      }
      if (holdingLock) {
        unlockScroll()
        holdingLock = false
      }
      if (preview.value) closePreview()
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (holdingKeydown) {
    window.removeEventListener('keydown', onKeydown)
    holdingKeydown = false
  }
  if (holdingLock) {
    unlockScroll()
    holdingLock = false
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      leave-active-class="transition-opacity duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" @click="close" />

        <Transition
          appear
          enter-active-class="transition-all duration-300 ease-out"
          leave-active-class="transition-all duration-200 ease-in"
          enter-from-class="opacity-0 translate-y-3 scale-[0.97]"
          leave-to-class="opacity-0 translate-y-2 scale-[0.98]"
        >
          <div
            class="hud-panel hud-sheen relative z-10 w-[90vw] max-w-[880px] max-h-[88vh] flex flex-col overflow-hidden rounded-[20px]"
            @click.stop
          >
            <!-- HUD 四角科技边框（纯装饰，不参与布局/交互） -->
            <div class="hud-corners" aria-hidden="true" />

            <!-- 顶部流光条（配色由调用方通过 accent class 提供） -->
            <div class="hud-accent-bar" :class="accent" />

            <!-- 头部 -->
            <div class="px-6 pt-5 pb-4 flex items-start gap-3.5 flex-shrink-0">
              <div class="flex-shrink-0">
                <slot name="icon" />
              </div>
              <div class="flex-1 min-w-0">
                <slot name="title" />
              </div>
              <button
                class="text-white/40 hover:text-white/80 hover:bg-white/10 rounded-lg p-1.5 transition-colors flex-shrink-0"
                @click="close"
              >
                <IconClose class="w-5 h-5" />
              </button>
            </div>

            <!-- 加载中 -->
            <div v-if="loading && !hasData" class="flex flex-col items-center gap-3 py-16 text-white/50">
              <IconLoading class="w-7 h-7 animate-spin text-teal-300/70" />
              <span class="text-sm">{{ loadingText }}</span>
            </div>

            <!-- 错误 -->
            <div v-else-if="error && !hasData" class="flex flex-col items-center gap-3 py-16 text-center text-white/55">
              <IconAlert class="w-8 h-8 text-rose-300/70" />
              <p class="text-sm px-6">{{ error }}</p>
            </div>

            <!-- 主体（可滚动；内部富文本图片点击可预览） -->
            <div
              v-else-if="hasData"
              class="dm-body overflow-y-auto min-h-0 px-6 pb-5 space-y-5"
              @click="onBodyClick"
            >
              <slot name="body" />
            </div>

            <!-- 底部操作条 -->
            <div v-if="hasData && $slots.footer" class="flex-shrink-0 px-6 py-3 border-t border-white/8 flex justify-end">
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- 图片预览大图层（点击主体富文本图片打开，置于详情之上） -->
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      leave-active-class="transition-opacity duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="preview"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm overflow-hidden"
        @wheel.prevent="onPreviewWheel"
        @mousedown.self="closePreview"
      >
        <!-- 预览图：缩放 + 平移；放大态可拖拽 -->
        <img
          :src="preview"
          class="dm-preview-img max-w-none max-h-none select-none"
          :class="isZoomedIn ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'"
          :style="{ transform: previewTransform }"
          draggable="false"
          @mousedown.stop="onPreviewMouseDown"
          @mousemove="onPreviewMouseMove"
          @mouseup="onPreviewMouseUp"
          @mouseleave="onPreviewMouseUp"
          @dblclick="onPreviewDblClick"
        />

        <!-- 顶部工具栏：缩放控制 + 关闭 -->
        <div class="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-xl bg-slate-900/70 backdrop-blur border border-white/10 shadow-lg">
          <button
            class="w-7 h-7 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            :disabled="zoom <= MIN_ZOOM"
            title="缩小 (-)"
            @click="zoomOut"
          >
            <IconMinus class="w-4 h-4" />
          </button>
          <button
            class="min-w-[3.5rem] h-7 px-2 flex items-center justify-center rounded-lg text-[11px] tabular-nums text-white/80 hover:bg-white/10 transition-colors"
            title="重置缩放 (0)"
            @click="resetZoom"
          >
            {{ Math.round(zoom * 100) }}%
          </button>
          <button
            class="w-7 h-7 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            :disabled="zoom >= MAX_ZOOM"
            title="放大 (+)"
            @click="zoomIn"
          >
            <IconPlus class="w-4 h-4" />
          </button>
          <div class="w-px h-4 bg-white/15 mx-0.5" />
          <button
            class="w-7 h-7 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="重置"
            @click="resetZoom"
          >
            <IconRefresh class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- 关闭按钮 -->
        <button
          class="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-xl bg-slate-900/70 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors shadow-lg"
          title="关闭 (Esc)"
          @click="closePreview"
        >
          <IconClose class="w-5 h-5" />
        </button>

        <!-- 底部提示 -->
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-slate-900/60 backdrop-blur border border-white/10 text-[11px] text-white/50 pointer-events-none">
          滚轮缩放 · 拖拽平移 · 双击 2× · Esc 关闭
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 卡片视觉基座已抽到全局 src/style.css 的 .hud-panel / .hud-corners / .hud-sheen /
   .hud-accent-bar，本组件只保留预览图等专属样式，避免重复定义导致漂移。 */

/* 图片预览大图：以视口为基准的基准尺寸，再经 transform: scale() 缩放。
   初始（1x）即适应视口；放大后超出部分由父级 overflow:hidden 裁切，配合拖拽平移浏览。 */
.dm-preview-img {
  --base-w: min(1100px, 92vw);
  --base-h: 90vh;
  max-width: var(--base-w);
  max-height: var(--base-h);
  width: var(--base-w);
  height: var(--base-h);
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 24px 70px -12px rgba(0, 0, 0, 0.6);
  transform-origin: center center;
  transition: transform 0.12s ease-out;
  will-change: transform;
}
/* 拖拽中去掉过渡，跟手 */
.dm-preview-img.cursor-grabbing {
  transition: none;
}

</style>
