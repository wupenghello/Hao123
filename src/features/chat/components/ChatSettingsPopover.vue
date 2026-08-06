<script setup lang="ts">
/** 对话设置 popover：历史 token 预算 + 5 个数值字段（Agent 轮数 / 输出上限 / 图片限制 / 网页读取上限）。 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChatSettings } from '../settings'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { settings, update } = useChatSettings()

/** 历史 token 预算以 K 为单位输入（写回 ×1024，遵循 settings.ts 口径） */
const historyK = ref('')

// ── 关闭交互：外点 / Esc ──
const rootEl = ref<HTMLElement | null>(null)

/**
 * 关闭前先把焦点所在的输入框提交（blur 触发 clamp 写回 settings）。
 * 修复「改了数值直接点外面 / 按 Esc / 按 Enter → 数值悄悄丢失」：
 * 原先只有 blur 才写回，用户输入后不点别处就关闭弹窗，改动会被静默丢弃。
 */
function commitFocusedInput() {
  const el = document.activeElement
  if (el instanceof HTMLInputElement && rootEl.value?.contains(el)) el.blur()
}

function onDocClick(e: MouseEvent) {
  if (!props.open) return
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) {
    commitFocusedInput()
    emit('close')
  }
}
function onDocKeydown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    commitFocusedInput()
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
  (o) => {
    if (!o) return
    historyK.value = String(Math.round(settings.value.maxHistoryTokens / 1024))
  },
)

/** 字段行模板参数（label / 绑定值 / 钳制 / 步进 / 单位） */
const FIELDS = [
  { key: 'maxRounds', label: 'Agent 循环轮数', min: 1, max: 200, step: 1, unit: '轮', read: (v: number) => String(v) },
  { key: 'maxOutputTokens', label: '单次输出上限', min: 256, max: 131072, step: 2048, unit: 'tok', read: (v: number) => String(v) },
  { key: 'maxImages', label: '图片数量上限', min: 0, max: 50, step: 1, unit: '张', read: (v: number) => String(v) },
  { key: 'maxImageSizeMB', label: '单张图片上限', min: 1, max: 50, step: 1, unit: 'MB', read: (v: number) => String(v) },
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

/** Enter = 确认输入：立即钳制写回（不必再点别处触发 blur） */
function onEnterField(key: FieldKey, e: KeyboardEvent): void {
  clampField(key, (e.target as HTMLInputElement).value)
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
          @keydown.enter.prevent="clampHistoryK"
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
          @keydown.enter.prevent="onEnterField(f.key, $event)"
        />
        <span class="set-unit">{{ f.unit }}</span>
      </label>
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
</style>
