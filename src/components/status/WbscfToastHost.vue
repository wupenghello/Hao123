<script setup lang="ts">
/**
 * wbscf-web 启动进度 toast 宿主
 *
 * 从 StatusNav 抽出的独立通知组件（review #14：通知子系统不该内联在导航组件里）。
 * 接收 toast 列表（由 useWbscfServices 持有状态），渲染到 body 固定右下角；
 * 关闭 / 打开由 emit 回传给宿主组件转发给 composable。
 *
 * 这里只负责展示，状态与定时器都在 useWbscfServices 里，便于日后被其它特性复用。
 */
import type { WbscfToast } from '@/features/wbscf'
import IconCheck from '~icons/mdi/check-circle'
import IconLoading from '~icons/mdi/loading'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconClose from '~icons/mdi/close'

defineProps<{ toasts: WbscfToast[] }>()
const emit = defineEmits<{
  (e: 'close', app: string): void
  (e: 'open', url: string): void
}>()

function toastDesc(t: WbscfToast): string {
  if (t.state === 'starting') return '正在启动本地 dev 服务，首次构建可能需要数十秒…'
  if (t.state === 'ready') return '已就绪，已在新的标签页打开'
  return '启动超时，请到运行 Hao123 的终端查看 wbscf-web 报错'
}
</script>

<template>
  <Teleport to="body">
    <div class="wbscf-toast-wrap" aria-live="polite">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="wbscf-toast"
        :class="`is-${t.state}`"
        role="status"
      >
        <IconCheck v-if="t.state === 'ready'" class="wbscf-toast-icon text-emerald-400" />
        <IconLoading v-else-if="t.state === 'starting'" class="wbscf-toast-icon status-nav-spin text-sky-300" />
        <IconAlert v-else class="wbscf-toast-icon text-rose-400" />
        <div class="wbscf-toast-body">
          <div class="wbscf-toast-title">{{ t.label }} · localhost:{{ t.port }}</div>
          <div class="wbscf-toast-desc">{{ toastDesc(t) }}</div>
        </div>
        <button
          v-if="t.state === 'ready' || t.state === 'failed'"
          type="button"
          class="wbscf-toast-open"
          @click="emit('open', t.url)"
        >打开</button>
        <button type="button" class="wbscf-toast-close" title="关闭" @click="emit('close', t.app)">
          <IconClose />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 旋转动画：toast 复用 StatusNav 的同名 class，但 scoped 下各自定义一份避免跨组件依赖 */
.status-nav-spin {
  animation: status-nav-spin 0.9s linear infinite;
}
@keyframes status-nav-spin {
  to {
    transform: rotate(360deg);
  }
}

.wbscf-toast-wrap {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}
.wbscf-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 300px;
  padding: 12px 12px 12px 14px;
  border-radius: 12px;
  background: rgba(20, 24, 36, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  color: #e2e8f0;
  animation: wbscf-toast-in 0.18s ease-out;
}
@keyframes wbscf-toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
.wbscf-toast.is-ready {
  border-color: rgba(52, 211, 153, 0.4);
}
.wbscf-toast.is-failed {
  border-color: rgba(251, 113, 133, 0.4);
}
.wbscf-toast-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}
.wbscf-toast-body {
  flex: 1;
  min-width: 0;
}
.wbscf-toast-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}
.wbscf-toast-desc {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(226, 232, 240, 0.66);
}
.wbscf-toast-open {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 7px;
  border: 1px solid rgba(103, 232, 249, 0.4);
  background: rgba(103, 232, 249, 0.08);
  color: #67e8f9;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.15s;
}
.wbscf-toast-open:hover {
  background: rgba(103, 232, 249, 0.18);
}
.wbscf-toast-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(226, 232, 240, 0.5);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}
.wbscf-toast-close svg {
  width: 14px;
  height: 14px;
}
.wbscf-toast-close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
</style>
