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
import { watch, onUnmounted, ref } from 'vue'
import IconLoading from '~icons/mdi/loading'
import IconClose from '~icons/mdi/close'
import IconAlert from '~icons/mdi/alert-circle-outline'

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
function onBodyClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target?.tagName === 'IMG') {
    const src = (target as HTMLImageElement).src
    if (src) preview.value = src
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    // Esc 优先关闭图片预览，再关闭详情
    if (preview.value) preview.value = null
    else close()
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
      preview.value = null
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
        class="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-sm cursor-zoom-out"
        @click="preview = null"
      >
        <img :src="preview" class="dm-preview-img" @click.stop />
        <button
          class="absolute top-5 right-5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg p-2 transition-colors"
          @click="preview = null"
        >
          <IconClose class="w-6 h-6" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 卡片视觉基座已抽到全局 src/style.css 的 .hud-panel / .hud-corners / .hud-sheen /
   .hud-accent-bar，本组件只保留预览图等专属样式，避免重复定义导致漂移。 */

/* 图片预览大图：固定上限 + 百分比，二者取小，避免超出视口或拉伸失真 */
.dm-preview-img {
  max-width: min(1100px, 92vw);
  max-height: 90vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 24px 70px -12px rgba(0, 0, 0, 0.6);
  cursor: default;
}

</style>
