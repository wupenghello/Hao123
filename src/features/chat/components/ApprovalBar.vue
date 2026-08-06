<script setup lang="ts">
/** 待审批提示条：pending 审批常驻可见，展示首项动作 + 全部批准 / 点击定位到确认卡。 */
import { useChatStore } from '../store'

const store = useChatStore()

const emit = defineEmits<{ locate: [] }>()

function onLocate() {
  if (!store.pendingApprovals.length) return
  emit('locate')
}

/** 全部批准（逐个；store 内每次批准后检查是否还有其它 pending，最后一个处理完才续跑 agent 循环） */
async function approveAll() {
  const pending = [...store.pendingApprovals]
  for (const p of pending) {
    if (store.pendingApprovals.some((q) => q.activity === p.activity)) {
      await store.approveTool(p.messageIndex, p.activityIndex)
    }
  }
}
</script>

<template>
  <div
    v-if="store.pendingApprovals.length > 0"
    class="approval-bar"
    role="status"
  >
    <span class="approval-dot" aria-hidden="true" />
    <span class="approval-text" @click="onLocate">
      {{ store.pendingApprovals.length }} 项操作待确认
      <span class="approval-tool">{{ store.pendingApprovals[0]?.activity.label }}</span>
    </span>
    <button type="button" class="approval-all" :disabled="store.streaming" @click="approveAll">
      全部批准
    </button>
  </div>
</template>

<style scoped>
.approval-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
  background: color-mix(in srgb, var(--color-warning) 7%, transparent);
  color: var(--color-ink-2);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.approval-bar:hover {
  background: color-mix(in srgb, var(--color-warning) 11%, transparent);
}
.approval-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 2px;
  background: var(--color-warning);
}
.approval-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.approval-tool {
  color: var(--color-warning);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
}
.approval-all {
  flex: 0 0 auto;
  height: 22px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 45%, transparent);
  border-radius: 3px;
  background: transparent;
  color: var(--color-warning);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}
.approval-all:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-warning) 14%, transparent);
}
.approval-all:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
