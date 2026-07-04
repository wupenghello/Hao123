<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import StatusBar from '@/components/status/StatusBar.vue'
import StatusNav from '@/components/status/StatusNav.vue'
import StatusTime from '@/components/status/StatusTime.vue'
import ClaudeButton from '@/components/status/ClaudeButton.vue'
import WelcomePage from '@/components/WelcomePage.vue'
import { WeatherWidget } from '@/features/weather'
import { ChatCommandPalette, ChatLauncher, useChatHotkeys } from '@/features/chat'
import {
  startStorageHealthMonitor,
  stopStorageHealthMonitor,
} from '@/features/storage-health'

// 全局召唤快捷键：Alt+K / Cmd+K 打开命令面板，Esc 关闭
useChatHotkeys()

onMounted(() => startStorageHealthMonitor())
onUnmounted(() => stopStorageHealthMonitor())
</script>

<template>
  <div class="layout-shell h-screen overflow-hidden flex flex-col">
    <!-- 顶部状态栏：左栏品牌 + 右栏天气/时间（中栏留空） -->
    <StatusBar>
      <template #left>
        <span class="status-brand">TodayOps</span>
        <!-- Claude Code 启动按钮：在 wbscf 项目根目录下新开终端拉起 Claude CLI -->
        <ClaudeButton />
        <!-- 工作台导航：内部系统入口（账号/买卖家/运营/ERP 带 dev/test/pre 子菜单，内部自带分隔线） -->
        <StatusNav />
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
.layout-shell {
  position: relative;
  background:
    radial-gradient(circle at 72% 10%, rgba(125, 211, 252, 0.12), transparent 28%),
    radial-gradient(circle at 10% 92%, rgba(45, 212, 191, 0.1), transparent 26%);
}
.layout-shell::before {
  content: '';
  position: absolute;
  inset: 36px 0 0;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(3, 7, 18, 0), rgba(3, 7, 18, 0.24));
}
.status-brand {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--hud-font-data);
  font-size: 12px;
  font-weight: 700;
  color: rgba(224, 242, 254, 0.96);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  text-shadow: 0 0 16px rgba(125, 211, 252, 0.38);
}
.status-brand::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--hud-teal);
  box-shadow: 0 0 12px rgba(94, 234, 212, 0.9);
}
</style>
