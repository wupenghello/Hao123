<script setup lang="ts">
import StatusBar from '@/components/status/StatusBar.vue'
import StatusTime from '@/components/status/StatusTime.vue'
import WelcomePage from '@/components/WelcomePage.vue'
import { WeatherWidget } from '@/features/weather'
import { ChatCommandPalette, ChatLauncher, useChatHotkeys } from '@/features/chat'

// 全局召唤快捷键：Alt+K / Cmd+K 打开命令面板，Esc 关闭
useChatHotkeys()
</script>

<template>
  <div class="h-screen overflow-hidden flex flex-col">
    <!-- 顶部状态栏：左栏品牌 + 右栏天气/时间（中栏留空） -->
    <StatusBar>
      <template #left>
        <span class="status-brand">Hao123</span>
        <span class="status-brand-dot">·</span>
        <span class="status-brand-sub">工作台</span>
      </template>
      <template #right>
        <WeatherWidget />
        <StatusTime />
      </template>
    </StatusBar>

    <!-- 主内容区：工作台首页（收件箱为主角，AI 退成左下角召唤层）。min-h-0 让其能在固定高度内滚动 -->
    <main class="flex-1 min-h-0">
      <WelcomePage />
    </main>

    <!-- 助手入口：固定左下角小药丸（position:fixed，视口定位） -->
    <ChatLauncher />

    <!-- 全局命令面板（Spotlight 式，Teleport 到 body，Alt+K 召唤） -->
    <ChatCommandPalette />
  </div>
</template>

<style scoped>
.status-brand {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: -0.01em;
}
.status-brand-dot {
  color: rgba(255, 255, 255, 0.25);
  font-size: 13px;
}
.status-brand-sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}
</style>

