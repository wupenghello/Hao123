<script setup lang="ts">
/**
 * 通知区：连通性（琥珀）/ 业务错误（红）/ 待审批（琥珀）三合一条。
 * 按优先级只显示最重要的一条：待审批 > 业务错误 > 连通性。
 * 点击审批条 → 滚动定位到对应 Turn 卡；点击错误条 → 关闭。
 */
import { computed } from 'vue'
import { useChatStore } from '../store'
import { useConnectivity } from '../connectivity'
import IconRetry from '~icons/mdi/refresh'
import IconClose from '~icons/mdi/close'

const store = useChatStore()
const { status: connectivityStatus, message: connectivityMsg } = useConnectivity()

const emit = defineEmits<{ locate: [] }>()

type Notice =
  | { kind: 'approval'; text: string; sub: string }
  | { kind: 'error'; text: string }
  | { kind: 'connectivity'; text: string }

const notice = computed<Notice | null>(() => {
  if (store.pendingApprovals.length) {
    const first = store.pendingApprovals[0]
    return {
      kind: 'approval',
      text: `${store.pendingApprovals.length} 项操作待确认`,
      sub: first?.step.label ?? '',
    }
  }
  if (store.error) return { kind: 'error', text: store.error }
  if (connectivityStatus.value === 'unreachable') {
    return { kind: 'connectivity', text: connectivityMsg.value || '连不上模型服务，正在自动重试' }
  }
  return null
})

function onClick() {
  if (!notice.value) return
  if (notice.value.kind === 'approval') emit('locate')
  if (notice.value.kind === 'error') store.error = null
}

function onRetry() {
  void store.retryConnection()
}
</script>

<template>
  <div
    v-if="notice"
    class="notif"
    :class="`is-${notice.kind}`"
    role="status"
    @click="onClick"
  >
    <span class="notif-dot" aria-hidden="true" />
    <span class="notif-text">
      <template v-if="notice.kind === 'approval'">
        {{ notice.text }}<span v-if="notice.sub" class="notif-sub">{{ notice.sub }}</span>
      </template>
      <template v-else>{{ notice.text }}</template>
    </span>
    <button
      v-if="notice.kind === 'connectivity'"
      type="button"
      class="notif-btn"
      title="重试连接"
      @click.stop="onRetry"
    >
      <IconRetry class="w-3.5 h-3.5" />
      <span>重试</span>
    </button>
    <button
      v-else-if="notice.kind === 'approval'"
      type="button"
      class="notif-btn"
      title="全部批准"
      @click.stop="store.approveAllPending()"
    >
      全部批准
    </button>
    <IconClose v-else class="notif-x w-3.5 h-3.5" aria-hidden="true" />
  </div>
</template>

<style scoped>
.notif {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-line);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.notif.is-connectivity {
  background: color-mix(in srgb, var(--color-warning) 7%, transparent);
  border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);
  color: var(--color-warning);
}
.notif.is-error {
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
  color: var(--color-danger);
}
.notif.is-approval {
  background: color-mix(in srgb, var(--color-warning) 7%, transparent);
  border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);
  color: var(--color-ink-2);
}
.notif-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 2px;
  background: currentColor;
}
.notif-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notif-sub {
  margin-left: 6px;
  color: currentColor;
  opacity: 0.8;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
}
.notif-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  height: 22px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}
.notif-btn:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.notif-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.notif-x {
  flex: 0 0 auto;
  opacity: 0.7;
}
</style>
