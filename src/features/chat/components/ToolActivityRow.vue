<script setup lang="ts">
/** 工具活动行：展示单个 ToolStep 的状态 / 耗时 / 审批态。compact 模式不渲染额外交互。 */
import type { ToolStep } from '../turns'
import IconCheck from '~icons/mdi/check-circle'
import IconLoading from '~icons/mdi/loading'
import IconAlert from '~icons/mdi/alert-circle-outline'

withDefaults(defineProps<{
  step: ToolStep
  compact?: boolean
}>(), {
  compact: false,
})

const activityIcon = (status: ToolStep['status']) =>
  status === 'running' ? IconLoading : status === 'pending' ? IconAlert : status === 'error' ? IconAlert : IconCheck
</script>

<template>
  <div
    class="activity-row"
    :class="[`is-${step.status}`, { 'is-compact': compact }]"
  >
    <component
      :is="activityIcon(step.status)"
      class="activity-icon"
      :class="{ 'animate-spin': step.status === 'running' }"
      aria-hidden="true"
    />
    <span class="activity-label">{{ step.label }}</span>
    <span v-if="step.detail" class="activity-detail">{{ step.detail }}</span>
    <span class="activity-meta">
      <template v-if="step.status === 'done'">
        <span v-if="step.duration">
          {{ step.duration < 1000 ? `${step.duration}ms` : `${(step.duration / 1000).toFixed(1)}s` }}
        </span>
      </template>
      <template v-else-if="step.status === 'running'">
        <span v-if="!compact">查询中</span>
      </template>
      <template v-else-if="step.status === 'pending'">
        <span v-if="!compact">待确认</span>
      </template>
      <template v-else-if="step.status === 'error'">
        <span>{{ step.approval?.decision === 'rejected' ? '已取消' : '失败' }}</span>
      </template>
    </span>
  </div>
</template>

<style scoped>
.activity-row {
  --activity-color: var(--color-ink-3);
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  color: var(--color-ink-2);
}

.activity-row.is-running { --activity-color: var(--color-accent); }
.activity-row.is-pending { --activity-color: var(--color-warning); }
.activity-row.is-done { --activity-color: var(--color-success); }
.activity-row.is-error { --activity-color: var(--color-danger); }

.activity-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--activity-color);
}

.activity-label {
  color: var(--color-ink-2);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}

.activity-detail {
  min-width: 0;
  overflow: hidden;
  padding-left: 7px;
  color: var(--color-ink-3);
  border-left: 1px solid var(--color-line);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-meta {
  color: var(--activity-color);
  font: 650 10px/1 var(--font-mono, ui-monospace, monospace);
  white-space: nowrap;
}

.activity-row.is-compact {
  gap: 6px;
  opacity: 0.72;
}

.is-compact .activity-icon {
  width: 12px;
  height: 12px;
}

.is-compact .activity-label,
.is-compact .activity-detail {
  font-size: 11px;
}

.is-compact .activity-meta {
  color: var(--color-ink-3);
}

@media (prefers-reduced-motion: reduce) {
  .activity-icon {
    animation: none !important;
  }
}
</style>
