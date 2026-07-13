<script setup lang="ts">
/**
 * 状态栏 · 模型选择器
 *
 * 显示当前使用的 LLM 模型名，位于 GitWidget 右侧。
 * 两种状态：
 *   - 未配置：显示「未配置」+ 红色文字，引导用户点击配置
 *   - 已配置：显示 Provider 名 + 模型名 + 连通性色点（绿/琥珀）
 *
 * Hover 展开快速切换列表，点击打开完整配置面板。
 */
import { ref, computed, onUnmounted } from 'vue'
import {
  providers,
  activeProvider,
  activeModel,
  configured,
  hasUiConfig,
  setActiveModel,
} from '@/features/model-config'
import { useConnectivity } from '@/features/chat/connectivity'
import { openModelConfigModal } from '@/features/chat/model-modal-bridge'
import IconRobot from '~icons/mdi/robot-happy-outline'
import IconCheck from '~icons/mdi/check'
import IconChevronDown from '~icons/mdi/chevron-down'
import IconCog from '~icons/mdi/cog-outline'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconMagnify from '~icons/mdi/magnify'
import IconClose from '~icons/mdi/close'

const { status: connectivityStatus, message: connectivityMsg } = useConnectivity()

const switchedKey = ref('')
const switchNotice = ref('')
let switchTimer: number | null = null

// 连通性色点：仅已配置才显示
const dotState = computed<'ok' | 'warn' | 'down' | 'none'>(() => {
  if (!configured.value) return 'none'
  if (!activeModelConfirmed.value) return 'warn'
  return connectivityStatus.value === 'unreachable' ? 'down' : 'ok'
})

const activeModelConfirmed = computed(() => {
  const provider = activeProvider.value
  if (!provider) return false
  return provider.models.some((model) => model.id === provider.activeModelId && model.available)
})

// 显示文本
const widgetTitle = computed(() => {
  if (!hasUiConfig.value) return '点击配置 LLM 模型以启用小吴助手'
  if (!configured.value) return `${activeProvider.value?.name ?? ''} ${activeModel.value}｜缺少 API Key，点击配置`
  if (!activeModelConfirmed.value) return `${activeProvider.value?.name ?? ''} ${activeModel.value}｜模型尚未验证`
  if (dotState.value === 'down') return `${activeProvider.value?.name ?? ''} ${activeModel.value}｜${connectivityMsg.value || '暂时连不上'}`
  return `${activeProvider.value?.name ?? ''} ${activeModel.value}｜连接正常，点击管理模型`
})

// hover 下拉模型列表
interface FlatModelEntry {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  isActive: boolean
  lastSeenAt?: number
}
const confirmedModels = computed<FlatModelEntry[]>(() => {
  const entries: FlatModelEntry[] = []
  for (const p of providers.value) {
    for (const m of p.models.filter((model) => model.available)) {
      entries.push({
        providerId: p.id,
        providerName: p.name,
        modelId: m.id,
        modelName: m.name,
        isActive: p.id === activeProvider.value?.id && m.id === p.activeModelId,
        lastSeenAt: m.lastSeenAt,
      })
    }
  }
  return entries
})

// ── 多模型场景：搜索 + 按 Provider 分组（>10 个已确认模型时启用，否则保持原平铺）──
const richMode = computed(() => confirmedModels.value.length > 10)

interface ModelGroup {
  providerId: string
  providerName: string
  models: FlatModelEntry[]
}
const groupedModels = computed<ModelGroup[]>(() => {
  const map = new Map<string, ModelGroup>()
  for (const entry of confirmedModels.value) {
    let g = map.get(entry.providerId)
    if (!g) {
      g = { providerId: entry.providerId, providerName: entry.providerName, models: [] }
      map.set(entry.providerId, g)
    }
    g.models.push(entry)
  }
  const groups = [...map.values()]
  for (const g of groups) {
    // 当前模型置顶，确保大列表里始终可见
    g.models.sort((a, b) => Number(b.isActive) - Number(a.isActive))
  }
  return groups
})

// 默认展开当前 Provider（或第一个类别），其余折叠
const defaultOpenId = computed(() => {
  const activeId = activeProvider.value?.id
  if (activeId && groupedModels.value.some((g) => g.providerId === activeId)) return activeId
  return groupedModels.value[0]?.providerId
})
const groupOpenOverride = ref<Record<string, boolean>>({})
function isGroupOpen(providerId: string): boolean {
  if (providerId in groupOpenOverride.value) return groupOpenOverride.value[providerId]
  return providerId === defaultOpenId.value
}
function toggleGroup(providerId: string): void {
  groupOpenOverride.value = { ...groupOpenOverride.value, [providerId]: !isGroupOpen(providerId) }
}

