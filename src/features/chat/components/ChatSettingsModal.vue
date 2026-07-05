<script setup lang="ts">
/**
 * 对话参数设置弹窗
 *
 * 在对话中枢 header 中点击齿轮图标唤出，允许用户调整 Agent 循环轮数、
 * 历史 token 预算、单次输出上限、多模态图片上限。
 *
 * 视觉语言对齐 ModelConfigModal：玻璃拟态 + 网格纹理 + 光束 + 预设卡 + 卡片表单。
 */
import { reactive, watch, computed, ref, onUnmounted } from 'vue'
import { useChatSettings, CHAT_SETTINGS_DEFAULTS } from '../settings'
import type { ChatSettings } from '../settings'
import IconCog from '~icons/mdi/cog-outline'
import IconClose from '~icons/mdi/close'
import IconUndo from '~icons/mdi/undo-variant'
import IconSync from '~icons/mdi/sync'
import IconDatabaseOutline from '~icons/mdi/database-outline'
import IconMessageText from '~icons/mdi/message-text-outline'
import IconImageMultiple from '~icons/mdi/image-multiple-outline'
import IconShieldCheck from '~icons/mdi/shield-check-outline'
import IconScaleBalance from '~icons/mdi/scale-balance'
import IconChevronTripleUp from '~icons/mdi/chevron-triple-up'
import IconRocket from '~icons/mdi/rocket-launch-outline'
import IconAlert from '~icons/mdi/alert-circle-outline'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { settings, update } = useChatSettings()

// ============ 草稿 — 使用 reactive 保证深层响应式 ============
const draft = reactive<ChatSettings>({ ...settings.value })
/** 打开弹窗时的已保存值快照，用于判断"是否修改过" */
let savedSnapshot: ChatSettings = { ...settings.value }

