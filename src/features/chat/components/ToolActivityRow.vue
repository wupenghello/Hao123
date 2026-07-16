<script setup lang="ts">
/** 工具活动行。compact 模式不渲染额外交互。 */
import type { ToolActivity } from '../types'
import IconCheck from '~icons/mdi/check-circle'
import IconLoading from '~icons/mdi/loading'
import IconAlert from '~icons/mdi/alert-circle-outline'

withDefaults(defineProps<{
  activity: ToolActivity
  compact?: boolean
}>(), {
  compact: false,
})

const activityIcon = (status: ToolActivity['status']) =>
  status === 'running' ? IconLoading : status === 'pending' ? IconAlert : status === 'error' ? IconAlert : IconCheck
</script>

<template>
  <div
    class="activity-row"
    :class="[`is-${activity.status}`, { 'is-compact': compact }]"
  >
    <component
      :is="activityIcon(activity.status)"
      class="activity-icon"
      :class="{ 'animate-spin': activity.status === 'running' }"
      aria-hidden="true"
    />
    <span class="activity-label">{{ activity.label }}</span>
    <span v-if="activity.detail" class="activity-detail">{{ activity.detail }}</span>
    <span class="activity-meta">
      <template v-if="activity.status === 'done'">
        <span v-if="activity.duration">
          {{ activity.duration < 1000 ? `${activity.duration}ms` : `${(activity.duration / 1000).toFixed(1)}s` }}
        </span>
      </template>
      <template v-else-if="activity.status === 'running'">
        <span v-if="!compact">查询中</span>
      </template>
      <template v-else-if="activity.status === 'pending'">
        <span v-if="!compact">待确认</span>
      </template>
      <template v-else-if="activity.status === 'error'">
        <span>{{ activity.approval?.decision === 'rejected' ? '已取消' : '失败' }}</span>
      </template>
    </span>
  </div>
</template>

<style scoped>
.activity-row {
  --activity-color: var(--text-muted, #74839a);
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  color: var(--text-secondary, #a8b5c7);
}

.activity-row.is-running { --activity-color: var(--status-info, #60a5fa); }
.activity-row.is-pending { --activity-color: var(--status-warning, #f59e0b); }
.activity-row.is-done { --activity-color: var(--status-success, #34d399); }
.activity-row.is-error { --activity-color: var(--status-danger, #fb7185); }

.activity-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--activity-color);
}

.activity-label {
  color: var(--text-secondary, #a8b5c7);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}

.activity-detail {
  min-width: 0;
  overflow: hidden;
  padding-left: 7px;
  color: var(--text-muted, #74839a);
  border-left: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
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
  color: var(--text-muted, #74839a);
}

@media (prefers-reduced-motion: reduce) {
  .activity-icon {
    animation: none !important;
  }
}
</style>
