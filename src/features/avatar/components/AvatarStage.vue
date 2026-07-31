<script setup lang="ts">
/**
 * AvatarStage —— Live2D 渲染画布组件
 *
 * 薄壳：只管创建 canvas、实例化 AvatarRenderer、桥接 props 到渲染器。
 * 上层通过 ref 拿到 renderer 实例，或通过 v-model:state 感知状态。
 *
 * Props:
 *   config    - 模型配置（url + scale）
 *   autoplay  - 是否自动加载（默认 true）
 *
 * Events:
 *   ready     - 模型加载完成
 *   error     - 加载失败
 *   click     - 点击画布（含 canvas 坐标）
 */
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { AvatarRenderer } from '../Live2dRenderer'
import { loadCubism4Runtime } from '../runtime'
import type { AvatarModelConfig } from '../types'
import { DEFAULT_MODEL_CONFIG } from '../config'

const props = withDefaults(
  defineProps<{
    config?: AvatarModelConfig
    autoplay?: boolean
    width?: number
    height?: number
  }>(),
  {
    config: () => DEFAULT_MODEL_CONFIG,
    autoplay: true,
    width: 300,
    height: 400,
  },
)

const emit = defineEmits<{
  ready: []
  error: [error: Error]
  click: [x: number, y: number]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const renderer = ref<AvatarRenderer | null>(null)
const ready = ref(false)
const errorMsg = ref<string | null>(null)

defineExpose({
  /** 暴露渲染器实例，供上层直接调用语义 API */
  renderer,
  /** 便捷方法 */
  setSpeaking: (on: boolean) => renderer.value?.setSpeaking(on),
  setExpression: (expr: any) => renderer.value?.setExpression(expr),
  focus: (x: number, y: number) => renderer.value?.focus(x, y),
  focusReset: () => renderer.value?.focusReset(),
  reset: () => renderer.value?.reset(),
  setScaleFactor: (f: number) => renderer.value?.setScaleFactor(f),
  getScaleFactor: () => renderer.value?.getScaleFactor() ?? 1,
})

function initRenderer() {
  if (!canvasRef.value) return
  const r = new AvatarRenderer(canvasRef.value, props.config)
  r.onReady(() => {
    ready.value = true
    errorMsg.value = null
    emit('ready')
  })
  r.onError((e) => {
    ready.value = false
    errorMsg.value = e.message
    emit('error', e)
  })
  renderer.value = r
  if (props.autoplay) {
    // 先加载运行时，再启动渲染器
    loadCubism4Runtime().then(() => r.start()).catch((e) => {
      errorMsg.value = e instanceof Error ? e.message : String(e)
      emit('error', e instanceof Error ? e : new Error(String(e)))
    })
  }
}

function handleClick(e: MouseEvent) {
  const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
  emit('click', e.clientX - rect.left, e.clientY - rect.top)
  renderer.value?.tap(e.clientX, e.clientY)
}

onMounted(() => {
  initRenderer()
})

onBeforeUnmount(() => {
  renderer.value?.destroy()
  renderer.value = null
})

// 配置变化（切形象）时重建渲染器：canvas 用 :key 按 url 重建，
// destroy 旧渲染器（不碰 canvas DOM）后，等 Vue 挂载新 canvas 再初始化
watch(
  () => props.config.url,
  () => {
    renderer.value?.destroy()
    renderer.value = null
    ready.value = false
    errorMsg.value = null
    nextTick(() => initRenderer())
  },
)
</script>

<template>
  <div class="avatar-stage" :style="{ width: width + 'px', height: height + 'px' }">
    <canvas
      ref="canvasRef"
      :key="props.config.url"
      class="avatar-canvas"
      :width="width"
      :height="height"
      @click="handleClick"
    />
    <div v-if="errorMsg" class="avatar-error">
      <span class="avatar-error-icon">⚠</span>
      <span class="avatar-error-text">{{ errorMsg }}</span>
    </div>
    <div v-else-if="!ready" class="avatar-loading">
      <span class="avatar-loading-dot" />
      <span class="avatar-loading-dot" />
      <span class="avatar-loading-dot" />
    </div>
  </div>
</template>

<style scoped>
.avatar-stage {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background: transparent;
}

.avatar-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

.avatar-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  gap: 6px;
  color: var(--color-warning, #f59e0b);
  background: color-mix(in srgb, var(--color-danger-soft, #fee2e2) 60%, transparent);
  border-radius: 12px;
  padding: 12px;
  text-align: center;
  font-size: 12px;
}

.avatar-error-icon {
  font-size: 22px;
}

.avatar-error-text {
  max-width: 90%;
  word-break: break-word;
}

.avatar-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: color-mix(in srgb, var(--color-base, #fff) 60%, transparent);
  border-radius: 12px;
}

.avatar-loading-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-accent, #6366f1);
  animation: avatar-bounce 1.2s infinite ease-in-out;
}
.avatar-loading-dot:nth-child(2) { animation-delay: 0.15s; }
.avatar-loading-dot:nth-child(3) { animation-delay: 0.3s; }

@keyframes avatar-bounce {
  0%, 80%, 100% { transform: scale(0.4); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}
</style>
