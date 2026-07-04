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
import { ref, computed } from 'vue'
import {
  providers,
  activeProvider,
  activeModel,
  configured,
  hasUiConfig,
  setActiveModel,
} from '@/features/model-config'
import { useConnectivity } from '@/features/chat/connectivity'
import ModelConfigModal from './ModelConfigModal.vue'
import IconRobot from '~icons/mdi/robot-happy-outline'
import IconCheck from '~icons/mdi/check'
import IconChevronDown from '~icons/mdi/chevron-down'
import IconCog from '~icons/mdi/cog-outline'
import IconAlert from '~icons/mdi/alert-circle-outline'

const { status: connectivityStatus, message: connectivityMsg } = useConnectivity()

const configOpen = ref(false)

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

function switchModel(entry: FlatModelEntry) {
  setActiveModel(entry.providerId, entry.modelId)
}

function openConfig() {
  configOpen.value = true
}
</script>

<template>
  <div class="model-widget-wrapper">
    <button
      class="model-widget"
      :class="{ 'is-unconfigured': !configured }"
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
        <template v-if="confirmedModels.length > 0">
          <div class="model-menu-section-label">已确认可用模型</div>
          <button
            v-for="entry in confirmedModels"
            :key="`${entry.providerId}:${entry.modelId}`"
            type="button"
            class="model-menu-item"
            :class="{ 'is-active': entry.isActive }"
            role="menuitem"
            @click.stop="switchModel(entry)"
          >
            <span class="model-menu-provider">{{ entry.providerName }}</span>
            <span class="model-menu-model">{{ entry.modelName }}</span>
            <IconCheck v-if="entry.isActive" class="model-menu-check w-3.5 h-3.5" />
          </button>
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

    <ModelConfigModal v-model:open="configOpen" />
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
  gap: 3px;
  padding: 4px 7px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.02em;
  color: rgba(224, 242, 254, 0.86);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s, box-shadow 0.15s;
  appearance: none;
  -webkit-appearance: none;
  overflow: hidden;
}
.model-widget:hover {
  background: rgba(139, 92, 246, 0.12);
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.22);
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
  opacity: 0.7;
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
  z-index: 50; min-width: 220px;
}
.model-widget-wrapper:hover .model-menu { opacity: 1; pointer-events: auto; }

.model-menu-card {
  display: flex; flex-direction: column;
  padding: 6px; border-radius: 14px;
  background: rgba(2, 6, 23, 0.82);
  border: 1px solid rgba(139, 92, 246, 0.2);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.36), 0 0 28px rgba(139, 92, 246, 0.12);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
}

.model-menu-section-label {
  padding: 6px 10px 4px;
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.3);
}

.model-menu-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 9px; border: 0;
  background: transparent; font-size: 12px; line-height: 1;
  color: rgba(255, 255, 255, 0.7); cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
  text-align: left; appearance: none; -webkit-appearance: none; white-space: nowrap;
}
.model-menu-item:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
.model-menu-item.is-active { color: #c084fc; background: rgba(139, 92, 246, 0.1); }
.model-menu-provider { font-weight: 600; color: rgba(139, 92, 246, 0.85); flex-shrink: 0; }
.model-menu-model { flex: 1; font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11px; color: rgba(255, 255, 255, 0.6); }
.model-menu-check { flex-shrink: 0; color: #a78bfa; }

.model-menu-empty { padding: 12px 10px; font-size: 12px; color: rgba(255, 255, 255, 0.35); text-align: center; }
.model-menu-sep { height: 1px; margin: 4px; background: rgba(255, 255, 255, 0.08); }
.model-menu-hint { padding: 6px 10px; font-size: 11px; line-height: 1.5; color: rgba(251, 191, 36, 0.65); }

.model-menu-config {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 10px; border-radius: 9px; border: 0;
  background: transparent; font-size: 12px; line-height: 1;
  color: rgba(255, 255, 255, 0.55); cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
  text-align: left; appearance: none; -webkit-appearance: none; white-space: nowrap;
}
.model-menu-config:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }

@media (max-width: 760px) {
  .model-widget { max-width: 38vw; }
  .model-name { max-width: 16vw; }
  .model-provider-label { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .model-dot.is-down { animation: none; }
}
</style>