const search = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const searching = computed(() => search.value.trim().length > 0)
const filteredModels = computed<FlatModelEntry[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return []
  return confirmedModels.value.filter(
    (e) => e.modelName.toLowerCase().includes(q) || e.providerName.toLowerCase().includes(q),
  )
})

// hover 菜单关闭时清空搜索与手动展开态，下次打开回到默认视图
function onMenuClose(): void {
  if (search.value) search.value = ''
  groupOpenOverride.value = {}
  searchInput.value?.blur()
}

// 清空搜索并把焦点还给输入框（清除按钮点击后自身卸载，避免焦点落到 body）
function clearSearch(): void {
  search.value = ''
  searchInput.value?.focus()
}

function switchModel(entry: FlatModelEntry) {
  const key = `${entry.providerId}:${entry.modelId}`
  if (entry.isActive && switchedKey.value === key) return
  setActiveModel(entry.providerId, entry.modelId)
  switchedKey.value = key
  switchNotice.value = `已切换到 ${entry.modelName}`
  if (switchTimer) clearTimeout(switchTimer)
  switchTimer = window.setTimeout(() => {
    switchedKey.value = ''
    switchNotice.value = ''
    switchTimer = null
  }, 1800)
}

function openConfig() {
  openModelConfigModal()
}

onUnmounted(() => {
  if (switchTimer) clearTimeout(switchTimer)
})
</script>