watch(() => props.open, (now) => {
  if (now) {
    savedSnapshot = { ...settings.value }
    Object.assign(draft, settings.value)
    // 打开弹窗时锁定 body 滚动（对齐 DetailModal / ModelConfigModal 行为）
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

function close() {
  emit('update:open', false)
}

function apply() {
  // 保存前钳位所有字段到各自的 bounds，防止用户在输入框直接键入越界值绕过校验
  const clamped: ChatSettings = { ...draft }
  for (const def of fieldDefs) {
    const [lo, hi] = def.bounds
    clamped[def.key] = Math.max(lo, Math.min(hi, Math.round(draft[def.key])))
  }
  update(clamped)
  close()
}

function handleReset() {
  Object.assign(draft, CHAT_SETTINGS_DEFAULTS)
}

// ============ 预设 ============
interface Preset {
  id: string
  label: string
  desc: string
  icon: typeof IconSync
  values: ChatSettings
}

const presets: Preset[] = [
  {
    id: 'safe', label: '保守', desc: '稳定低耗',
    icon: IconShieldCheck,
    values: { maxRounds: 8, maxHistoryTokens: 24_000, maxOutputTokens: 4_096, maxImages: 4 },
  },
  {
    id: 'balanced', label: '均衡', desc: '日常够用',
    icon: IconScaleBalance,
    values: { maxRounds: 20, maxHistoryTokens: 64_000, maxOutputTokens: 8_192, maxImages: 6 },
  },
  {
    id: 'spacious', label: '宽裕', desc: '默认推荐',
    icon: IconChevronTripleUp,
    values: { ...CHAT_SETTINGS_DEFAULTS },
  },
  {
    id: 'extreme', label: '极限', desc: '火力全开',
    icon: IconRocket,
    values: { maxRounds: 100, maxHistoryTokens: 256_000, maxOutputTokens: 81_920, maxImages: 20 },
  },
]

function isPresetActive(p: Preset): boolean {
  return (Object.keys(p.values) as (keyof ChatSettings)[]).every(
    (k) => p.values[k] === draft[k],
  )
}

function applyPreset(p: Preset) {
  Object.assign(draft, p.values)
}

// ============ 字段定义 ============
interface FieldDef {
  key: keyof ChatSettings
  label: string
  desc: string
  icon: typeof IconSync
  tone: string
  step: number
  bounds: [number, number]
}

const fieldDefs: FieldDef[] = [
  {
    key: 'maxRounds', label: 'Agent 循环轮数', desc: '一次提问中模型最多调用几轮工具。增大可处理更复杂的组合任务。',
    icon: IconSync, tone: '#f59e0b', step: 5, bounds: [1, 200],
  },
  {
    key: 'maxHistoryTokens', label: '历史 Token 预算', desc: '对话历史发给模型时的 token 预算。超出时自动截断早期消息。',
    icon: IconDatabaseOutline, tone: '#38bdf8', step: 8_000, bounds: [1_000, 1_000_000],
  },
  {
    key: 'maxOutputTokens', label: '单次输出上限', desc: '模型单次回复的最大输出 token 数。回答轮需较大值，工具调用轮很短。',
    icon: IconMessageText, tone: '#10b981', step: 2_048, bounds: [256, 131_072],
  },
  {
    key: 'maxImages', label: '图片数量上限', desc: '一次最多可发送的图片张数。图片转 base64 随请求发送，过多会显著增加延迟与费用。',
    icon: IconImageMultiple, tone: '#a78bfa', step: 1, bounds: [0, 50],
  },
]

// ============ 格式化 ============
function formatValue(def: FieldDef): string {
  const v = draft[def.key]
  if (def.key === 'maxHistoryTokens' || def.key === 'maxOutputTokens') {
    if (v >= 1_000) return `${(v / 1_000).toFixed(v % 1000 === 0 ? 0 : 1)}K`
    return String(v)
  }
  if (def.key === 'maxRounds') return `${v} 轮`
  return `${v} 张`
}

function scalePercent(def: FieldDef): number {
  const v = draft[def.key]
  const [lo, hi] = def.bounds
  return Math.round(((v - lo) / (hi - lo)) * 100)
}

function scaleColor(def: FieldDef): string {
  const pct = scalePercent(def)
  if (pct < 25) return '#10b981'
  if (pct < 55) return '#38bdf8'
  if (pct < 80) return '#f59e0b'
  return '#ef4444'
}

function isDirty(key: keyof ChatSettings): boolean {
  return draft[key] !== savedSnapshot[key]
}

// ============ 步进 ============
function clamp(def: FieldDef, val: number): number {
  const [lo, hi] = def.bounds
  return Math.max(lo, Math.min(hi, Math.round(val)))
}

function stepDown(def: FieldDef) {
  draft[def.key] = clamp(def, draft[def.key] - def.step)
}
function stepUp(def: FieldDef) {
  draft[def.key] = clamp(def, draft[def.key] + def.step)
}

// ============ 刻度条拖动 ============
const draggingDef = ref<FieldDef | null>(null)
const scaleTrackRefs = ref<Record<string, HTMLElement | null>>({})

function setScaleRef(key: string, el: HTMLElement | null) {
  scaleTrackRefs.value[key] = el
}

function onScaleMouseDown(def: FieldDef, e: MouseEvent) {
  e.preventDefault()
  draggingDef.value = def
  updateFromScaleEvent(def, e)
  window.addEventListener('mousemove', onScaleMouseMove)
  window.addEventListener('mouseup', onScaleMouseUp)
}

function onScaleMouseMove(e: MouseEvent) {
  if (!draggingDef.value) return
  updateFromScaleEvent(draggingDef.value, e)
}

function onScaleMouseUp() {
  draggingDef.value = null
  window.removeEventListener('mousemove', onScaleMouseMove)
  window.removeEventListener('mouseup', onScaleMouseUp)
}

function updateFromScaleEvent(def: FieldDef, e: MouseEvent) {
  const el = scaleTrackRefs.value[def.key]
  if (!el) return
  const rect = el.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const [lo, hi] = def.bounds
  const raw = lo + ratio * (hi - lo)
  // snap to step
  const snapped = Math.round(raw / def.step) * def.step
  draft[def.key] = clamp(def, snapped)
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onScaleMouseMove)
  window.removeEventListener('mouseup', onScaleMouseUp)
  // 防御：组件卸载时确保恢复 body 滚动
  document.body.style.overflow = ''
})

// ============ 是否有修改 ============
const hasChanges = computed(() =>
  (Object.keys(CHAT_SETTINGS_DEFAULTS) as (keyof ChatSettings)[]).some(
    (k) => draft[k] !== savedSnapshot[k],
  ),
)
</script>

<template>
  <Teleport to="body">
    <Transition name="cs-fade">
      <div v-if="open" class="cs-shell" @click.self="close">
        <div class="cs-backdrop" />
        <Transition name="cs-pop" appear>
          <section
            class="cs-console"
            role="dialog"
            aria-modal="true"
            aria-label="对话参数设置"
            @mousedown.stop
            @keydown.stop
          >
            <div class="cs-beam" aria-hidden="true" />
            <div class="cs-beam-2" aria-hidden="true" />

            <!-- ====== Header ====== -->
            <header class="cs-header">
              <div class="cs-brand-mark">
                <IconCog class="w-5 h-5" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="cs-eyebrow">Chat Settings</p>
                <h2 class="cs-title">对话参数</h2>
                <p class="cs-subtitle">Agent 循环 · 上下文窗口 · 输出限制</p>
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
                  默认
                </button>
                <button type="button" class="cs-icon-btn" title="关闭（Esc）" @click="close">
                  <IconClose class="w-4 h-4" />
                </button>
              </div>
            </header>

            <!-- ====== Body ====== -->
            <div class="cs-body">
              <!-- 提示条 -->
              <div class="cs-hint">
                <IconAlert class="w-4 h-4 shrink-0 cs-hint-icon" />
                <span>改动在下次发送消息时生效，无需重启或刷新。拖动刻度条、点击 ± 按钮或直接输入均可调整。</span>
              </div>

              <!-- 预设卡 -->
              <div class="cs-preset-strip">
                <button
                  v-for="p in presets"
                  :key="p.id"
                  type="button"
                  class="cs-preset-chip"
                  :class="{ 'is-active': isPresetActive(p) }"
                  @click="applyPreset(p)"
                >
                  <component :is="p.icon" class="w-4 h-4" />
                  <span class="cs-preset-label">{{ p.label }}</span>
                  <span class="cs-preset-desc">{{ p.desc }}</span>
                </button>
              </div>

              <!-- 参数卡片 -->
              <div class="cs-cards">
                <div
                  v-for="def in fieldDefs"
                  :key="def.key"
                  class="cs-card"
                  :class="{ 'is-dirty': isDirty(def.key) }"
                  :style="{ '--card-tone': def.tone }"
                >
                  <!-- 卡片头部 -->
                  <div class="cs-card-head">
                    <div class="cs-card-icon">
                      <component :is="def.icon" class="w-4 h-4" />
                    </div>
                    <div class="cs-card-title">
                      <span>{{ def.label }}</span>
                      <span v-if="isDirty(def.key)" class="cs-dirty-dot" title="已修改">●</span>
                    </div>
                    <span class="cs-card-value">{{ formatValue(def) }}</span>
                  </div>

                  <!-- 描述 -->
                  <p class="cs-card-desc">{{ def.desc }}</p>

                  <!-- 可拖动刻度条 -->
                  <div
                    class="cs-scale"
                    role="slider"
                    :aria-valuenow="draft[def.key]"
                    :aria-valuemin="def.bounds[0]"
                    :aria-valuemax="def.bounds[1]"
                    :aria-label="def.label"
                  >
                    <div
                      :ref="(el: unknown) => setScaleRef(def.key, el as HTMLElement | null)"
                      class="cs-scale-track"
                      @mousedown="onScaleMouseDown(def, $event)"
                    >
                      <div
                        class="cs-scale-fill"
                        :style="{
                          width: scalePercent(def) + '%',
                          background: scaleColor(def),
                          boxShadow: `0 0 10px ${scaleColor(def)}66`,
                        }"
                      />
                      <div
                        class="cs-scale-thumb"
                        :style="{ left: scalePercent(def) + '%', borderColor: scaleColor(def) }"
                      />
                    </div>
                    <span class="cs-scale-label">{{ scalePercent(def) }}%</span>
                  </div>

                  <!-- 步进器 -->
                  <div class="cs-stepper">
                    <button
                      type="button"
                      class="cs-step-btn cs-step-down"
                      :disabled="draft[def.key] <= def.bounds[0]"
                      @mousedown.prevent="stepDown(def)"
                    >
                      <svg width="12" height="2" viewBox="0 0 12 2"><rect width="12" height="2" rx="1" fill="currentColor"/></svg>
                    </button>
                    <input
                      v-model.number="draft[def.key]"
                      type="number"
                      class="cs-step-input"
                      :min="def.bounds[0]"
                      :max="def.bounds[1]"
                      :step="def.step"
                    />
                    <button
                      type="button"
                      class="cs-step-btn cs-step-up"
                      :disabled="draft[def.key] >= def.bounds[1]"
                      @mousedown.prevent="stepUp(def)"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
                    </button>
                  </div>
                </div>
              </div>

              <!-- 操作栏 -->
              <div class="cs-actions">
                <button type="button" class="cs-btn cs-btn-ghost" @click="close">取消</button>
                <div class="flex-1" />
                <button type="button" class="cs-btn cs-btn-primary" @click="apply">保存配置</button>
              </div>
            </div>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ================================================
   Shell & Backdrop
   ================================================ */
