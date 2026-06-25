<script setup lang="ts">
import StatusBar from '@/components/status/StatusBar.vue'
import StatusTime from '@/components/status/StatusTime.vue'
import { WeatherWidget } from '@/features/weather'
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- 顶部状态栏（天气 + 时间，通过插槽注入，便于后续扩展） -->
    <StatusBar>
      <template #right>
        <WeatherWidget />
        <StatusTime />
      </template>
    </StatusBar>

    <!-- 主内容区：后续在此添加书签 / 搜索 / 快捷入口等组件 -->
    <main class="flex-1 min-h-0" />
  </div>
</template>