<template>
  <div class="model-widget-wrapper" @mouseleave="onMenuClose">
    <button
      class="model-widget"
      :class="{ 'is-unconfigured': !configured, 'is-switched': !!switchNotice }"
      :title="widgetTitle"
      :aria-label="widgetTitle"
      @click="openConfig"
    >
      <span class="model-icon" :class="{ 'is-unconfigured': !configured }">
        <IconRobot class="w-3.5 h-3.5" />
        <span v-if="!hasUiConfig" class="model-dot-none">
          <IconAlert class="w-2.5 h-2.5" />
        </span>
        <span
          v-else-if="dotState !== 'none'"
          class="model-dot"
          :class="{
            'bg-emerald-400': dotState === 'ok',
            'bg-amber-400': dotState === 'warn' || dotState === 'down',
            'is-down': dotState === 'down',
          }"
        />
      </span>

      <template v-if="!hasUiConfig">
        <span class="model-name text-rose-300/80">未配置</span>
      </template>
      <template v-else>
        <span class="model-provider-label">{{ activeProvider?.name }}</span>
        <span class="model-name">{{ activeModel || '—' }}</span>
      </template>

      <IconChevronDown class="model-chevron w-3 h-3" />
    </button>

    <!-- Hover 下拉 -->
    <div class="model-menu">
      <div class="model-menu-card" role="menu">
        <Transition name="model-switch-notice">
          <div v-if="switchNotice" class="model-switch-notice" role="status">
            <IconCheck class="w-3.5 h-3.5" />
            <span>{{ switchNotice }}</span>
          </div>
        </Transition>

        <template v-if="confirmedModels.length > 0">
          <div v-if="richMode" class="mm-search">
            <IconMagnify class="w-3.5 h-3.5" />
            <input
              ref="searchInput"
              v-model="search"
              type="text"
              placeholder="搜索模型…"
              spellcheck="false"
            />
            <button
              v-if="searching"
              type="button"
              class="mm-search-clear"
              title="清除"
              tabindex="-1"
              @click.stop="clearSearch"
            >
              <IconClose class="w-3 h-3" />
            </button>
          </div>

          <div class="model-menu-scroll">
            <!-- 简单模式：模型不多时保持原平铺 -->
            <template v-if="!richMode">
              <div class="model-menu-section-label">已确认可用模型</div>
              <button
                v-for="entry in confirmedModels"
                :key="`${entry.providerId}:${entry.modelId}`"
                type="button"
                class="model-menu-item"
                :class="{
                  'is-active': entry.isActive,
                  'is-switching': switchedKey === `${entry.providerId}:${entry.modelId}`,
                }"
                role="menuitem"
                :title="`${entry.providerName} · ${entry.modelName}`"
                @click.stop="switchModel(entry)"
              >
                <span class="model-menu-provider">{{ entry.providerName }}</span>
                <span class="model-menu-model">{{ entry.modelName }}</span>
                <IconCheck v-if="entry.isActive" class="model-menu-check w-3.5 h-3.5" />
              </button>
            </template>

            <!-- 搜索结果：跨类别平铺匹配项 -->
            <template v-else-if="searching">
              <div class="model-menu-section-label">
                {{ filteredModels.length ? `${filteredModels.length} 个匹配` : '搜索模型' }}
              </div>
              <button
                v-for="entry in filteredModels"
                :key="`${entry.providerId}:${entry.modelId}`"
                type="button"
                class="model-menu-item"
                :class="{
                  'is-active': entry.isActive,
                  'is-switching': switchedKey === `${entry.providerId}:${entry.modelId}`,
                }"
                role="menuitem"
                :title="`${entry.providerName} · ${entry.modelName}`"
                @click.stop="switchModel(entry)"
              >
                <span class="model-menu-provider">{{ entry.providerName }}</span>
                <span class="model-menu-model">{{ entry.modelName }}</span>
                <IconCheck v-if="entry.isActive" class="model-menu-check w-3.5 h-3.5" />
              </button>
              <div v-if="filteredModels.length === 0" class="model-menu-empty">没有匹配的模型</div>
            </template>

            <!-- 多模型浏览：按类别分组（仅一个类别时省略分组头） -->
            <template v-else>
              <template v-if="groupedModels.length > 1">
                <div
                  v-for="group in groupedModels"
                  :key="group.providerId"
                  class="mm-group"
                  :class="{ 'is-open': isGroupOpen(group.providerId) }"
                >
                  <button
                    type="button"
                    class="mm-group-head"
                    role="menuitem"
                    :aria-expanded="isGroupOpen(group.providerId)"
                    @click.stop="toggleGroup(group.providerId)"
                  >
                    <IconChevronDown class="mm-group-chev w-3 h-3" />
                    <span class="mm-group-name">{{ group.providerName }}</span>
                    <span class="mm-group-count">{{ group.models.length }}</span>
                  </button>
                  <div v-show="isGroupOpen(group.providerId)" class="mm-group-body">
                    <button
                      v-for="entry in group.models"
                      :key="`${entry.providerId}:${entry.modelId}`"
                      type="button"
                      class="model-menu-item"
                      :class="{
                        'is-active': entry.isActive,
                        'is-switching': switchedKey === `${entry.providerId}:${entry.modelId}`,
                      }"
                      role="menuitem"
                      :title="`${entry.providerName} · ${entry.modelName}`"
                      @click.stop="switchModel(entry)"
                    >
                      <span class="model-menu-model">{{ entry.modelName }}</span>
                      <IconCheck v-if="entry.isActive" class="model-menu-check w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </template>
              <template v-else>
                <button
                  v-for="entry in groupedModels[0].models"
                  :key="`${entry.providerId}:${entry.modelId}`"
                  type="button"
                  class="model-menu-item"
                  :class="{
                    'is-active': entry.isActive,
                    'is-switching': switchedKey === `${entry.providerId}:${entry.modelId}`,
                  }"
                  role="menuitem"
                  :title="`${entry.providerName} · ${entry.modelName}`"
                  @click.stop="switchModel(entry)"
                >
                  <span class="model-menu-provider">{{ entry.providerName }}</span>
                  <span class="model-menu-model">{{ entry.modelName }}</span>
                  <IconCheck v-if="entry.isActive" class="model-menu-check w-3.5 h-3.5" />
                </button>
              </template>
            </template>
          </div>
        </template>
        <div v-else class="model-menu-empty">暂无已确认可用模型</div>

        <div class="model-menu-sep" />

        <!-- 状态提示 -->
        <div v-if="!configured && hasUiConfig" class="model-menu-hint">
          缺少有效的 API Key，请在配置面板中填写。
        </div>
        <div v-else-if="configured && !activeModelConfirmed" class="model-menu-hint">
          当前模型尚未验证。请在配置面板测试连接或获取可用模型。
        </div>

        <button type="button" class="model-menu-config" role="menuitem" @click.stop="openConfig">
          <IconCog class="w-3.5 h-3.5" />
          <span>管理模型…</span>
        </button>
      </div>
    </div>

  </div>
</template>

