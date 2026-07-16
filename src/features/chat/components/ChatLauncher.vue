<script setup lang="ts">
/** 固定在视口左下角的助手入口，保留未读与运行期连通性提示。 */
import { computed } from 'vue'
import { useChatStore } from '../store'
import { useConnectivity } from '../connectivity'
import { ASSISTANT_NAME } from '../config'
import { activeModel, activeProvider, configured as modelConfigured, hasUiConfig } from '@/features/model-config'
import IconRobot from '~icons/mdi/robot-happy-outline'
import IconCheckNetwork from '~icons/mdi/check-network-outline'
import IconNetworkOff from '~icons/mdi/network-off-outline'

const store = useChatStore()
const { status: connectivityStatus, message: connectivityMsg } = useConnectivity()

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
  return `${ASSISTANT_NAME} · AI 助手（${keyHint.value}）｜${modelTitle.value}${status}`
})
</script>

<template>
  <button
    type="button"
    class="chat-launcher"
    :class="{ 'has-unread': store.unread, 'is-unreachable': statusState === 'down' }"
    :title="launcherTitle"
    :aria-label="launcherTitle"
    @click="store.show()"
  >
    <span class="launcher-icon" aria-hidden="true">
      <IconRobot class="w-[18px] h-[18px]" />
    </span>
    <span class="launcher-label">问{{ ASSISTANT_NAME }}</span>
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
    <kbd class="launcher-shortcut">{{ keyHint }}</kbd>
    <span v-if="store.unread" class="launcher-unread" aria-hidden="true">新</span>
  </button>
</template>

<style scoped>
.chat-launcher {
  position: fixed;
  left: max(16px, env(safe-area-inset-left));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 40;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 5px 7px 5px 5px;
  color: var(--text-secondary, #a8b5c7);
  background: var(--surface-raised, #142238);
  border: 1px solid var(--border-strong, rgba(148, 163, 184, 0.3));
  border-radius: 7px;
  box-shadow: var(--shadow-raised, 0 12px 32px rgba(2, 6, 23, 0.32));
  cursor: pointer;
  transition: color var(--dur-fast, 160ms) var(--ease), background var(--dur-fast, 160ms) var(--ease), border-color var(--dur-fast, 160ms) var(--ease), transform var(--dur-fast, 160ms) var(--ease);
}

.chat-launcher:hover {
  color: var(--text-primary, #e8eef7);
  background: color-mix(in srgb, var(--surface-raised, #142238) 88%, var(--accent-primary, #38bdf8));
  border-color: var(--accent-primary, #38bdf8);
}

.chat-launcher:active {
  transform: translateY(1px);
}

.chat-launcher.is-unreachable {
  border-color: color-mix(in srgb, var(--status-warning, #f59e0b) 58%, var(--border-default, rgba(148, 163, 184, 0.2)));
}

.launcher-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  flex: 0 0 auto;
  color: var(--accent-hover, #7dd3fc);
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  border-radius: 4px;
}

.launcher-label {
  color: inherit;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
}

.launcher-status {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 4px;
}

.launcher-status.is-ok {
  color: var(--status-success, #34d399);
  background: var(--status-success-soft, rgba(52, 211, 153, 0.1));
}

.launcher-status.is-down {
  color: var(--status-warning, #f59e0b);
  background: var(--status-warning-soft, rgba(245, 158, 11, 0.1));
}

.launcher-shortcut,
.launcher-unread {
  display: inline-grid;
  place-items: center;
  min-height: 22px;
  border-radius: 4px;
  font-weight: 700;
  white-space: nowrap;
}

.launcher-shortcut {
  min-width: 38px;
  padding: 0 6px;
  color: var(--text-muted, #74839a);
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  font: 650 9px/1 var(--font-mono, ui-monospace, monospace);
}

.launcher-unread {
  min-width: 22px;
  padding: 0 5px;
  color: var(--status-danger, #fb7185);
  background: var(--status-danger-soft, rgba(251, 113, 133, 0.1));
  border: 1px solid color-mix(in srgb, var(--status-danger, #fb7185) 40%, transparent);
  font-size: 9px;
}

@media (max-width: 480px) {
  .chat-launcher {
    left: max(10px, env(safe-area-inset-left));
    bottom: max(10px, env(safe-area-inset-bottom));
  }

  .launcher-shortcut {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-launcher {
    transition: none;
  }
}
</style>
