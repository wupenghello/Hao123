<script setup lang="ts">
/**
 * 大模型设置 · 路由台
 *
 * 产品思路：把「填 Key 的表单」升级成「为小吴选择一条模型线路」。
 * - 左侧是线路和状态，负责快速切换；
 * - 右侧是当前线路的 Key / Base URL / 模型编排；
 * - 顶部预设卡降低新建成本；
 * - 连接测试走统一代理，结果回写到 provider 状态。
 */
import { toRef } from 'vue'
import {
  maskApiKey,
  providerHealthLabel,
  formatLastTest,
  formatLastModelSync,
  useModelConfigModal,
} from '@/features/model-config'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCheck from '~icons/mdi/check'
import IconClose from '~icons/mdi/close'
import IconContentCopy from '~icons/mdi/content-copy'
import IconDelete from '~icons/mdi/delete-outline'
import IconDownload from '~icons/mdi/download'
import IconEye from '~icons/mdi/eye-outline'
import IconEyeOff from '~icons/mdi/eye-off-outline'
import IconLoading from '~icons/mdi/loading'
import IconPlus from '~icons/mdi/plus'
import IconRefresh from '~icons/mdi/refresh'
import IconRobot from '~icons/mdi/robot-happy-outline'
import IconRoute from '~icons/mdi/routes'
import IconSignal from '~icons/mdi/access-point'
import IconStar from '~icons/mdi/star'
import IconTestTube from '~icons/mdi/test-tube'
import IconTune from '~icons/mdi/tune-variant'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

function close() {
  emit('update:open', false)
}

const {
  activeProvider,
  canSaveDraft,
  configured,
  discovering,
  discoveryResult,
  draft,
  draftDirty,
  editableProvider,
  editingModelId,
  editingModelName,
  importError,
  importText,
  isCreating,
  modelSyncCopy,
  newModelName,
  providers,
  readiness,
  selectedModelName,
  selectedProvider,
  selectedProviderTone,
  showImport,
  showKey,
  sortedPresets,
  statusCopy,
  testing,
  testResult,
  addModelToSelected,
  clearProviders,
  confirmRenameModel,
  createCustomProvider,
  createFromPreset,
  deleteProvider,
  handleExport,
  handleImport,
  removeModelFromSelected,
  saveDraft,
  selectModel,
  selectProvider,
  startRenameModel,
  discoverSelectedModels,
  testSelectedProvider,
} = useModelConfigModal(toRef(props, 'open'), close)
</script>

