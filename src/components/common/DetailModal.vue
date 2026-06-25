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
            class="dm-card relative z-10 w-[90vw] max-w-[880px] max-h-[88vh] flex flex-col overflow-hidden"
            @click.stop
          >
            <!-- HUD 四角科技边框 + 入场微光（纯装饰，不参与布局/交互） -->
            <div class="dm-corners" aria-hidden="true" />

            <!-- 顶部渐变条（呼应主题 navy→teal，配色由调用方通过 accent class 提供） -->
            <div class="dm-accent" :class="accent" />

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
/* 卡片：呼应 body 的 navy→teal 渐变主题的玻璃面板 + HUD 全息质感 */
.dm-card {
  border-radius: 20px;
  /* 多层背景：底层细网格（HUD 质感）→ 上层主题渐变（半透明压淡网格，保证文字对比度） */
  background:
    linear-gradient(160deg, rgba(30, 58, 95, 0.92) 0%, rgba(15, 23, 42, 0.94) 55%, rgba(13, 64, 64, 0.92) 100%),
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 28px),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 28px);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  /* 发光描边：外投影 + 内顶高光 + 青色描边光晕 */
  box-shadow:
    0 24px 70px -12px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(45, 212, 191, 0.18),
    0 0 32px -4px rgba(45, 212, 191, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  contain: layout paint;
}

/* HUD 四角科技边框：用一个装饰层的 ::before/::after 各画一条对角线上的两角 */
.dm-corners {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  border-radius: 20px;
  overflow: hidden;
}
/* 左上 + 右下 角 */
.dm-corners::before,
.dm-corners::after {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  border-color: rgba(94, 234, 212, 0.55);
  border-style: solid;
  filter: drop-shadow(0 0 4px rgba(94, 234, 212, 0.5));
}
.dm-corners::before {
  top: 9px;
  left: 9px;
  border-width: 2px 0 0 2px;
  border-top-left-radius: 6px;
}
.dm-corners::after {
  bottom: 9px;
  right: 9px;
  border-width: 0 2px 2px 0;
  border-bottom-right-radius: 6px;
}

/* 入场微光：一道 45° 高光带扫过卡片一次（配合 appear Transition） */
.dm-card::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  border-radius: 20px;
  background: linear-gradient(115deg, transparent 30%, rgba(255, 255, 255, 0.08) 48%, rgba(94, 234, 212, 0.06) 52%, transparent 70%);
  background-size: 250% 100%;
  background-position: 150% 0;
  animation: dm-sheen 0.9s ease-out 0.05s both;
}
@keyframes dm-sheen {
  from { background-position: 150% 0; }
  to { background-position: -120% 0; }
}

/* 顶部渐变高光条（基础尺寸；配色由调用方在自身样式里给 accent class 定义 background）
   升级为流光：背景拉宽后平移 + 同色发光 */
.dm-accent {
  height: 4px;
  width: 100%;
  flex-shrink: 0;
  background-size: 200% 100%;
  box-shadow: 0 0 12px rgba(45, 212, 191, 0.5);
  animation: dm-accent-flow 3.5s linear infinite;
}
@keyframes dm-accent-flow {
  from { background-position: 0% 0; }
  to { background-position: 200% 0; }
}

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

/* 降低动效偏好：关闭持续流光与入场微光 */
@media (prefers-reduced-motion: reduce) {
  .dm-accent { animation: none; }
  .dm-card::after { animation: none; background: none; }
}
</style>
