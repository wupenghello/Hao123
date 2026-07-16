<script setup lang="ts">
/** 对话参数设置弹窗：统一的 header / 可滚动 body / footer 模态结构。 */
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { useChatSettings, CHAT_SETTINGS_DEFAULTS } from '../settings'
import type { ChatSettings } from '../settings'
import { useChatStore } from '../store'
import IconCog from '~icons/mdi/cog-outline'
import IconClose from '~icons/mdi/close'
import IconUndo from '~icons/mdi/undo-variant'
import IconSync from '~icons/mdi/sync'
import IconDatabaseOutline from '~icons/mdi/database-outline'
import IconMessageText from '~icons/mdi/message-text-outline'
import IconImageMultiple from '~icons/mdi/image-multiple-outline'
import IconFileDocument from '~icons/mdi/file-document-outline'
import IconShieldCheck from '~icons/mdi/shield-check-outline'
import IconScaleBalance from '~icons/mdi/scale-balance'
import IconChevronTripleUp from '~icons/mdi/chevron-triple-up'
import IconRocket from '~icons/mdi/rocket-launch-outline'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconDownload from '~icons/mdi/download-outline'
import IconTrash from '~icons/mdi/trash-can-outline'
import IconMinus from '~icons/mdi/minus'
import IconPlus from '~icons/mdi/plus'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { settings, update } = useChatSettings()
const chatStore = useChatStore()
const dialogRef = ref<HTMLElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)

const draft = reactive<ChatSettings>({ ...settings.value })
let savedSnapshot: ChatSettings = { ...settings.value }
let restoreFocusTo: HTMLElement | null = null
let previousBodyOverflow = ''
let bodyLocked = false

function lockBody() {
  if (bodyLocked || typeof document === 'undefined') return
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  bodyLocked = true
}

function unlockBody() {
  if (!bodyLocked || typeof document === 'undefined') return
  document.body.style.overflow = previousBodyOverflow
  bodyLocked = false
}

watch(
  () => props.open,
  async (now) => {
    if (now) {
      savedSnapshot = { ...settings.value }
      Object.assign(draft, settings.value)
      restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      lockBody()
      void chatStore.refreshPreferenceCount()
      await nextTick()
      closeButtonRef.value?.focus()
      return
    }

    unlockBody()
    await nextTick()
    restoreFocusTo?.focus()
    restoreFocusTo = null
  },
  { immediate: true, flush: 'post' },
)

function close() {
  emit('update:open', false)
}

function focusableElements(): HTMLElement[] {
  if (!dialogRef.value) return []
  return Array.from(
    dialogRef.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute('hidden'))
}

function handleDialogKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = focusableElements()
  if (!focusable.length) {
    event.preventDefault()
    dialogRef.value?.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

interface Preset {
  id: string
  label: string
  desc: string
  icon: typeof IconSync
  values: ChatSettings
}

const presets: Preset[] = [
  {
    id: 'safe', label: '保守', desc: '稳定低耗', icon: IconShieldCheck,
    values: { maxRounds: 8, maxHistoryTokens: 24_000, maxOutputTokens: 4_096, maxImages: 4, readUrlMaxChars: 6_000 },
  },
  {
    id: 'balanced', label: '均衡', desc: '日常够用', icon: IconScaleBalance,
    values: { maxRounds: 20, maxHistoryTokens: 64_000, maxOutputTokens: 8_192, maxImages: 6, readUrlMaxChars: 12_000 },
  },
  {
    id: 'spacious', label: '宽裕', desc: '默认推荐', icon: IconChevronTripleUp,
    values: { ...CHAT_SETTINGS_DEFAULTS },
  },
  {
    id: 'extreme', label: '极限', desc: '火力全开', icon: IconRocket,
    values: { maxRounds: 100, maxHistoryTokens: 256_000, maxOutputTokens: 81_920, maxImages: 20, readUrlMaxChars: 0 },
  },
]

function isPresetActive(preset: Preset): boolean {
  return (Object.keys(preset.values) as (keyof ChatSettings)[]).every(
    (key) => preset.values[key] === draft[key],
  )
}

function applyPreset(preset: Preset) {
  Object.assign(draft, preset.values)
}

interface FieldDef {
  key: keyof ChatSettings
  label: string
  desc: string
  icon: typeof IconSync
  step: number
  bounds: [number, number]
  tone?: string
}

const fieldDefs: FieldDef[] = [
  {
    key: 'maxRounds', label: 'Agent 循环轮数', desc: '一次提问中模型最多调用几轮工具。增大可处理更复杂的组合任务。',
    icon: IconSync, step: 5, bounds: [1, 200],
  },
  {
    key: 'maxHistoryTokens', label: '历史 Token 预算', desc: '对话历史发给模型时的 token 预算。超出时自动截断早期消息。',
    icon: IconDatabaseOutline, step: 8_000, bounds: [1_000, 1_000_000],
  },
  {
    key: 'maxOutputTokens', label: '单次输出上限', desc: '模型单次回复的最大输出 token 数。回答轮需较大值，工具调用轮很短。',
    icon: IconMessageText, step: 2_048, bounds: [256, 131_072],
  },
  {
    key: 'maxImages', label: '图片数量上限', desc: '一次最多可发送的图片张数。图片转 base64 随请求发送，过多会显著增加延迟与费用。',
    icon: IconImageMultiple, step: 1, bounds: [0, 50],
  },
  {
    key: 'readUrlMaxChars', label: '网页读取上限', desc: '读取公开网页链接时，正文单字段保留的最大字符数。增大可让小吴看到更完整的原文、分层呈现观点；设为 0 表示不裁剪。占用上下文，过大可能推高成本。',
    icon: IconFileDocument, tone: '#22d3ee', step: 2_000, bounds: [0, 100_000],
  },
]

function formatValue(def: FieldDef): string {
  const value = draft[def.key]
  if (def.key === 'maxHistoryTokens' || def.key === 'maxOutputTokens') {
    if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1000 === 0 ? 0 : 1)}K`
    return String(value)
  }
  if (def.key === 'readUrlMaxChars') {
    if (value === 0) return '不裁剪'
    if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1000 === 0 ? 0 : 1)}K 字符`
    return `${value} 字符`
  }
  if (def.key === 'maxRounds') return `${value} 轮`
  return `${value} 张`
}

function scalePercent(def: FieldDef): number {
  const [low, high] = def.bounds
  return Math.round(((draft[def.key] - low) / (high - low)) * 100)
}

function isDirty(key: keyof ChatSettings): boolean {
  return draft[key] !== savedSnapshot[key]
}

function clamp(def: FieldDef, value: number): number {
  const [low, high] = def.bounds
  return Math.max(low, Math.min(high, Math.round(value)))
}

function stepDown(def: FieldDef) {
  draft[def.key] = clamp(def, draft[def.key] - def.step)
}

function stepUp(def: FieldDef) {
  draft[def.key] = clamp(def, draft[def.key] + def.step)
}

function apply() {
  const clamped: ChatSettings = { ...draft }
  for (const def of fieldDefs) {
    const [low, high] = def.bounds
    clamped[def.key] = Math.max(low, Math.min(high, Math.round(draft[def.key])))
  }
  update(clamped)
  close()
}

function handleReset() {
  Object.assign(draft, CHAT_SETTINGS_DEFAULTS)
}