<template>
  <Teleport to="body">
    <Transition name="mm-fade">
      <div v-if="open" class="mm-shell" @click.self="close">
        <div class="mm-backdrop" />
        <Transition name="mm-pop" appear>
          <section class="mm-console" role="dialog" aria-modal="true" aria-label="大模型设置" :style="{ '--mm-tone': selectedProviderTone }">
            <div class="mm-beam" aria-hidden="true" />

            <header class="mm-header">
              <div class="mm-brand-mark">
                <IconTune class="w-5 h-5" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="mm-eyebrow">Model Operations</p>
                <h2 class="mm-title">大模型设置</h2>
                <p class="mm-subtitle">{{ statusCopy }}</p>
              </div>
              <div class="mm-active-pill" :class="{ 'is-ready': configured }">
                <IconSignal class="w-3.5 h-3.5" />
                <span>{{ configured ? '线路就绪' : '等待配置' }}</span>
              </div>
              <button type="button" class="mm-icon-btn" title="关闭" @click="close">
                <IconClose class="w-4 h-4" />
              </button>
            </header>

            <div class="mm-body">
              <aside class="mm-rail">
                <div class="mm-rail-title">
                  <span>已保存线路</span>
                  <button type="button" class="mm-mini-btn" @click="createCustomProvider">
                    <IconPlus class="w-3 h-3" />
                    自定义
                  </button>
                </div>

                <div v-if="providers.length" class="mm-provider-list">
                  <div
                    v-for="provider in providers"
                    :key="provider.id"
                    class="mm-provider-card"
                    :class="{ 'is-active': provider.id === selectedProvider?.id }"
                  >
                    <button type="button" class="mm-provider-select" @click="selectProvider(provider.id)">
                      <span class="mm-provider-led" :class="{ 'is-ok': provider.apiKey && provider.lastTestOk !== false, 'is-bad': provider.lastTestOk === false }" />
                      <span class="min-w-0 flex-1 text-left">
                        <span class="mm-provider-name">{{ provider.name }}</span>
                        <span class="mm-provider-meta">{{ providerHealthLabel(provider) }} · {{ provider.models.filter((model) => model.available).length }}/{{ provider.models.length }} 可用</span>
                      </span>
                      <IconStar v-if="provider.id === activeProvider?.id" class="w-3 h-3 text-[var(--mm-tone)]" />
                    </button>
                    <button type="button" class="mm-provider-delete" title="删除线路" @click="deleteProvider(provider)">
                      <IconDelete class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div v-else class="mm-empty-route">
                  <IconRobot class="w-7 h-7" />
                  <span>还没有线路。先从右侧挑一个 Provider。</span>
                </div>

                <div class="mm-rail-tools">
                  <button type="button" class="mm-ghost-btn" @click="handleExport">
                    <IconContentCopy class="w-3.5 h-3.5" />
                    复制配置
                  </button>
                  <button type="button" class="mm-ghost-btn" @click="showImport = !showImport">
                    <IconDownload class="w-3.5 h-3.5" />
                    导入
                  </button>
                  <button v-if="providers.length" type="button" class="mm-danger-btn" @click="clearProviders">
                    <IconDelete class="w-3.5 h-3.5" />
                    清空线路
                  </button>
                </div>

                <div v-if="showImport" class="mm-import-box">
                  <textarea v-model="importText" rows="4" class="mm-textarea" placeholder="粘贴 hao123-llm-config JSON…" />
                  <div class="flex items-center gap-2">
                    <button type="button" class="mm-primary small" @click="handleImport">导入</button>
                    <button type="button" class="mm-ghost-btn" @click="showImport = false">取消</button>
                  </div>
                  <p v-if="importError" class="mm-error-text">{{ importError }}</p>
                </div>
              </aside>

              <main class="mm-main">
                <section class="mm-health-panel" :class="`is-${readiness.level}`">
                  <div class="mm-health-score">
                    <strong>{{ readiness.score }}</strong>
                    <span>ready</span>
                  </div>
                  <div class="mm-health-copy">
                    <p class="mm-section-label">线路健康</p>
                    <h3>{{ readiness.title }}</h3>
                    <p>{{ readiness.detail }}</p>
                  </div>
                </section>

                <section class="mm-preset-panel" aria-label="Provider 预设">
                  <div class="mm-preset-intro">
                    <span class="mm-preset-kicker">Provider presets</span>
                    <strong>从常用线路开始</strong>
                    <small>选择后会自动填入 Base URL 和推荐模型。</small>
                  </div>
                  <div class="mm-preset-strip">
                    <button
                      v-for="preset in sortedPresets"
                      :key="preset.id"
                      type="button"
                      class="mm-preset-card"
                      :style="{ '--preset-tone': preset.accent }"
                      @click="createFromPreset(preset)"
                    >
                      <span class="mm-preset-orb" aria-hidden="true"></span>
                      <span class="mm-preset-topline">
                        <span class="mm-preset-name">{{ preset.name }}</span>
                        <span class="mm-preset-action">启用</span>
                      </span>
                      <span class="mm-preset-summary">{{ preset.summary }}</span>
                    </button>
                  </div>
                </section>

                <section v-if="editableProvider" class="mm-panel mm-route-panel">
                  <div class="mm-panel-head">
                    <div>
                      <p class="mm-section-label">{{ isCreating ? '未保存线路' : '当前线路' }}</p>
                      <h3>{{ editableProvider.name }}</h3>
                      <p class="mm-route-meta">
                        {{ editableProvider.baseUrl || '等待填写 Base URL' }} ·
                        {{ isCreating ? '尚未保存' : formatLastTest(editableProvider) }} ·
                        {{ isCreating ? '模型未同步' : formatLastModelSync(editableProvider) }}
                      </p>
                    </div>
                    <div class="mm-head-actions">
                      <button type="button" class="mm-primary small" :disabled="!canSaveDraft || (!isCreating && !draftDirty)" @click="saveDraft">
                        <IconCheck class="w-3.5 h-3.5" />
                        {{ isCreating ? '保存线路' : '保存修改' }}
                      </button>
                      <button type="button" class="mm-ghost-btn" :disabled="testing || isCreating || draftDirty || !selectedModelName" @click="testSelectedProvider">
                        <IconLoading v-if="testing" class="w-3.5 h-3.5 mm-spin" />
                        <IconTestTube v-else class="w-3.5 h-3.5" />
                        {{ testing ? '测试中' : '测试连接' }}
                      </button>
                      <button v-if="selectedProvider && !isCreating" type="button" class="mm-danger-btn" @click="deleteProvider(selectedProvider)">
                        <IconDelete class="w-3.5 h-3.5" />
                        删除
                      </button>
                    </div>
                  </div>

                  <div v-if="testResult" class="mm-test-result" :class="{ 'is-ok': testResult.ok }">
                    <IconCheck v-if="testResult.ok" class="w-4 h-4" />
                    <IconAlert v-else class="w-4 h-4" />
                    <span>{{ testResult.message }}</span>
                  </div>

                  <div v-if="discoveryResult" class="mm-test-result" :class="{ 'is-ok': discoveryResult.ok }">
                    <IconCheck v-if="discoveryResult.ok" class="w-4 h-4" />
                    <IconAlert v-else class="w-4 h-4" />
                    <span>{{ discoveryResult.message }}</span>
                  </div>

                  <div class="mm-form-grid">
                    <label class="mm-field">
                      <span>Provider 名称</span>
                      <input v-model="draft.name" class="mm-input mm-name-input" type="text" @keydown.enter.prevent="saveDraft" />
                    </label>
                    <label class="mm-field">
                      <span>Base URL</span>
                      <input v-model="draft.baseUrl" class="mm-input" type="text" @keydown.enter.prevent="saveDraft" />
                    </label>
                    <label class="mm-field mm-field-wide">
                      <span>API Key</span>
                      <div class="mm-secret-input">
                        <input v-model="draft.apiKey" :type="showKey ? 'text' : 'password'" class="mm-input mm-key-input" placeholder="sk-..." @keydown.enter.prevent="saveDraft" />
                        <button type="button" :title="showKey ? '隐藏 Key' : '显示 Key'" @click="showKey = !showKey">
                          <IconEyeOff v-if="showKey" class="w-4 h-4" />
                          <IconEye v-else class="w-4 h-4" />
                        </button>
                      </div>
                      <small>本地工作台会把 Key 存在 localStorage，并只经 dev 代理发送给模型服务。</small>
                    </label>
                  </div>

                  <div class="mm-model-section">
                    <div class="mm-model-head">
                      <div>
                        <p class="mm-section-label">模型编排</p>
                        <p class="mm-muted">{{ modelSyncCopy }}</p>
                      </div>
                      <div class="mm-model-actions">
                        <code>{{ maskApiKey(draft.apiKey) }}</code>
                        <button type="button" class="mm-ghost-btn" :disabled="discovering || isCreating || draftDirty" :title="modelSyncCopy" @click="discoverSelectedModels">
                          <IconLoading v-if="discovering" class="w-3.5 h-3.5 mm-spin" />
                          <IconRefresh v-else class="w-3.5 h-3.5" />
                          {{ discovering ? '获取中' : '获取可用模型' }}
                        </button>
                      </div>
                    </div>

                    <div v-if="editableProvider.models.length" class="mm-model-list">
                      <div v-for="model in editableProvider.models" :key="model.id" class="mm-model-row" :class="{ 'is-active': model.id === editableProvider.activeModelId }">
                        <button v-if="editingModelId !== model.id" type="button" class="mm-model-pick" @click="selectModel(model.id)">
                          <span class="mm-model-radio">
                            <span class="mm-model-dot" />
                          </span>
                          <span class="mm-model-text">
                            <strong>{{ model.name }}</strong>
                            <em v-if="model.role || model.description">{{ model.role || '模型' }} · {{ model.description || '手动添加的模型' }}</em>
                          </span>
                        </button>
                        <input
                          v-else
                          v-model="editingModelName"
                          class="mm-input mm-model-rename"
                          @keydown.enter="confirmRenameModel"
                          @keydown.escape="editingModelId = null"
                          @blur="confirmRenameModel"
                        />
                        <div class="mm-model-row-actions">
                          <span class="mm-model-state" :class="{ 'is-available': model.available }">
                            {{ model.available ? '已确认' : '未验证' }}
                          </span>
                          <button v-if="editingModelId !== model.id" type="button" class="mm-row-link" @click="startRenameModel(model.id, model.name)">重命名</button>
                          <button v-if="editableProvider.models.length > 1" type="button" class="mm-row-link danger" @click="removeModelFromSelected(model.id)">移除</button>
                        </div>
                      </div>
                    </div>
                    <div v-else class="mm-model-empty">
                      <IconRefresh class="w-5 h-5" />
                      <div>
                        <strong>还没有可用模型</strong>
                        <p>保存线路并填写 API Key 后，点击“获取可用模型”；也可以手动添加模型，手动项会一直保留直到你主动移除。</p>
                      </div>
                    </div>

                    <div class="mm-add-model">
                      <input v-model="newModelName" class="mm-input" placeholder="添加自定义模型名，例如 qwen-vl-max" @keydown.enter="addModelToSelected" />
                      <button type="button" class="mm-primary small" @click="addModelToSelected">添加模型</button>
                    </div>
                  </div>
                </section>

                <section v-else class="mm-panel mm-start-panel">
                  <IconRoute class="w-10 h-10" />
                  <h3>先选择一条线路</h3>
                  <p>从上方 Provider 预设开始，或在左侧新建一条自定义线路。</p>
                </section>
              </main>
            </div>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mm-shell {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.mm-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--mm-tone, #38bdf8) 22%, transparent), transparent 34%),
    radial-gradient(circle at 86% 80%, rgba(167, 139, 250, 0.16), transparent 32%),
    rgba(2, 6, 23, 0.78);
  backdrop-filter: blur(16px) saturate(140%);
}
.mm-console {
  --mm-tone: #38bdf8;
  --mm-panel: rgba(6, 13, 28, 0.76);
  --mm-panel-strong: rgba(8, 17, 36, 0.86);
  --mm-border: rgba(148, 163, 184, 0.16);
  --mm-text: rgba(248, 250, 252, 0.9);
  --mm-muted-text: rgba(226, 232, 240, 0.52);
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(1100px, 94vw);
  max-height: min(780px, 88vh);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--mm-tone) 20%, rgba(148, 163, 184, 0.24));
  border-radius: 14px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--mm-tone) 8%, transparent), transparent 28%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(2, 6, 23, 0.98));
  box-shadow:
    0 34px 110px rgba(0, 0, 0, 0.66),
    0 0 0 1px rgba(255, 255, 255, 0.035),
    0 0 70px color-mix(in srgb, var(--mm-tone) 12%, transparent);
  color: var(--mm-text);
}
.mm-console::before {
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
.mm-console::after {
  position: absolute;
  inset: auto 20px 0;
  height: 1px;
  content: '';
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--mm-tone) 52%, transparent), transparent);
  opacity: 0.75;
}
.mm-beam {
  position: absolute;
  inset: -36% auto auto 8%;
  width: 42%;
  height: 172%;
  transform: rotate(24deg);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--mm-tone) 18%, transparent), transparent);
  opacity: 0.72;
  pointer-events: none;
}
.mm-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 22px 24px 18px;
  border-bottom: 1px solid var(--mm-border);
  background:
    radial-gradient(circle at 12% 0, color-mix(in srgb, var(--mm-tone) 15%, transparent), transparent 34%),
    rgba(15, 23, 42, 0.36);
}
.mm-brand-mark {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--mm-tone) 42%, rgba(255,255,255,0.08));
  border-radius: 12px;
  background:
    radial-gradient(circle at 30% 18%, color-mix(in srgb, var(--mm-tone) 42%, transparent), transparent 45%),
    color-mix(in srgb, var(--mm-tone) 11%, rgba(255,255,255,0.04));
  color: color-mix(in srgb, var(--mm-tone) 82%, white);
  box-shadow:
    0 0 26px color-mix(in srgb, var(--mm-tone) 18%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.1);
}
.mm-eyebrow {
  margin: 0 0 3px;
  color: color-mix(in srgb, var(--mm-tone) 72%, white 8%);
  font: 800 10px/1 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.mm-title {
  margin: 0;
  color: rgba(248, 250, 252, 0.95);
  font-size: 21px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.mm-subtitle {
  margin: 5px 0 0;
  color: var(--mm-muted-text);
  font-size: 12px;
}
.mm-active-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid rgba(251, 191, 36, 0.22);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(251, 191, 36, 0.13), rgba(251, 191, 36, 0.06));
  color: #fbbf24;
  font-size: 12px;
  font-weight: 750;
  white-space: nowrap;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.07);
}
.mm-active-pill.is-ready {
  border-color: color-mix(in srgb, var(--mm-tone) 34%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--mm-tone) 16%, transparent), color-mix(in srgb, var(--mm-tone) 7%, transparent));
  color: color-mix(in srgb, var(--mm-tone) 80%, white);
}
.mm-icon-btn,
.mm-mini-btn,
.mm-ghost-btn,
.mm-danger-btn,
.mm-primary,
.mm-row-link,
.mm-provider-select,
.mm-provider-delete,
.mm-preset-card,
.mm-model-pick,
.mm-secret-input button {
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  cursor: pointer;
}
.mm-icon-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.055);
  color: rgba(255, 255, 255, 0.58);
}
.mm-icon-btn:hover,
.mm-icon-btn:focus-visible {
  color: white;
  background: color-mix(in srgb, var(--mm-tone) 10%, rgba(255,255,255,0.08));
  border-color: color-mix(in srgb, var(--mm-tone) 30%, transparent);
  outline: 0;
}
.mm-body {
  position: relative;
  display: grid;
  grid-template-columns: 292px minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}
