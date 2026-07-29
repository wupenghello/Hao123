<script setup lang="ts">
/**
 * DeckThemeSwitch —— 状态栏里的队列可视化主题切换器。
 *
 * 触发按钮显示当前主题（字母 + 短名），点击弹出选择面板列出全部 5 种结构；
 * 选中即切换并持久化（useDeckTheme → localStorage「hao123-deck-theme」）。
 * 默认「J 弧面副卡」。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useDeckTheme } from '@/composables/useDeckTheme'

const { current, currentMeta, themes, setTheme } = useDeckTheme()

const open = ref(false)
const panel = ref<HTMLElement | null>(null)

function toggle() {
  open.value = !open.value
}
function close() {
  open.value = false
}
function pick(id: typeof current.value) {
  setTheme(id)
  close()
}
function onDocClick(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node | null
  if (panel.value && !panel.value.contains(t)) close()
}
onMounted(() => document.addEventListener('click', onDocClick, { passive: true }))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="panel" class="dts">
    <button type="button" class="dts-btn" :title="`队列可视化：${currentMeta.name}`" @click.stop="toggle">
      <span class="dts-letter" :style="{ background: 'var(--c, var(--color-accent))' }">{{ currentMeta.letter }}</span>
      <span class="dts-name">{{ currentMeta.name }}</span>
      <span class="dts-caret" :class="{ up: open }"></span>
    </button>

    <transition name="dts">
      <div v-if="open" class="dts-panel" role="menu" aria-label="选择队列可视化主题">
        <button
          v-for="t in themes"
          :key="t.id"
          type="button"
          class="dts-item"
          :class="{ on: t.id === current }"
          role="menuitemradio"
          :aria-checked="t.id === current"
          @click="pick(t.id)"
        >
          <span class="dts-letter" :style="{ background: 'var(--c, var(--color-accent))' }">{{ t.letter }}</span>
          <span class="dts-meta">
            <span class="dts-item-name">{{ t.name }}</span>
            <span class="dts-item-desc">{{ t.desc }}</span>
          </span>
          <span v-if="t.id === current" class="dts-check"></span>
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.dts {
  position: relative;
  display: flex;
}
.dts-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 9px 0 6px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-ink-2);
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s, color 0.18s;
}
.dts-btn:hover {
  border-color: var(--color-line-hover);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-ink);
}
.dts-letter {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  font: 700 10px/1 var(--font-mono);
  letter-spacing: 0.04em;
  color: var(--color-accent-contrast);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
.dts-name {
  font: 600 10.5px/1 var(--font-mono);
  letter-spacing: 0.05em;
}
.dts-caret {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
  margin-top: -2px;
  transition: transform 0.2s;
}
.dts-caret.up {
  transform: rotate(-135deg);
  margin-top: 2px;
}

.dts-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 60;
  min-width: 248px;
  padding: 5px;
  border-radius: 12px;
  border: 1px solid var(--color-line);
  background: rgba(8, 13, 22, 0.96);
  box-shadow: 0 22px 50px -16px rgba(0, 8, 16, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.dts-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 9px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: var(--color-ink-2);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}
.dts-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-ink);
}
.dts-item.on {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}
.dts-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 0;
  min-width: 0;
}
.dts-item-name {
  font: 600 11px/1.1 var(--font-mono);
  letter-spacing: 0.04em;
}
.dts-item-desc {
  font: 400 9.5px/1.25 var(--font-mono);
  color: var(--color-ink-3);
  letter-spacing: 0.02em;
}
.dts-item.on .dts-item-name {
  color: var(--color-ink);
}
.dts-check {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 0 8px var(--color-accent);
}

.dts-enter-active,
.dts-leave-active {
  transition: opacity 0.16s, transform 0.16s;
}
.dts-enter-from,
.dts-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
