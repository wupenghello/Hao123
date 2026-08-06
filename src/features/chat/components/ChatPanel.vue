<script setup lang="ts">
/** 右侧停靠聊天面板壳：错误横幅 + 审批提示条 + 消息区 + 输入区。 */
import { watch } from 'vue'
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
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-raised);
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
