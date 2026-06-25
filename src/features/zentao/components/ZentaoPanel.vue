<script setup lang="ts">
/**
 * 禅道面板：把「我的任务」与「我的 Bug」作为两个**独立区块**并排呈现。
 * 各自是自包含子模块（task / bug），有独立的 store、加载、刷新与详情弹窗，互不影响。
 * 宽屏两列、窄屏自动堆叠为一列。
 */
import { TaskPanel } from '../task'
import { BugPanel } from '../bug'
</script>

<template>
  <div class="w-full max-w-5xl mx-auto grid gap-5 lg:grid-cols-2">
    <TaskPanel />
    <BugPanel />
  </div>
</template>