<style scoped>
.model-widget-wrapper {
  position: relative;
  display: flex;
  align-items: stretch;
  align-self: stretch;
}

.model-widget {
  display: inline-flex;
  align-items: center;
  max-width: min(26vw, 260px);
  min-width: 0;
  gap: 4px;
  padding: 4px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0;
  color: rgba(224, 242, 254, 0.82);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  appearance: none;
  -webkit-appearance: none;
  overflow: hidden;
}
.model-widget:hover {
  background: rgba(139, 92, 246, 0.1);
  color: #fff;
}
.model-widget.is-switched {
  color: #e9d5ff;
  background: rgba(139, 92, 246, 0.13);
  animation: model-widget-confirm 0.72s ease-out;
}
@keyframes model-widget-confirm {
  0% {
    box-shadow: 0 0 0 rgba(167, 139, 250, 0);
  }
  34% {
    box-shadow: 0 0 18px rgba(167, 139, 250, 0.28);
  }
  100% {
    box-shadow: 0 0 0 rgba(167, 139, 250, 0);
  }
}
.model-widget:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.55);
  outline-offset: 2px;
}
.model-widget.is-unconfigured {
  color: #fecdd3;
}
.model-widget.is-unconfigured:hover {
  background: rgba(244, 63, 94, 0.1);
}

.model-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  color: rgba(139, 92, 246, 0.8);
  flex-shrink: 0;
}
.is-unconfigured .model-icon { color: rgba(244, 63, 94, 0.7); }

.model-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  box-shadow: 0 0 4px currentColor;
}
.model-dot.is-down { animation: model-dot-pulse 1.2s ease-in-out infinite; }
.model-dot-none {
  position: absolute;
  right: -4px;
  bottom: -4px;
  color: rgba(244, 63, 94, 0.85);
}
@keyframes model-dot-pulse { 50% { opacity: 0.4; } }

.model-provider-label {
  font-weight: 600;
  font-size: 11px;
  color: rgba(196, 181, 253, 0.68);
}
.model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font: inherit;
  letter-spacing: inherit;
  font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 11px;
}
.model-chevron { flex-shrink: 0; opacity: 0.5; transition: opacity 0.15s; }
.model-widget:hover .model-chevron { opacity: 1; }

/* ── Hover 下拉 ── */
.model-menu {
  position: absolute; top: 100%; right: 0;
  padding-top: 6px;
  opacity: 0; pointer-events: none;
  transition: opacity 0.15s;
  z-index: 50; min-width: 260px; max-width: min(380px, 92vw);
}
.model-widget-wrapper:hover .model-menu { opacity: 1; pointer-events: auto; }

.model-menu-card {
  position: relative;
  display: flex; flex-direction: column;
  max-height: min(70vh, 460px, 100vh - 64px);
  padding: 6px; border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(2, 6, 23, 0.82)),
    rgba(2, 6, 23, 0.82);
  border: 1px solid rgba(139, 92, 246, 0.24);
  box-shadow:
    0 18px 46px rgba(0, 0, 0, 0.42),
    0 0 28px rgba(139, 92, 246, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  overflow: hidden;
}
.model-menu-card::before {
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  content: '';
  background: linear-gradient(90deg, rgba(167, 139, 250, 0.58), rgba(125, 211, 252, 0.34), transparent);
}

.model-menu-section-label {
  padding: 6px 10px 4px;
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.3);
}

.model-switch-notice {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 2px 2px 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(139, 92, 246, 0.2), rgba(14, 165, 233, 0.1)),
    rgba(255, 255, 255, 0.045);
  color: rgba(237, 233, 254, 0.94);
  font-size: 12px;
  line-height: 1;
  box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.16);
}
.model-switch-notice-enter-active,
.model-switch-notice-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease, max-height 0.18s ease, margin 0.18s ease;
  max-height: 34px;
}
.model-switch-notice-enter-from,
.model-switch-notice-leave-to {
  max-height: 0;
  margin-top: 0;
  margin-bottom: 0;
  opacity: 0;
  transform: translateY(-4px);
}

