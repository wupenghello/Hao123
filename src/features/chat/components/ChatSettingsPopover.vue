<script setup lang="ts">
/** 对话设置 popover：5 个数值字段 + 偏好数据角（导出 / 清空两步确认）。 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChatSettings } from '../settings'
import {
  countPreferences,
  exportPreferences,
  clearPreferences,
} from '../preference-log'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { settings, update } = useChatSettings()

/** 历史 token 预算以 K 为单位输入（写回 ×1024，遵循 settings.ts 口径） */
const historyK = ref('')

// 偏好数据
const prefCount = ref(0)
const prefOpen = ref(false)
const clearConfirm = ref(false)

async function refreshPrefCount() {
  prefCount.value = await countPreferences()
}

async function doExport() {
  const json = await exportPreferences()
  if (!json) return
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `xiaowu-preferences-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

async function doClear() {
  await clearPreferences()
  clearConfirm.value = false
  prefOpen.value = false
  await refreshPrefCount()
}

// ── 关闭交互：外点 / Esc ──
const rootEl = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  if (!props.open) return
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) emit('close')
}
function onDocKeydown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKeydown, true)
})

watch(
  () => props.open,
  async (o) => {
    if (!o) return
    historyK.value = String(Math.round(settings.value.maxHistoryTokens / 1024))
    clearConfirm.value = false
    prefOpen.value = false
    await refreshPrefCount()
  },
)

/** 字段行模板参数（label / 绑定值 / 钳制 / 步进 / 单位） */
const FIELDS = [
  { key: 'maxRounds', label: 'Agent 循环轮数', min: 1, max: 200, step: 1, unit: '轮', read: (v: number) => String(v) },
  { key: 'maxOutputTokens', label: '单次输出上限', min: 256, max: 131072, step: 2048, unit: 'tok', read: (v: number) => String(v) },
  { key: 'maxImages', label: '图片数量上限', min: 0, max: 50, step: 1, unit: '张', read: (v: number) => String(v) },
  { key: 'readUrlMaxChars', label: '网页读取上限', min: 0, max: 100000, step: 2000, unit: '字', read: (v: number) => String(v) },
] as const

type FieldKey = (typeof FIELDS)[number]['key']

function clampField(key: FieldKey, raw: string): void {
  const f = FIELDS.find((x) => x.key === key)
  if (!f) return
  const n = Number(raw)
  const v = Number.isNaN(n) ? settings.value[key] : Math.max(f.min, Math.min(f.max, Math.round(n)))
  update({ [key]: v })
}

function clampHistoryK(): void {
  const n = Number(historyK.value)
  const v = Number.isNaN(n) ? settings.value.maxHistoryTokens : Math.max(1, Math.min(1024, Math.round(n))) * 1024
  update({ maxHistoryTokens: v })
  historyK.value = String(Math.round(v / 1024))
}
</script>

<template>
  <div
    v-if="open"
    ref="rootEl"
    class="set-pop"
  >
    <div class="set-head">
      <span class="set-eyebrow">SETTINGS</span>
    </div>
    <div class="set-fields">
      <label class="set-row">
        <span class="set-label">历史 Token 预算</span>
        <input
          v-model="historyK"
          class="set-input"
          type="text"
          inputmode="numeric"
          @blur="clampHistoryK"
        />
        <span class="set-unit">K</span>
      </label>
      <label v-for="f in FIELDS" :key="f.key" class="set-row">
        <span class="set-label">{{ f.label }}</span>
        <input
          class="set-input"
          type="text"
          inputmode="numeric"
          :value="f.read(settings[f.key])"
          @blur="clampField(f.key, ($event.target as HTMLInputElement).value)"
        />
        <span class="set-unit">{{ f.unit }}</span>
      </label>
    </div>

    <div class="set-pref">
      <button type="button" class="set-pref-toggle" @click="prefOpen = !prefOpen">
        <span>偏好数据 · {{ prefCount }} 条</span>
        <svg viewBox="0 0 12 12" class="set-chevron" :class="{ 'is-open': prefOpen }" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div v-if="prefOpen" class="set-pref-body">
        <span class="set-pref-desc">👍/👎/重新生成积累的偏好对，用于迭代小吴的回答质量。</span>
        <div class="set-pref-btns">
          <button type="button" class="set-mini-btn" @click="doExport">导出 JSON</button>
          <template v-if="!clearConfirm">
            <button type="button" class="set-mini-btn is-danger" @click="clearConfirm = true">清空</button>
          </template>
          <template v-else>
            <span class="set-pref-ask">确认清空？</span>
            <button type="button" class="set-mini-btn is-danger" @click="doClear">确认</button>
            <button type="button" class="set-mini-btn" @click="clearConfirm = false">取消</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.set-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 12px;
  z-index: 30;
  width: 292px;
  padding: 6px;
  background: var(--color-raised);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.5);
}
.set-head {
  padding: 4px 8px 6px;
}
.set-eyebrow {
  font: 700 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.12em;
  color: var(--color-ink-3);
}
.set-fields {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.set-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 3px 8px;
  border-radius: 4px;
}
.set-row:hover {
  background: var(--color-base);
}
.set-label {
  flex: 1;
  color: var(--color-ink-2);
  font-size: 12px;
}
.set-input {
  width: 64px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--color-line);
  border-radius: 3px;
  background: var(--color-base);
  color: var(--color-ink);
  font: 400 11.5px/1 var(--font-mono, ui-monospace, monospace);
  text-align: right;
  tabular-nums: auto;
}
.set-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
}
.set-unit {
  width: 22px;
  flex: 0 0 auto;
  font: 400 10.5px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.set-pref {
  margin-top: 4px;
  border-top: 1px solid var(--color-line);
}
.set-pref-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--color-ink-3);
  font-size: 11.5px;
  cursor: pointer;
}
.set-pref-toggle:hover {
  color: var(--color-ink-2);
}
.set-chevron {
  width: 12px;
  height: 12px;
  transition: transform var(--duration-fast) var(--ease-out-quint);
}
.set-chevron.is-open {
  transform: rotate(180deg);
}
.set-pref-body {
  padding: 6px 8px 8px;
  background: var(--color-base);
  border-radius: 4px;
}
.set-pref-desc {
  display: block;
  color: var(--color-ink-3);
  font-size: 11px;
  line-height: 1.5;
}
.set-pref-btns {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.set-mini-btn {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--color-line);
  border-radius: 3px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: 11px;
  cursor: pointer;
}
.set-mini-btn:hover {
  background: var(--color-raised);
  color: var(--color-ink);
}
.set-mini-btn.is-danger {
  color: var(--color-danger);
}
.set-mini-btn.is-danger:hover {
  border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
}
.set-pref-ask {
  color: var(--color-danger);
  font-size: 11px;
}
</style>