.mm-rail {
  position: relative;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  border-right: 1px solid var(--mm-border);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.62), rgba(2, 6, 23, 0.34)),
    color-mix(in srgb, var(--mm-tone) 3%, transparent);
}
.mm-rail::before {
  position: absolute;
  inset: 0 0 auto;
  height: 140px;
  pointer-events: none;
  content: '';
  background: radial-gradient(circle at 18% 0, color-mix(in srgb, var(--mm-tone) 13%, transparent), transparent 62%);
}
.mm-main {
  position: relative;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  background: rgba(2, 6, 23, 0.16);
}
.mm-main::before {
  position: sticky;
  top: 0;
  z-index: 2;
  display: block;
  height: 0;
  pointer-events: none;
  content: '';
  box-shadow: 0 0 26px 18px rgba(2, 6, 23, 0.5);
}
.mm-rail-title,
.mm-model-head,
.mm-panel-head,
.mm-head-actions,
.mm-rail-tools,
.mm-add-model {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mm-rail-title,
.mm-panel-head,
.mm-model-head { justify-content: space-between; }
.mm-rail-title {
  position: relative;
  margin-bottom: 12px;
  color: rgba(226, 232, 240, 0.78);
  font-size: 12px;
  font-weight: 800;
}
.mm-mini-btn,
.mm-ghost-btn,
.mm-danger-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid rgba(255, 255, 255, 0.085);
  border-radius: 9px;
  background: linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.035));
  color: rgba(226, 232, 240, 0.66);
  font-size: 11px;
  font-weight: 750;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055);
}
.mm-mini-btn:hover,
.mm-ghost-btn:hover,
.mm-mini-btn:focus-visible,
.mm-ghost-btn:focus-visible {
  color: white;
  border-color: color-mix(in srgb, var(--mm-tone) 28%, transparent);
  background: color-mix(in srgb, var(--mm-tone) 8%, rgba(255,255,255,0.06));
  outline: 0;
}
.mm-danger-btn:hover,
.mm-danger-btn:focus-visible {
  color: #fecdd3;
  border-color: rgba(244, 63, 94, 0.32);
  background: rgba(244, 63, 94, 0.12);
  outline: 0;
}
.mm-provider-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.mm-provider-card {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  gap: 6px;
  padding: 7px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 11px;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.022)),
    rgba(2, 6, 23, 0.28);
  color: inherit;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}
