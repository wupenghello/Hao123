<script setup lang="ts">
import type { StorageNotice } from '@/features/storage-health'
import IconCheck from '~icons/mdi/check-circle'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconClose from '~icons/mdi/close'

defineProps<{ notices: StorageNotice[] }>()
const emit = defineEmits<{
  (e: 'close', id: number): void
}>()
</script>

<template>
  <Teleport to="body">
    <div class="storage-toast-wrap" aria-live="polite">
      <div
        v-for="notice in notices"
        :key="notice.id"
        class="storage-toast"
        :class="`is-${notice.kind}`"
        role="status"
      >
        <IconCheck v-if="notice.kind === 'cleaned'" class="storage-toast-icon text-emerald-400" />
        <IconAlert v-else class="storage-toast-icon" />
        <div class="storage-toast-body">
          <div class="storage-toast-title">{{ notice.title }}</div>
          <div class="storage-toast-desc">{{ notice.detail }}</div>
        </div>
        <button type="button" class="storage-toast-close" title="关闭" @click="emit('close', notice.id)">
          <IconClose />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.storage-toast-wrap {
  position: fixed;
  right: 16px;
  bottom: 88px;
  z-index: 101;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}
.storage-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: min(340px, calc(100vw - 32px));
  padding: 12px 12px 12px 14px;
  border-radius: 12px;
  background: rgba(20, 24, 36, 0.86);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  color: #e2e8f0;
  animation: storage-toast-in 0.18s ease-out;
}
@keyframes storage-toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
.storage-toast.is-cleaned {
  border-color: rgba(52, 211, 153, 0.4);
}
.storage-toast.is-warning {
  border-color: rgba(251, 191, 36, 0.42);
}
.storage-toast.is-error {
  border-color: rgba(251, 113, 133, 0.45);
}
.storage-toast-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 1px;
  color: #fbbf24;
}
.storage-toast.is-error .storage-toast-icon {
  color: #fb7185;
}
.storage-toast-body {
  flex: 1;
  min-width: 0;
}
.storage-toast-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}
.storage-toast-desc {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(226, 232, 240, 0.7);
}
.storage-toast-close {
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
.storage-toast-close svg {
  width: 14px;
  height: 14px;
}
.storage-toast-close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
</style>