.cs-shell {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.cs-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--cs-tone, #2dd4bf) 22%, transparent), transparent 34%),
    radial-gradient(circle at 86% 80%, rgba(45, 212, 191, 0.12), transparent 32%),
    rgba(2, 6, 23, 0.78);
  backdrop-filter: blur(16px) saturate(140%);
}

/* ================================================
   Console Panel
   ================================================ */
.cs-console {
  --cs-tone: #2dd4bf;
  --cs-border: rgba(148, 163, 184, 0.16);
  --cs-text: rgba(248, 250, 252, 0.9);
  --cs-muted: rgba(226, 232, 240, 0.52);
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(680px, 94vw);
  max-height: min(760px, 88vh);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cs-tone) 20%, rgba(148, 163, 184, 0.24));
  border-radius: 14px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--cs-tone) 8%, transparent), transparent 28%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(2, 6, 23, 0.98));
  box-shadow:
    0 34px 110px rgba(0, 0, 0, 0.66),
    0 0 0 1px rgba(255, 255, 255, 0.035),
    0 0 70px color-mix(in srgb, var(--cs-tone) 12%, transparent);
  color: var(--cs-text);
}
.cs-console::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255,255,255,0.026) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: linear-gradient(135deg, rgba(0,0,0,0.55), transparent 58%);
}
.cs-console::after {
  position: absolute;
  inset: auto 20px 0;
  height: 1px;
  pointer-events: none;
  content: '';
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--cs-tone) 52%, transparent), transparent);
  opacity: 0.75;
}
.cs-beam {
  position: absolute;
  inset: -36% auto auto 8%;
  width: 42%;
  height: 172%;
  transform: rotate(24deg);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--cs-tone) 18%, transparent), transparent);
  opacity: 0.72;
  pointer-events: none;
}
.cs-beam-2 {
  position: absolute;
  inset: auto 4% -28% auto;
  width: 36%;
  height: 140%;
  transform: rotate(-32deg);
  background: linear-gradient(270deg, transparent, color-mix(in srgb, var(--cs-tone) 10%, transparent), transparent);
  opacity: 0.48;
  pointer-events: none;
}