.mm-provider-card::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--mm-tone), transparent);
  opacity: 0;
  transition: opacity 0.18s ease;
}
.mm-provider-card:hover,
.mm-provider-card.is-active {
  border-color: color-mix(in srgb, var(--mm-tone) 38%, transparent);
  background:
    radial-gradient(circle at 12px 12px, color-mix(in srgb, var(--mm-tone) 12%, transparent), transparent 42px),
    rgba(15, 23, 42, 0.46);
}
.mm-provider-card:hover { transform: translateY(-1px); }
.mm-provider-card.is-active::before { opacity: 0.82; }
.mm-provider-select {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 5px;
  background: transparent;
  color: inherit;
  text-align: left;
}
.mm-provider-select:focus-visible {
  outline: 0;
}
.mm-provider-delete {
  display: grid;
  width: 29px;
  height: 29px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  background: transparent;
  color: rgba(226, 232, 240, 0.34);
}
.mm-provider-delete:hover,
.mm-provider-delete:focus-visible {
  background: rgba(244, 63, 94, 0.12);
  color: #fda4af;
  outline: 0;
}
.mm-provider-led,
.mm-model-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 999px;
  background: #fbbf24;
  box-shadow: 0 0 12px rgba(251,191,36,0.45);
}
.mm-provider-led.is-ok { background: #34d399; box-shadow: 0 0 14px rgba(52,211,153,0.52); }
.mm-provider-led.is-bad { background: #fb7185; box-shadow: 0 0 14px rgba(251,113,133,0.52); }
.mm-provider-name,
.mm-provider-meta {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-provider-name {
  color: rgba(248,250,252,0.88);
  font-size: 13px;
  font-weight: 800;
}
.mm-provider-meta {
  margin-top: 3px;
  color: rgba(226, 232, 240, 0.42);
  font-size: 11px;
}
.mm-empty-route {
  position: relative;
  display: grid;
  place-items: center;
  gap: 10px;
  padding: 28px 14px;
  border: 1px dashed color-mix(in srgb, var(--mm-tone) 22%, rgba(255,255,255,0.12));
  border-radius: 11px;
  background: rgba(2, 6, 23, 0.22);
  color: rgba(226,232,240,0.42);
  text-align: center;
  font-size: 12px;
}
.mm-empty-route svg { color: var(--mm-tone); opacity: 0.72; }
.mm-rail-tools {
  position: relative;
  margin-top: 14px;
  flex-wrap: wrap;
}
.mm-import-box {
  position: relative;
  display: grid;
  gap: 8px;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 11px;
  background: rgba(2, 6, 23, 0.28);
}
.mm-health-panel {
  position: relative;
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  margin-bottom: 12px;
  padding: 14px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--mm-tone) 22%, rgba(148, 163, 184, 0.14));
  border-radius: 11px;
  background:
    radial-gradient(circle at 18% 0, color-mix(in srgb, var(--mm-tone) 13%, transparent), transparent 44%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.62), rgba(2, 6, 23, 0.34));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
}
.mm-health-panel::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--mm-tone), transparent);
  opacity: 0.72;
}
.mm-health-panel.is-ready { border-color: rgba(52, 211, 153, 0.28); }
.mm-health-panel.is-failed { border-color: rgba(251, 113, 133, 0.34); }
.mm-health-score {
  position: relative;
  display: grid;
  place-items: center;
  height: 74px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--mm-tone) 28%, transparent);
  border-radius: 10px;
  background:
    radial-gradient(circle at 50% 20%, color-mix(in srgb, var(--mm-tone) 20%, transparent), transparent 52%),
    rgba(2, 6, 23, 0.44);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.mm-health-score strong {
  color: color-mix(in srgb, var(--mm-tone) 82%, white);
  font: 850 25px/1 var(--hud-font-data, ui-monospace, monospace);
  text-shadow: 0 0 18px color-mix(in srgb, var(--mm-tone) 28%, transparent);
}
.mm-health-score span {
  color: rgba(226, 232, 240, 0.46);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.mm-health-copy h3 {
  margin: 4px 0 4px;
  color: rgba(248, 250, 252, 0.94);
  font-size: 16px;
  letter-spacing: -0.01em;
}
.mm-health-copy p:last-child {
  margin: 0;
  color: rgba(226, 232, 240, 0.55);
  font-size: 12px;
  line-height: 1.55;
}
.mm-preset-panel,
.mm-panel {
  position: relative;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--mm-tone) 14%, rgba(148, 163, 184, 0.16));
  border-radius: 12px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--mm-tone) 7%, transparent), transparent 38%),
    rgba(2, 6, 23, 0.3);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.045);
}
.mm-preset-panel { margin-bottom: 12px; padding: 13px; }
.mm-panel { padding: 18px; }
.mm-preset-panel::before,
.mm-panel::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255,255,255,0.035) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: linear-gradient(110deg, rgba(0,0,0,0.48), transparent 62%);
}
.mm-panel > *,
.mm-preset-panel > * { position: relative; }
.mm-preset-intro {
  display: grid;
  gap: 3px;
  margin-bottom: 12px;
}
.mm-preset-kicker,
.mm-section-label {
  margin: 0;
  color: color-mix(in srgb, var(--mm-tone) 78%, white 5%);
  font: 850 10px/1 var(--hud-font-data, ui-monospace, monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.mm-preset-intro strong {
  color: rgba(248, 250, 252, 0.9);
  font-size: 14px;
  line-height: 1.25;
}
.mm-preset-intro small {
  color: rgba(226, 232, 240, 0.43);
  font-size: 11px;
  line-height: 1.45;
}
.mm-preset-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 9px;
}
.mm-preset-card {
  position: relative;
  display: grid;
  min-height: 108px;
  align-content: start;
  gap: 8px;
  padding: 13px 13px 12px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--preset-tone) 20%, rgba(148, 163, 184, 0.16));
  border-radius: 10px;
  background:
    radial-gradient(circle at 18px 16px, color-mix(in srgb, var(--preset-tone) 20%, transparent), transparent 38px),
    linear-gradient(180deg, color-mix(in srgb, var(--preset-tone) 7%, rgba(15, 23, 42, 0.58)), rgba(2, 6, 23, 0.34));
  color: inherit;
  text-align: left;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}