.model-menu-item {
  position: relative;
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 8px; border: 0;
  background: transparent; font-size: 12px; line-height: 1;
  color: rgba(255, 255, 255, 0.7); cursor: pointer;
  transition: color 0.15s, background-color 0.15s, transform 0.15s;
  text-align: left; appearance: none; -webkit-appearance: none; white-space: nowrap;
  overflow: hidden;
}
.model-menu-item:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
.model-menu-item.is-active { color: #c084fc; background: rgba(139, 92, 246, 0.1); }
.model-menu-item.is-switching {
  color: #f5f3ff;
  background: rgba(139, 92, 246, 0.16);
  transform: translateX(2px);
  animation: model-row-confirm 0.78s ease-out;
}
.model-menu-item.is-switching::before {
  position: absolute;
  inset: 0;
  content: '';
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.14), transparent);
  transform: translateX(-100%);
  animation: model-row-light 0.72s ease-out;
}
@keyframes model-row-confirm {
  0% {
    box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0);
  }
  40% {
    box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.32);
  }
  100% {
    box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0);
  }
}
@keyframes model-row-light {
  to {
    transform: translateX(100%);
  }
}
.model-menu-provider { font-weight: 600; color: rgba(139, 92, 246, 0.85); flex-shrink: 0; }
.model-menu-model { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11px; color: rgba(255, 255, 255, 0.6); }
.model-menu-check { flex-shrink: 0; color: #a78bfa; }

.model-menu-empty { padding: 12px 10px; font-size: 12px; color: rgba(255, 255, 255, 0.35); text-align: center; }
.model-menu-sep { height: 1px; margin: 4px; background: rgba(255, 255, 255, 0.08); }
.model-menu-hint { padding: 6px 10px; font-size: 11px; line-height: 1.5; color: rgba(251, 191, 36, 0.65); }

.model-menu-config {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 10px; border-radius: 8px; border: 0;
  background: transparent; font-size: 12px; line-height: 1;
  color: rgba(255, 255, 255, 0.55); cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
  text-align: left; appearance: none; -webkit-appearance: none; white-space: nowrap;
}
.model-menu-config:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }

/* ── 多模型：内部滚动 + 搜索 + 分组 ── */
.model-menu-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
}
.model-menu-scroll::-webkit-scrollbar { width: 6px; }
.model-menu-scroll::-webkit-scrollbar-track { background: transparent; }
.model-menu-scroll::-webkit-scrollbar-thumb {
  background: rgba(139, 92, 246, 0.28);
  border-radius: 999px;
}
.model-menu-scroll::-webkit-scrollbar-thumb:hover { background: rgba(139, 92, 246, 0.5); }

.mm-search {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 2px 2px 6px;
  padding: 0 8px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.4);
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, color 0.15s;
}
.mm-search:focus-within {
  border-color: rgba(139, 92, 246, 0.5);
  background: rgba(139, 92, 246, 0.08);
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.12);
  color: rgba(196, 181, 253, 0.85);
}
.mm-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  outline: none;
  color: rgba(255, 255, 255, 0.92);
  font-size: 12px;
  font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace;
}
.mm-search input::placeholder { color: rgba(255, 255, 255, 0.3); }
.mm-search-clear {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.mm-search-clear:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }

.mm-group { display: flex; flex-direction: column; }
.mm-group + .mm-group { margin-top: 2px; }
.mm-group-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font-size: 11px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  user-select: none;
  transition: color 0.15s, background-color 0.15s;
}
.mm-group-head:hover { color: #fff; background: rgba(255, 255, 255, 0.06); }
.mm-group-chev {
  flex-shrink: 0;
  opacity: 0.5;
  transition: transform 0.18s ease, opacity 0.18s ease;
  transform: rotate(-90deg);
}
.mm-group.is-open .mm-group-chev { transform: rotate(0deg); opacity: 0.85; }
.mm-group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.02em;
}
.mm-group-count {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.4);
  font-size: 10px;
  font-weight: 700;
}
.mm-group-body {
  display: grid;
  gap: 1px;
  padding: 2px 0 6px;
}
.mm-group-body .model-menu-item { padding-left: 26px; }

@media (max-width: 760px) {
  .model-widget { max-width: 38vw; }
  .model-name { max-width: 16vw; }
  .model-provider-label { display: none; }
  .model-menu { min-width: 220px; max-width: 92vw; }
}
@media (prefers-reduced-motion: reduce) {
  .model-dot.is-down { animation: none; }
  .model-widget.is-switched,
  .model-menu-item.is-switching,
  .model-menu-item.is-switching::before {
    animation: none;
  }
  .mm-group-chev { transition: none; }
  .model-switch-notice-enter-active,
  .model-switch-notice-leave-active {
    transition: none;
  }
}
</style>