/* ================================================
   Header
   ================================================ */
.cs-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 22px 24px 18px;
  border-bottom: 1px solid var(--cs-border);
  background:
    radial-gradient(circle at 12% 0, color-mix(in srgb, var(--cs-tone) 15%, transparent), transparent 34%),
    rgba(15, 23, 42, 0.36);
}
.cs-brand-mark {
  display: grid;
  width: 46px; height: 46px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--cs-tone) 42%, rgba(255,255,255,0.08));
  border-radius: 12px;
  background:
    radial-gradient(circle at 30% 18%, color-mix(in srgb, var(--cs-tone) 42%, transparent), transparent 45%),
    color-mix(in srgb, var(--cs-tone) 11%, rgba(255,255,255,0.04));
  color: color-mix(in srgb, var(--cs-tone) 82%, white);
  box-shadow: 0 0 26px color-mix(in srgb, var(--cs-tone) 18%, transparent), inset 0 1px 0 rgba(255,255,255,0.1);
}
.cs-eyebrow {
  margin: 0 0 3px;
  color: color-mix(in srgb, var(--cs-tone) 72%, white 8%);
  font: 800 10px/1 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  user-select: none;
}
.cs-title {
  margin: 0;
  color: rgba(248, 250, 252, 0.95);
  font-size: 21px; font-weight: 800;
  letter-spacing: -0.01em;
  user-select: text;
  cursor: text;
}
.cs-subtitle {
  margin: 5px 0 0;
  color: var(--cs-muted);
  font-size: 12px;
  user-select: none;
}
.cs-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 9px;
}
.cs-header-btn,
.cs-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255,255,255,0.085);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.035));
  color: rgba(226, 232, 240, 0.66);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  user-select: none;
  transition: background 0.18s, color 0.18s, border-color 0.18s;
}
.cs-header-btn {
  gap: 5px;
  min-height: 32px;
  padding: 0 10px;
  font-size: 11px; font-weight: 800;
}
.cs-icon-btn {
  width: 32px; height: 32px;
}
.cs-header-btn:hover:not(:disabled),
.cs-header-btn:focus-visible:not(:disabled),
.cs-icon-btn:hover,
.cs-icon-btn:focus-visible {
  color: white;
  border-color: color-mix(in srgb, var(--cs-tone) 30%, transparent);
  background: color-mix(in srgb, var(--cs-tone) 9%, rgba(255,255,255,0.07));
  outline: 0;
}
.cs-header-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