async function exportPreferences() {
  const json = await chatStore.exportPreferencesData()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `chat-preferences-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function clearPreferences() {
  if (!chatStore.preferenceCount) return
  if (!window.confirm(`确定清空全部 ${chatStore.preferenceCount} 条偏好数据？此操作不可撤销。`)) return
  await chatStore.clearPreferencesData()
}

const hasChanges = computed(() =>
  (Object.keys(CHAT_SETTINGS_DEFAULTS) as (keyof ChatSettings)[]).some(
    (key) => draft[key] !== savedSnapshot[key],
  ),
)

onUnmounted(unlockBody)
</script>

<template>
  <Teleport to="body">
    <Transition name="cs-fade">
      <div v-if="open" class="cs-shell">
        <div class="cs-backdrop" aria-hidden="true" @click="close" />
        <Transition name="cs-panel" appear>
          <section
            ref="dialogRef"
            class="cs-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-settings-title"
            tabindex="-1"
            @click.stop
            @keydown.stop="handleDialogKeydown"
          >
            <header class="cs-header">
              <div class="cs-brand-mark" aria-hidden="true">
                <IconCog class="w-5 h-5" />
              </div>
              <div class="cs-heading">
                <h2 id="chat-settings-title" class="cs-title">对话参数</h2>
                <p class="cs-subtitle">设置 Agent 循环、上下文窗口和输出限制</p>
              </div>
              <div class="cs-header-actions">
                <button
                  type="button"
                  class="cs-header-btn"
                  :disabled="!hasChanges"
                  title="恢复默认"
                  @click="handleReset"
                >
                  <IconUndo class="w-3.5 h-3.5" />
                  恢复默认
                </button>
                <button
                  ref="closeButtonRef"
                  type="button"
                  class="cs-icon-btn"
                  title="关闭（Esc）"
                  aria-label="关闭对话参数设置"
                  @click="close"
                >
                  <IconClose class="w-4 h-4" />
                </button>
              </div>
            </header>

            <div class="cs-body">
              <div class="cs-hint">
                <IconAlert class="cs-hint-icon w-4 h-4 shrink-0" />
                <span>改动在下次发送消息时生效。可拖动滑杆、使用加减按钮或直接输入数值。</span>
              </div>

              <section class="cs-section" aria-labelledby="chat-settings-presets">
                <div class="cs-section-heading">
                  <h3 id="chat-settings-presets">快速预设</h3>
                  <span>选择后仍可逐项调整</span>
                </div>
                <div class="cs-presets">
                  <button
                    v-for="preset in presets"
                    :key="preset.id"
                    type="button"
                    class="cs-preset"
                    :class="{ 'is-active': isPresetActive(preset) }"
                    :aria-pressed="isPresetActive(preset)"
                    @click="applyPreset(preset)"
                  >
                    <component :is="preset.icon" class="w-4 h-4" />
                    <span class="cs-preset-copy">
                      <strong>{{ preset.label }}</strong>
                      <small>{{ preset.desc }}</small>
                    </span>
                  </button>
                </div>
              </section>

              <section class="cs-section" aria-labelledby="chat-settings-limits">
                <div class="cs-section-heading">
                  <h3 id="chat-settings-limits">参数上限</h3>
                  <span>保存时自动限制在有效范围内</span>
                </div>
                <div class="cs-fields">
                  <div
                    v-for="def in fieldDefs"
                    :key="def.key"
                    class="cs-field"
                    :class="{ 'is-dirty': isDirty(def.key) }"
                  >
                    <div class="cs-field-main">
                      <div class="cs-field-icon" aria-hidden="true">
                        <component :is="def.icon" class="w-4 h-4" />
                      </div>
                      <div class="cs-field-copy">
                        <div class="cs-field-title">
                          <label :for="`chat-setting-${def.key}`">{{ def.label }}</label>
                          <span v-if="isDirty(def.key)" class="cs-dirty-tag">已修改</span>
                        </div>
                        <p>{{ def.desc }}</p>
                      </div>
                      <output class="cs-field-value" :for="`chat-setting-${def.key}`">{{ formatValue(def) }}</output>
                    </div>

                    <div class="cs-field-controls">
                      <div class="cs-range-wrap">
                        <input
                          :id="`chat-setting-${def.key}`"
                          v-model.number="draft[def.key]"
                          type="range"
                          class="cs-range"
                          :min="def.bounds[0]"
                          :max="def.bounds[1]"
                          :step="def.step"
                          :aria-label="def.label"
                          :style="{ '--range-progress': `${scalePercent(def)}%` }"
                        />
                        <span class="cs-range-label">{{ scalePercent(def) }}%</span>
                      </div>

                      <div class="cs-stepper">
                        <button
                          type="button"
                          class="cs-step-btn"
                          :disabled="draft[def.key] <= def.bounds[0]"
                          :aria-label="`减小${def.label}`"
                          @click="stepDown(def)"
                        >
                          <IconMinus class="w-3.5 h-3.5" />
                        </button>
                        <input
                          v-model.number="draft[def.key]"
                          type="number"
                          class="cs-step-input"
                          :aria-label="`${def.label}数值`"
                          :min="def.bounds[0]"
                          :max="def.bounds[1]"
                          :step="def.step"
                        />
                        <button
                          type="button"
                          class="cs-step-btn"
                          :disabled="draft[def.key] >= def.bounds[1]"
                          :aria-label="`增大${def.label}`"
                          @click="stepUp(def)"
                        >
                          <IconPlus class="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section class="cs-section cs-preferences" aria-labelledby="chat-preferences-title">
                <div class="cs-pref-copy">
                  <div class="cs-pref-title-row">
                    <div class="cs-field-icon" aria-hidden="true">
                      <IconDatabaseOutline class="w-4 h-4" />
                    </div>
                    <div>
                      <h3 id="chat-preferences-title">偏好数据</h3>
                      <span>{{ chatStore.preferenceCount }} 条本地记录</span>
                    </div>
                  </div>
                  <p>点赞、点踩和重新生成会在本机 IndexedDB 中保存偏好对，不会上传。</p>
                </div>
                <div class="cs-pref-actions">
                  <button
                    type="button"
                    class="cs-secondary-btn"
                    :disabled="!chatStore.preferenceCount"
                    @click="exportPreferences"
                  >
                    <IconDownload class="w-3.5 h-3.5" />
                    导出 JSON
                  </button>
                  <button
                    type="button"
                    class="cs-secondary-btn is-danger"
                    :disabled="!chatStore.preferenceCount"
                    @click="clearPreferences"
                  >
                    <IconTrash class="w-3.5 h-3.5" />
                    清空
                  </button>
                </div>
              </section>
            </div>

            <footer class="cs-footer">
              <button type="button" class="cs-btn cs-btn-secondary" @click="close">取消</button>
              <button type="button" class="cs-btn cs-btn-primary" @click="apply">保存配置</button>
            </footer>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cs-shell {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 16px;
}

.cs-backdrop {
  position: absolute;
  inset: 0;
  background: var(--surface-overlay, rgba(5, 10, 20, 0.78));
  backdrop-filter: blur(10px);
}

.cs-dialog {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: min(780px, calc(100dvh - 32px));
  overflow: hidden;
  color: var(--text-primary, #e8eef7);
  background: var(--surface-canvas, #0f1a2a);
  border: 1px solid var(--border-strong, rgba(148, 163, 184, 0.28));
  border-radius: 10px;
  box-shadow: var(--shadow-modal, 0 24px 72px rgba(2, 6, 23, 0.48));
}

.cs-header,
.cs-footer {
  position: relative;
  flex: 0 0 auto;
  background: var(--surface-raised, #142238);
}

.cs-header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 76px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
}

.cs-brand-mark,
.cs-field-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: var(--accent-primary, #38bdf8);
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  border-radius: 5px;
}

.cs-brand-mark {
  width: 38px;
  height: 38px;
}

.cs-heading {
  min-width: 0;
  flex: 1;
}

.cs-title,
.cs-section-heading h3,
.cs-pref-title-row h3 {
  margin: 0;
  color: var(--text-primary, #e8eef7);
  font-weight: 750;
}

.cs-title {
  font-size: 18px;
  line-height: 1.3;
}

.cs-subtitle {
  margin: 3px 0 0;
  color: var(--text-secondary, #a8b5c7);
  font-size: 12px;
}

.cs-header-actions,
.cs-pref-actions,
.cs-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cs-header-btn,
.cs-icon-btn,
.cs-secondary-btn,
.cs-btn,
.cs-preset,
.cs-step-btn {
  appearance: none;
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  color: var(--text-secondary, #a8b5c7);
  background: var(--surface-secondary, #111f33);
  cursor: pointer;
  transition: color var(--dur-fast, 160ms) var(--ease), background var(--dur-fast, 160ms) var(--ease), border-color var(--dur-fast, 160ms) var(--ease), transform var(--dur-fast, 160ms) var(--ease);
}

.cs-header-btn:hover:not(:disabled),
.cs-icon-btn:hover,
.cs-secondary-btn:hover:not(:disabled),
.cs-btn-secondary:hover,
.cs-step-btn:hover:not(:disabled),
.cs-preset:hover {
  color: var(--text-primary, #e8eef7);
  background: var(--surface-raised, #142238);
  border-color: var(--border-strong, rgba(148, 163, 184, 0.28));
}

.cs-header-btn:active:not(:disabled),
.cs-icon-btn:active,
.cs-secondary-btn:active:not(:disabled),
.cs-btn:active,
.cs-preset:active,
.cs-step-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.cs-header-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
}

.cs-icon-btn {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 5px;
}

.cs-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 18px;
}

.cs-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  color: var(--text-secondary, #a8b5c7);
  background: var(--status-warning-soft, rgba(245, 158, 11, 0.1));
  border-left: 3px solid var(--status-warning, #f59e0b);
  font-size: 12px;
  line-height: 1.55;
}

.cs-hint-icon {
  margin-top: 1px;
  color: var(--status-warning, #f59e0b);
}

.cs-section {
  margin-top: 18px;
}

.cs-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.cs-section-heading h3,
.cs-pref-title-row h3 {
  font-size: 13px;
}

.cs-section-heading span,
.cs-pref-title-row span {
  color: var(--text-muted, #74839a);
  font-size: 11px;
}

.cs-presets {
  display: flex;
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  border-radius: 6px;
  overflow: hidden;
}

.cs-preset {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
  min-width: 0;
  flex: 1 1 0;
  min-height: 54px;
  padding: 8px 10px;
  border-width: 0 1px 0 0;
  border-radius: 0;
  text-align: left;
}

.cs-preset:last-child {
  border-right: 0;
}

.cs-preset.is-active {
  color: var(--accent-primary, #38bdf8);
  background: var(--accent-soft, rgba(56, 189, 248, 0.12));
  box-shadow: inset 0 -2px 0 var(--accent-primary, #38bdf8);
}

.cs-preset-copy {
  min-width: 0;
}

.cs-preset-copy strong,
.cs-preset-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cs-preset-copy strong {
  color: inherit;
  font-size: 12px;
}

.cs-preset-copy small {
  margin-top: 2px;
  color: var(--text-muted, #74839a);
  font-size: 10px;
}

.cs-fields {
  overflow: hidden;
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  border-radius: 6px;
}

.cs-field {
  padding: 14px;
  background: var(--surface-secondary, #111f33);
  border-bottom: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12));
}

.cs-field:last-child {
  border-bottom: 0;
}

.cs-field.is-dirty {
  box-shadow: inset 3px 0 0 var(--accent-primary, #38bdf8);
}

.cs-field-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.cs-field-icon {
  width: 30px;
  height: 30px;
}

.cs-field-copy {
  min-width: 0;
  flex: 1;
}

.cs-field-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 20px;
}

.cs-field-title label {
  color: var(--text-primary, #e8eef7);
  font-size: 12px;
  font-weight: 700;
}

.cs-dirty-tag {
  padding: 2px 5px;
  color: var(--accent-primary, #38bdf8);
  background: var(--accent-soft, rgba(56, 189, 248, 0.12));
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
}

.cs-field-copy p,
.cs-pref-copy > p {
  margin: 3px 0 0;
  color: var(--text-muted, #74839a);
  font-size: 11px;
  line-height: 1.5;
}

.cs-field-value {
  min-width: 64px;
  padding-top: 2px;
  color: var(--text-primary, #e8eef7);
  font: 750 13px/1.4 var(--font-mono, ui-monospace, monospace);
  text-align: right;
  white-space: nowrap;
}

.cs-field-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 146px;
  gap: 14px;
  align-items: center;
  margin-top: 12px;
  padding-left: 40px;
}

.cs-range-wrap {
  display: flex;
  align-items: center;
  gap: 9px;
}

.cs-range {
  --range-progress: 0%;
  width: 100%;
  height: 24px;
  margin: 0;
  accent-color: var(--accent-primary, #38bdf8);
  background: transparent;
  cursor: pointer;
}

.cs-range::-webkit-slider-runnable-track {
  height: 4px;
  background: linear-gradient(to right, var(--accent-primary, #38bdf8) 0 var(--range-progress), var(--surface-inset, #0b1524) var(--range-progress) 100%);
  border-radius: 2px;
}

.cs-range::-webkit-slider-thumb {
  width: 14px;
  height: 18px;
  margin-top: -7px;
  appearance: none;
  background: var(--text-primary, #e8eef7);
  border: 3px solid var(--accent-primary, #38bdf8);
  border-radius: 3px;
}

.cs-range::-moz-range-track {
  height: 4px;
  background: var(--surface-inset, #0b1524);
  border-radius: 2px;
}

.cs-range::-moz-range-progress {
  height: 4px;
  background: var(--accent-primary, #38bdf8);
  border-radius: 2px;
}

.cs-range::-moz-range-thumb {
  width: 10px;
  height: 14px;
  background: var(--text-primary, #e8eef7);
  border: 3px solid var(--accent-primary, #38bdf8);
  border-radius: 3px;
}

.cs-range-label {
  min-width: 28px;
  color: var(--text-muted, #74839a);
  font: 650 10px/1 var(--font-mono, ui-monospace, monospace);
  text-align: right;
}

.cs-stepper {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 32px;
  height: 34px;
  overflow: hidden;
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  border-radius: 5px;
}

.cs-stepper:focus-within {
  border-color: var(--accent-primary, #38bdf8);
}

.cs-step-btn {
  display: grid;
  place-items: center;
  width: 32px;
  padding: 0;
  border-width: 0 1px 0 0;
  border-radius: 0;
}

.cs-step-btn:last-child {
  border-width: 0 0 0 1px;
}

.cs-step-input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--text-primary, #e8eef7);
  background: transparent;
  font: 650 11px/1 var(--font-mono, ui-monospace, monospace);
  text-align: center;
  appearance: textfield;
}

.cs-step-input::-webkit-outer-spin-button,
.cs-step-input::-webkit-inner-spin-button {
  margin: 0;
  appearance: none;
}

.cs-preferences {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 14px;
  background: var(--surface-secondary, #111f33);
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  border-radius: 6px;
}

.cs-pref-copy {
  min-width: 0;
}

.cs-pref-title-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.cs-pref-title-row > div:last-child {
  display: flex;
  align-items: baseline;
  gap: 7px;
  flex-wrap: wrap;
}

.cs-secondary-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.cs-secondary-btn.is-danger:hover:not(:disabled) {
  color: var(--status-danger, #fb7185);
  background: var(--status-danger-soft, rgba(251, 113, 133, 0.1));
  border-color: var(--status-danger, #fb7185);
}

.cs-footer {
  justify-content: flex-end;
  min-height: 62px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
}

.cs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 15px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 750;
}

.cs-btn-primary {
  color: var(--accent-contrast, #07111f);
  background: var(--accent-primary, #38bdf8);
  border-color: var(--accent-primary, #38bdf8);
}

.cs-btn-primary:hover {
  color: var(--accent-contrast, #07111f);
  background: var(--accent-hover, #7dd3fc);
  border-color: var(--accent-hover, #7dd3fc);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.cs-fade-enter-active,
.cs-fade-leave-active,
.cs-panel-enter-active,
.cs-panel-leave-active {
  transition: opacity var(--dur-fast, 160ms) var(--ease);
}

.cs-panel-enter-active,
.cs-panel-leave-active {
  transition-property: opacity, transform;
}

.cs-fade-enter-from,
.cs-fade-leave-to,
.cs-panel-enter-from,
.cs-panel-leave-to {
  opacity: 0;
}

.cs-panel-enter-from,
.cs-panel-leave-to {
  transform: translateY(8px);
}

@media (max-width: 680px) {
  .cs-shell {
    padding: 8px;
  }

  .cs-dialog {
    max-height: calc(100dvh - 16px);
  }

  .cs-header {
    align-items: flex-start;
    padding: 12px;
  }

  .cs-header-actions {
    margin-left: auto;
  }

  .cs-header-btn {
    width: 32px;
    padding: 0;
    overflow: hidden;
    color: transparent;
    gap: 0;
  }

  .cs-header-btn svg {
    color: var(--text-secondary, #a8b5c7);
  }

  .cs-body {
    padding: 12px;
  }

  .cs-presets {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cs-preset:nth-child(2) {
    border-right: 0;
  }

  .cs-preset:nth-child(-n + 2) {
    border-bottom: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  }

  .cs-field-controls {
    grid-template-columns: 1fr;
    padding-left: 0;
  }

  .cs-preferences {
    align-items: flex-start;
    flex-direction: column;
  }

  .cs-section-heading span {
    display: none;
  }
}

@media (max-width: 420px) {
  .cs-brand-mark {
    display: none;
  }

  .cs-subtitle {
    max-width: 210px;
  }

  .cs-field-main {
    flex-wrap: wrap;
  }

  .cs-field-copy {
    flex-basis: calc(100% - 40px);
  }

  .cs-field-value {
    margin-left: 40px;
    text-align: left;
  }

  .cs-pref-actions {
    width: 100%;
  }

  .cs-secondary-btn {
    flex: 1;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cs-fade-enter-active,
  .cs-fade-leave-active,
  .cs-panel-enter-active,
  .cs-panel-leave-active,
  .cs-header-btn,
  .cs-icon-btn,
  .cs-secondary-btn,
  .cs-btn,
  .cs-preset,
  .cs-step-btn {
    transition: none;
  }
}
</style>
