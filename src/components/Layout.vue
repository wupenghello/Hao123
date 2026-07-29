<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import StatusBar from '@/components/status/StatusBar.vue'
import StatusNav from '@/components/status/StatusNav.vue'
import StatusTime from '@/components/status/StatusTime.vue'
import DeckThemeSwitch from '@/components/status/DeckThemeSwitch.vue'
import ClaudeButton from '@/components/status/ClaudeButton.vue'
import ModelConfigHost from '@/components/status/ModelConfigHost.vue'
import WelcomePage from '@/components/WelcomePage.vue'
import { WeatherWidget } from '@/features/weather'
import { ChatCommandPalette, useChatHotkeys } from '@/features/chat'
import { CompanionPet } from '@/features/companion'
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
        <DeckThemeSwitch />
        <WeatherWidget />
        <StatusTime />
      </template>
    </StatusBar>

    <!-- 主内容区：工作台首页（收件箱为主角，AI 退成左下角召唤层）。min-h-0 保证固定高度分配；
         页面级滚动发生在 WelcomePage 内部（.home 自滚，body 永久 overflow:hidden 的约定） -->
    <main class="layout-main flex-1 min-h-0">
      <WelcomePage />
    </main>


    <!-- 助手入口：常驻卡通伙伴（小吴桌宠，Live2D 渲染，默认右下角） -->
    <CompanionPet />

    <!-- 全局命令面板（Spotlight 式，Teleport 到 body，Alt+K 召唤） -->
    <ChatCommandPalette />

    <ModelConfigHost />
  </div>
</template>

<style scoped>
.layout-shell {
  position: relative;
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
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 800;
  color: rgba(224, 242, 254, 0.96);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-shadow: 0 0 16px rgba(0, 217, 255, 0.3);
}
.status-brand::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--color-accent);
  box-shadow: 0 0 12px rgba(0, 217, 255, 0.6);
}
</style>