.mm-preset-card::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--preset-tone), transparent);
  opacity: 0.72;
}
.mm-preset-card::after {
  position: absolute;
  right: -24px;
  bottom: -36px;
  width: 94px;
  height: 94px;
  border-radius: 999px;
  content: '';
  background: color-mix(in srgb, var(--preset-tone) 13%, transparent);
  filter: blur(2px);
  opacity: 0.56;
}
.mm-preset-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--preset-tone) 48%, transparent);
  background:
    radial-gradient(circle at 18px 16px, color-mix(in srgb, var(--preset-tone) 26%, transparent), transparent 42px),
    linear-gradient(180deg, color-mix(in srgb, var(--preset-tone) 11%, rgba(15, 23, 42, 0.62)), rgba(2, 6, 23, 0.4));
  box-shadow:
    0 14px 34px color-mix(in srgb, var(--preset-tone) 13%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.08);
}
.mm-preset-card:focus-visible {
  outline: 0;
  border-color: color-mix(in srgb, var(--preset-tone) 62%, transparent);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--preset-tone) 18%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.08);
}
.mm-preset-orb {
  position: relative;
  z-index: 1;
  width: 24px;
  height: 24px;
  border: 1px solid color-mix(in srgb, var(--preset-tone) 45%, rgba(255,255,255,0.1));
  border-radius: 8px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--preset-tone) 78%, white 8%), color-mix(in srgb, var(--preset-tone) 18%, rgba(2, 6, 23, 0.72))),
    rgba(255,255,255,0.05);
  box-shadow: 0 0 18px color-mix(in srgb, var(--preset-tone) 25%, transparent);
}
.mm-preset-topline {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mm-preset-name {
  min-width: 0;
  overflow: hidden;
  color: rgba(248,250,252,0.92);
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-preset-action {
  flex: 0 0 auto;
  padding: 2px 6px;
  border: 1px solid color-mix(in srgb, var(--preset-tone) 26%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--preset-tone) 8%, rgba(255,255,255,0.04));
  color: color-mix(in srgb, var(--preset-tone) 72%, white);
  font: 800 10px/1.35 ui-monospace, monospace;
  opacity: 0;
  transform: translateX(4px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.mm-preset-card:hover .mm-preset-action,
.mm-preset-card:focus-visible .mm-preset-action {
  opacity: 1;
  transform: translateX(0);
}
.mm-preset-summary {
  position: relative;
  z-index: 1;
  display: -webkit-box;
  overflow: hidden;
  color: rgba(226,232,240,0.54);
  font-size: 11px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.mm-panel-head h3,
.mm-start-panel h3 {
  margin: 2px 0 0;
  color: rgba(248,250,252,0.94);
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.mm-route-meta {
  max-width: 460px;
  margin: 5px 0 0;
  overflow: hidden;
  color: rgba(226,232,240,0.4);
  font: 11px/1.4 var(--hud-font-data, ui-monospace, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-test-result {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0;
  padding: 10px 12px;
  border: 1px solid rgba(244, 63, 94, 0.22);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(244, 63, 94, 0.12), rgba(244, 63, 94, 0.06));
  color: #fda4af;
  font-size: 12px;
}
.mm-test-result.is-ok {
  border-color: rgba(34,197,94,0.24);
  background: linear-gradient(180deg, rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.06));
  color: #86efac;
}
.mm-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.mm-field { display: grid; gap: 7px; }
.mm-field-wide { grid-column: 1 / -1; }
.mm-field span {
  color: rgba(226,232,240,0.62);
  font-size: 11px;
  font-weight: 800;
}
.mm-field small {
  color: rgba(226,232,240,0.38);
  font-size: 11px;
  line-height: 1.5;
}
.mm-input,
.mm-textarea {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.58), rgba(2, 6, 23, 0.46));
  color: rgba(248,250,252,0.92);
  outline: none;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}
.mm-input { height: 40px; padding: 0 12px; }
.mm-textarea { resize: vertical; padding: 10px 12px; }
.mm-input:focus,
.mm-textarea:focus {
  border-color: color-mix(in srgb, var(--mm-tone) 50%, transparent);
  background: rgba(2, 6, 23, 0.58);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--mm-tone) 14%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.06);
}
.mm-secret-input { position: relative; }
.mm-secret-input .mm-input { padding-right: 42px; }
.mm-secret-input button {
  position: absolute;
  top: 50%;
  right: 8px;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  background: transparent;
  color: rgba(226,232,240,0.45);
  transform: translateY(-50%);
}
.mm-secret-input button:hover,
.mm-secret-input button:focus-visible {
  color: white;
  background: rgba(255,255,255,0.08);
  outline: 0;
}
.mm-model-section {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid rgba(148,163,184,0.14);
}
.mm-muted {
  margin: 4px 0 0;
  color: rgba(226,232,240,0.44);
  font-size: 12px;
}
.mm-model-head code {
  color: rgba(226,232,240,0.42);
  font-size: 11px;
}
.mm-model-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.mm-model-list {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}
.mm-model-empty {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 12px;
  padding: 14px;
  border: 1px dashed color-mix(in srgb, var(--mm-tone) 22%, rgba(148, 163, 184, 0.18));
  border-radius: 10px;
  background: rgba(2, 6, 23, 0.25);
  color: rgba(226, 232, 240, 0.48);
}
.mm-model-empty svg {
  flex: 0 0 auto;
  color: var(--mm-tone);
  opacity: 0.78;
}
.mm-model-empty strong {
  display: block;
  color: rgba(248, 250, 252, 0.82);
  font-size: 12px;
}
.mm-model-empty p {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.55;
}
.mm-model-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.016)),
    rgba(2, 6, 23, 0.28);
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}
.mm-model-row::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--mm-tone), transparent);
  opacity: 0;
}
.mm-model-row:hover {
  border-color: rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.44);
  transform: translateY(-1px);
}
.mm-model-row.is-active {
  border-color: color-mix(in srgb, var(--mm-tone) 42%, transparent);
  background:
    radial-gradient(circle at 16px 16px, color-mix(in srgb, var(--mm-tone) 12%, transparent), transparent 44px),
    color-mix(in srgb, var(--mm-tone) 8%, rgba(2, 6, 23, 0.4));
}
.mm-model-row.is-active::before { opacity: 0.82; }
.mm-model-pick {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: flex-start;
  gap: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
}
.mm-model-pick:focus-visible { outline: 0; }
.mm-model-radio {
  display: grid;
  width: 25px;
  height: 25px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.045);
}
.mm-model-row.is-active .mm-model-radio {
  border-color: color-mix(in srgb, var(--mm-tone) 45%, transparent);
  background: color-mix(in srgb, var(--mm-tone) 13%, transparent);
}
.mm-model-row.is-active .mm-model-dot {
  background: var(--mm-tone);
  box-shadow: 0 0 12px color-mix(in srgb, var(--mm-tone) 55%, transparent);
}
.mm-model-text {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.mm-model-text strong {
  overflow: hidden;
  color: rgba(248,250,252,0.92);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 800 13px/1.25 ui-monospace, monospace;
}
.mm-model-text em {
  color: rgba(226,232,240,0.44);
  font-size: 11px;
  font-style: normal;
  line-height: 1.45;
}
.mm-model-rename {
  min-width: 160px;
  flex: 1;
}
.mm-model-row-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding-top: 1px;
}
.mm-model-state {
  display: inline-flex;
  min-height: 23px;
  flex: 0 0 auto;
  align-items: center;
  padding: 0 8px;
  border: 1px solid rgba(251, 191, 36, 0.18);
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.1);
  color: rgba(253, 230, 138, 0.78);
  font-size: 11px;
  font-weight: 800;
}
.mm-model-state.is-available {
  border-color: rgba(52, 211, 153, 0.22);
  background: rgba(52, 211, 153, 0.1);
  color: #86efac;
}
.mm-row-link {
  background: transparent;
  color: rgba(226,232,240,0.44);
  font-size: 11px;
}
.mm-row-link:hover,
.mm-row-link:focus-visible {
  color: white;
  outline: 0;
}
.mm-row-link.danger:hover,
.mm-row-link.danger:focus-visible { color: #fb7185; }
.mm-add-model {
  margin-top: 12px;
}
.mm-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 39px;
  padding: 0 15px;
  border-radius: 10px;
  background:
    radial-gradient(circle at 30% 0, rgba(255,255,255,0.32), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--mm-tone) 92%, white 5%), var(--mm-tone));
  color: #03131a;
  font-size: 12px;
  font-weight: 850;
  box-shadow:
    0 10px 26px color-mix(in srgb, var(--mm-tone) 18%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.24);
}
.mm-primary.small {
  min-height: 34px;
  padding: 0 11px;
  white-space: nowrap;
}
.mm-primary:hover,
.mm-primary:focus-visible {
  filter: brightness(1.08);
  outline: 0;
}
.mm-primary:disabled,
.mm-ghost-btn:disabled {
  cursor: not-allowed;
  filter: none;
  opacity: 0.45;
}
.mm-start-panel {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 54px 28px;
  text-align: center;
  color: rgba(226,232,240,0.7);
}
.mm-start-panel svg {
  color: var(--mm-tone);
  filter: drop-shadow(0 0 16px color-mix(in srgb, var(--mm-tone) 24%, transparent));
}
.mm-start-panel ol {
  margin: 0;
  padding-left: 20px;
  text-align: left;
  color: rgba(226,232,240,0.5);
  font-size: 13px;
  line-height: 1.8;
}
.mm-error-text {
  margin: 0;
  color: #fb7185;
  font-size: 11px;
}
.mm-spin { animation: mm-spin 1s linear infinite; }
@keyframes mm-spin { to { transform: rotate(360deg); } }
.mm-fade-enter-active,
.mm-fade-leave-active { transition: opacity 0.18s ease; }
.mm-fade-enter-from,
.mm-fade-leave-to { opacity: 0; }
.mm-pop-enter-active,
.mm-pop-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.mm-pop-enter-from,
.mm-pop-leave-to { opacity: 0; transform: translateY(10px) scale(0.985); }
@media (max-width: 920px) {
  .mm-body { grid-template-columns: 1fr; }
  .mm-rail {
    max-height: 270px;
    border-right: 0;
    border-bottom: 1px solid var(--mm-border);
  }
  .mm-preset-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .mm-shell { padding: 10px; }
  .mm-console {
    width: 100%;
    max-height: 94vh;
    border-radius: 12px;
  }
  .mm-header {
    padding: 16px;
    flex-wrap: wrap;
  }
  .mm-active-pill { order: 3; }
  .mm-form-grid,
  .mm-health-panel,
  .mm-preset-strip { grid-template-columns: 1fr; }
  .mm-head-actions {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .mm-model-head,
  .mm-model-actions {
    align-items: flex-start;
    flex-direction: column;
  }
  .mm-model-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .mm-model-row-actions {
    width: 100%;
    flex-wrap: wrap;
    padding-left: 35px;
  }
  .mm-add-model { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  .mm-spin { animation: none; }
  .mm-preset-card,
  .mm-provider-card,
  .mm-model-row { transition: none; }
  .mm-preset-card:hover,
  .mm-provider-card:hover,
  .mm-model-row:hover { transform: none; }
  .mm-fade-enter-active,
  .mm-fade-leave-active,
  .mm-pop-enter-active,
  .mm-pop-leave-active { transition: none; }
}
</style>
