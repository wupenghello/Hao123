<script setup lang="ts">
/** 面板头部：会话切换入口（popover）+ 新建 / 设置 / 收起。 */
import { ref } from 'vue'
import { useChatStore } from '../store'
import SessionListPopover from './SessionListPopover.vue'
import ChatSettingsPopover from './ChatSettingsPopover.vue'
import IconPlus from '~icons/mdi/plus'
import IconSettings from '~icons/mdi/cog-outline'
import IconCollapse from '~icons/mdi/chevron-right'

const store = useChatStore()

const emit = defineEmits<{ close: [] }>()

const sessionOpen = ref(false)
const settingsOpen = ref(false)

function newSession() {
  store.newSession()
  sessionOpen.value = false
}
</script>

<template>
  <header class="p-head">
    <div class="p-head-top">
      <span class="p-eyebrow">SESSION</span>
      <span class="p-time">{{ new Date(store.activeSession?.updatedAt ?? Date.now()).toTimeString().slice(0, 5) }}</span>
    </div>
    <div class="p-head-main">
      <button type="button" class="p-title" title="切换会话" @click="sessionOpen = !sessionOpen">
        <span class="p-title-text">{{ store.currentSessionTitle }}</span>
        <svg viewBox="0 0 12 12" class="p-chevron" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="p-actions">
        <button type="button" class="p-icon-btn" title="新建会话" @click="newSession">
          <IconPlus class="w-3.5 h-3.5" />
        </button>
        <button type="button" class="p-icon-btn" title="对话设置" @click="settingsOpen = !settingsOpen">
          <IconSettings class="w-3.5 h-3.5" />
        </button>
        <button type="button" class="p-icon-btn" title="收起面板" @click="emit('close')">
          <IconCollapse class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <SessionListPopover
      :open="sessionOpen"
      @close="sessionOpen = false"
    />
    <ChatSettingsPopover
      :open="settingsOpen"
      @close="settingsOpen = false"
    />
  </header>
</template>

<style scoped>
.p-head {
  position: relative;
  flex: 0 0 auto;
  padding: 8px 12px 9px;
  border-bottom: 1px solid var(--color-line);
}
.p-head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
}
.p-eyebrow {
  font: 700 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.12em;
  color: var(--color-ink-3);
}
.p-time {
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.p-head-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.p-title {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-ink);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.p-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.p-title:hover .p-title-text {
  color: var(--color-accent-strong);
}
.p-chevron {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  color: var(--color-ink-3);
}
.p-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
  flex: 0 0 auto;
}
.p-icon-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--color-ink-3);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out-quint), color var(--duration-fast) var(--ease-out-quint);
}
.p-icon-btn:hover {
  background: var(--color-raised);
  color: var(--color-ink);
}
.p-icon-btn:focus-visible {
  border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
}
</style>
