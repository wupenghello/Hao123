<script setup lang="ts">
/**
 * 工具活动卡片行：抽取中间步骤和正常助手泡泡共用的 activity 行渲染。
 * compact 模式下缩小图标、降低不透明度，且不渲染交互元素（展开箭头/重试/审批/结果预览）。
 */
import type { ToolActivity } from '../types'
import IconCheck from '~icons/mdi/check-circle'
import IconLoading from '~icons/mdi/loading'
import IconAlert from '~icons/mdi/alert-circle-outline'

defineProps<{
  activity: ToolActivity
  compact?: boolean
}>()

const activityIcon = (s: ToolActivity['status']) =>
  s === 'running' ? IconLoading : s === 'pending' ? IconAlert : s === 'error' ? IconAlert : IconCheck
</script>

<template>
  <div class="flex items-center w-full">
    <component
      :is="activityIcon(activity.status)"
      class="shrink-0"
      :class="[
        compact ? 'w-3 h-3' : 'w-3.5 h-3.5',
        {
          'animate-spin': activity.status === 'running',
          'text-teal-300/50': activity.status === 'running' && compact,
          'text-teal-300/80': activity.status === 'running' && !compact,
          'text-amber-300/90': activity.status === 'pending',
          'text-emerald-300/50': activity.status === 'done' && compact,
          'text-emerald-300/80': activity.status === 'done' && !compact,
          'text-rose-300/50': activity.status === 'error' && compact,
          'text-rose-300/80': activity.status === 'error' && !compact,
        },
      ]"
    />
    <span :class="compact ? 'text-white/55 text-[11px]' : 'text-white/70'">
      {{ activity.label }}
    </span>
    <span
      v-if="activity.detail"
      class="truncate"
      :class="compact ? 'text-white/25 text-[11px]' : 'text-white/35'"
    >· {{ activity.detail }}</span>
    <span
      class="ml-auto shrink-0 flex items-center gap-1"
      :class="compact ? 'text-[10px] text-white/20' : 'text-[10px] text-white/30'"
    >
      <template v-if="activity.status === 'done'">
        <span :class="compact ? 'text-emerald-300/40' : 'text-emerald-300/60'">✓</span>
        <span v-if="activity.duration">{{ activity.duration < 1000 ? `${activity.duration}ms` : `${(activity.duration / 1000).toFixed(1)}s` }}</span>
      </template>
      <template v-else-if="activity.status === 'running'">
        <span v-if="!compact">查询中</span>
      </template>
      <template v-else-if="activity.status === 'pending'">
        <span v-if="!compact" class="text-amber-300/80">待确认</span>
      </template>
      <template v-else-if="activity.status === 'error'">
        <span :class="compact ? 'text-rose-300/50' : ''">
          {{ activity.approval?.decision === 'rejected' ? '已取消' : '失败' }}
        </span>
      </template>
    </span>
  </div>
</template>