/* ================================================
   Body
   ================================================ */
.cs-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}
.cs-body * {
  user-select: none;
}

/* ================================================
   Hint banner
   ================================================ */
.cs-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 11px 14px;
  border: 1px solid rgba(251, 191, 36, 0.16);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(251, 191, 36, 0.07), rgba(251, 191, 36, 0.02));
  color: rgba(226, 232, 240, 0.62);
  font-size: 12px;
  line-height: 1.6;
}
.cs-hint-icon { color: #fbbf24; }

/* ================================================
   Preset Strip
   ================================================ */
.cs-preset-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.cs-preset-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 8px 12px;
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015));
  color: rgba(226, 232, 240, 0.55);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  user-select: none;
  transition: all 0.2s ease;
}
.cs-preset-chip:hover {
  border-color: rgba(255,255,255,0.14);
  background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03));
  color: rgba(248, 250, 252, 0.75);
  transform: translateY(-1px);
}
.cs-preset-chip.is-active {
  border-color: color-mix(in srgb, var(--cs-tone) 44%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--cs-tone) 16%, transparent), color-mix(in srgb, var(--cs-tone) 7%, transparent));
  color: color-mix(in srgb, var(--cs-tone) 85%, white);
  box-shadow:
    0 0 18px color-mix(in srgb, var(--cs-tone) 14%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.08);
}
.cs-preset-chip svg { opacity: 0.85; }
.cs-preset-chip.is-active svg { opacity: 1; }
.cs-preset-label {
  font-size: 13px;
  font-weight: 800;
}
.cs-preset-desc {
  font-size: 10px;
  opacity: 0.6;
  font-weight: 600;
}

/* ================================================
   Card Grid
   ================================================ */
.cs-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

/* ================================================
   Single Card
   ================================================ */
.cs-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border: 1px solid rgba(255,255,255,0.065);
  border-radius: 13px;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
}
.cs-card::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 13px;
  padding: 1px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--card-tone, #38bdf8) 38%, transparent), transparent 50%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}
