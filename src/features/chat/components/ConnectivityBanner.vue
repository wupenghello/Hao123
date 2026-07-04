<script setup lang="ts">
/**
 * 连通性状态条（连不上大模型时的统一提示）
 *
 * 与 store.error 红色错误条职责区分：
 *  - 红条 = 真·业务错误（解析失败、工具异常、4xx 鉴权）
 *  - 本条（琥珀）= 网络可达性问题（dev 代理未起 / 提供方宕机 / 离线 / 鉴权）
 *
 * 形态：琥珀色（不是「出错」是「暂时不可用」），显示根因文案 + 自动重试指示 + 手动重试按钮。
 * configured=false 时不渲染（那是「未接入」引导，由命令面板空态处理）。
 * prefers-reduced-motion 下取消脉冲，只留文字。
 */
import { computed } from 'vue'
import { useChatStore } from '../store'
import { useConnectivity } from '../connectivity'
import { llm } from '../llm'
import IconRefresh from '~icons/mdi/refresh'
import IconCloudOff from '~icons/mdi/cloud-off-outline'

const store = useChatStore()
const { status, message, autoRetrying } = useConnectivity()

const visible = computed(() => llm.configured && status.value !== 'healthy')
const retrying = computed(() => autoRetrying.value || status.value === 'checking')
const tip = computed(() => {
  if (retrying.value) return `${message.value ?? '正在重试'}…`
  return message.value ?? '暂时连不上小吴'
})

function onRetry() {
  void store.retryConnection()
}
</script>

<template>
  <Transition name="cb-fade">
    <div v-if="visible" class="cb-bar" role="status" aria-live="polite">
      <component :is="retrying ? IconRefresh : IconCloudOff" class="cb-icon" :class="{ 'is-spin': retrying }" />
      <span class="cb-text">{{ tip }}</span>
      <button class="cb-retry" :disabled="retrying" @click="onRetry">
        <IconRefresh class="w-3 h-3" :class="{ 'is-spin': retrying }" />
        <span>{{ retrying ? '重试中' : '重试' }}</span>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.cb-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  margin: 0 12px 8px;
  border-radius: 9px;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.28);
  color: rgba(254, 240, 138, 0.92);
  font-size: 12px;
  backdrop-filter: blur(8px);
}
.cb-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: rgba(252, 211, 77, 0.9);
}
.cb-icon.is-spin {
  animation: cb-spin 0.9s linear infinite;
}
.cb-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cb-retry {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  color: rgba(254, 240, 138, 0.95);
  background: rgba(251, 191, 36, 0.16);
  border: 1px solid rgba(251, 191, 36, 0.3);
  transition: background 0.15s;
  cursor: pointer;
}
.cb-retry:hover:not(:disabled) {
  background: rgba(251, 191, 36, 0.28);
}
.cb-retry:disabled {
  opacity: 0.6;
  cursor: default;
}
.cb-retry .is-spin {
  animation: cb-spin 0.9s linear infinite;
}
@keyframes cb-spin {
  to {
    transform: rotate(360deg);
  }
}

.cb-fade-enter-active,
.cb-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.cb-fade-enter-from,
.cb-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* prefers-reduced-motion：取消脉冲动画，保留文字 */
@media (prefers-reduced-motion: reduce) {
  .cb-icon.is-spin,
  .cb-retry .is-spin {
    animation: none;
  }
  .cb-fade-enter-active,
  .cb-fade-leave-active {
    transition: opacity 0.2s ease;
  }
  .cb-fade-enter-from,
  .cb-fade-leave-to {
    transform: none;
  }
}
</style>
