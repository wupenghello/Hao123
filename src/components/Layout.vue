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
import { ChatPanel, ChatLauncher, useChatHotkeys, useChatStore } from '@/features/chat'
import {
  startStorageHealthMonitor,
  stopStorageHealthMonitor,
} from '@/features/storage-health'

// 全局召唤快捷键：Alt+K / Cmd+K 打开聊天面板，Esc 收起
useChatHotkeys()

// 面板开合状态：供 aside 推挤布局与 launcher 避让使用
const chat = useChatStore()

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

    <!-- 主区 + 右侧停靠聊天面板：面板展开推挤 main；@container 断点让内容随 main 宽度收拢 -->
    <div class="layout-body flex-1 min-h-0 flex flex-row">
      <main class="layout-main flex-1 min-w-0 min-h-0">
        <WelcomePage />
      </main>

      <aside
        class="chat-aside"
        :class="{ 'is-open': chat.open }"
        :inert="!chat.open"
        :aria-hidden="!chat.open"
      >
        <div class="chat-aside-inner">
          <ChatPanel />
        </div>
      </aside>
    </div>

    <!-- 助手入口：可拖拽桌宠（position:fixed，面板打开时自动右移避让） -->
    <ChatLauncher />

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

/* 主内容容器：container 化，让 InboxDeck/WelcomePage/Dock 的断点随 main 宽度（而非视口）变化——
   聊天面板展开推挤 main 时，窄屏分支能正确提前触发 */
.layout-main {
  container-type: inline-size;
  container-name: layout-main;
}

/* 右侧停靠聊天面板：关闭时宽度 0 但保留挂载（滚动位置/草稿不丢），展开推挤 main */
.chat-aside {
  width: 0;
  flex: 0 0 auto;
  overflow: hidden;
  transition: width 340ms var(--ease-out-quint);
}
.chat-aside.is-open {
  width: var(--chat-panel-w, 400px);
}
.chat-aside-inner {
  width: var(--chat-panel-w, 400px);
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--color-line);
}
@media (prefers-reduced-motion: reduce) {
  .chat-aside {
    transition: none;
  }
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