.cs-card.is-dirty::before { opacity: 1; }
.cs-card.is-dirty {
  border-color: color-mix(in srgb, var(--card-tone, #38bdf8) 16%, rgba(255,255,255,0.04));
  box-shadow: 0 0 24px color-mix(in srgb, var(--card-tone, #38bdf8) 8%, transparent);
}

/* card head */
.cs-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cs-card-icon {
  display: grid;
  width: 34px; height: 34px;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--card-tone, #38bdf8) 14%, rgba(255,255,255,0.05));
  color: color-mix(in srgb, var(--card-tone, #38bdf8) 82%, white);
  flex-shrink: 0;
}
.cs-card-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 800;
  color: rgba(226, 232, 240, 0.78);
}
.cs-dirty-dot {
  font-size: 8px;
  color: var(--card-tone);
  animation: cs-pulse 2s ease-in-out infinite;
}
@keyframes cs-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.cs-card-value {
  font: 850 14px/1 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: rgba(248, 250, 252, 0.92);
  white-space: nowrap;
}
.cs-card-desc {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: rgba(226, 232, 240, 0.38);
}

/* ================================================
   Scale bar (draggable)
   ================================================ */
.cs-scale {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cs-scale-track {
  flex: 1;
  height: 18px;
  display: flex;
  align-items: center;
  cursor: ew-resize;
  position: relative;
  border-radius: 999px;
  /* invisible hit area is the full 18px; visible bar is the inner 4px */
}
.cs-scale-track::before {
  content: '';
  position: absolute;
  inset: 7px 0;
  border-radius: 999px;
  background: rgba(255,255,255,0.06);
}
.cs-scale-fill {
  position: absolute;
  inset: 7px 0;
  border-radius: 999px;
  transition: width 0.15s ease, background 0.15s ease;
}
.cs-scale-thumb {
  position: absolute;
  top: 1px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #0f172a;
  border: 2px solid;
  transform: translateX(-50%);
  box-shadow: 0 0 6px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.4);
  transition: left 0.15s ease, border-color 0.15s ease;
  pointer-events: none;
}
.cs-scale-label {
  font: 650 10px/1 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: rgba(226, 232, 240, 0.35);
  min-width: 28px;
  text-align: right;
}

/* ================================================
   Stepper
   ================================================ */
.cs-stepper {
  display: flex;
  align-items: stretch;
  height: 36px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.55), rgba(2, 6, 23, 0.42));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
  transition: border-color 0.18s;
}
.cs-stepper:focus-within {
  border-color: color-mix(in srgb, var(--card-tone, var(--cs-tone)) 46%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--card-tone, var(--cs-tone)) 12%, transparent);
}
.cs-step-btn {
  display: grid;
  place-items: center;
  width: 34px;
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: rgba(226, 232, 240, 0.5);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  user-select: none;
  transition: background 0.15s, color 0.15s;
}
.cs-step-btn:hover:not(:disabled) {
  background: rgba(255,255,255,0.06);
  color: white;
}
.cs-step-btn:active:not(:disabled) {
  background: rgba(255,255,255,0.1);
}
.cs-step-btn:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}
.cs-step-input {
  flex: 1;
  min-width: 0;
  border: 0;
  border-left: 1px solid rgba(148, 163, 184, 0.12);
  border-right: 1px solid rgba(148, 163, 184, 0.12);
  background: transparent;
  color: rgba(248, 250, 252, 0.92);
  text-align: center;
  font: 650 13px/1 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  outline: none;
  user-select: text;
  -moz-appearance: textfield;
  appearance: textfield;
}
.cs-step-input::-webkit-outer-spin-button,
.cs-step-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* ================================================
   Action bar
   ================================================ */
.cs-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 6px;
  border-top: 1px solid rgba(148, 163, 184, 0.08);
}
.cs-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  font-size: 12px; font-weight: 800;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  user-select: none;
  transition: background 0.18s, color 0.18s, border-color 0.18s, box-shadow 0.18s;
}
.cs-btn-ghost {
  border: 1px solid rgba(255,255,255,0.085);
  background: linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.035));
  color: rgba(226, 232, 240, 0.6);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055);
}
.cs-btn-ghost:hover,
.cs-btn-ghost:focus-visible {
  color: white;
  border-color: color-mix(in srgb, var(--cs-tone) 30%, transparent);
  background: color-mix(in srgb, var(--cs-tone) 9%, rgba(255,255,255,0.07));
  outline: 0;
}
.cs-btn-primary {
  border: 1px solid color-mix(in srgb, var(--cs-tone) 38%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--cs-tone) 22%, transparent), color-mix(in srgb, var(--cs-tone) 12%, transparent));
  color: color-mix(in srgb, var(--cs-tone) 88%, white);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.09),
    0 0 14px color-mix(in srgb, var(--cs-tone) 10%, transparent);
}
.cs-btn-primary:hover,
.cs-btn-primary:focus-visible {
  background: linear-gradient(180deg, color-mix(in srgb, var(--cs-tone) 34%, transparent), color-mix(in srgb, var(--cs-tone) 20%, transparent));
  color: white;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.12),
    0 0 22px color-mix(in srgb, var(--cs-tone) 18%, transparent);
  outline: 0;
}

/* ================================================
   Transitions
   ================================================ */
.cs-fade-enter-active,
.cs-fade-leave-active { transition: opacity 0.18s ease; }
.cs-fade-enter-from,
.cs-fade-leave-to { opacity: 0; }
.cs-pop-enter-active,
.cs-pop-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.cs-pop-enter-from,
.cs-pop-leave-to { opacity: 0; transform: translateY(10px) scale(0.985); }

/* reduced motion */
@media (prefers-reduced-motion: reduce) {
  .cs-dirty-dot { animation: none; }
  .cs-scale-fill,
  .cs-scale-thumb { transition: none; }
}

/* ================================================
   Responsive
   ================================================ */
@media (max-width: 720px) {
  .cs-cards { grid-template-columns: 1fr; }
  .cs-preset-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .cs-shell { padding: 10px; }
  .cs-console { width: 100%; max-height: 94vh; border-radius: 12px; }
  .cs-header { padding: 16px; flex-wrap: wrap; }
  .cs-header-actions { width: 100%; justify-content: flex-end; }
  .cs-body { padding: 16px; gap: 16px; }
  .cs-preset-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cs-cards { grid-template-columns: 1fr; }
}
</style>
