import { computed, nextTick, onUnmounted, reactive, ref, watch, type Ref } from 'vue'
import {
  providerReadiness,
  presetForProvider,
} from './advisor'
import { useFeedback } from '@/features/feedback'
import {
  activeModel,
  activeProvider,
  addProvider,
  clearAllConfig,
  configured,
  exportConfig,
  hasUiConfig,
  importConfig,
  mergeDiscoveredModels,
  providers,
  recordTestResult,
  removeProvider,
  setActiveModel,
  setActiveProvider,
  updateProvider,
} from './store'
import { PROVIDER_PRESETS } from './presets'
import { discoverLlmModels, testLlmConnection } from './connection-test'
import type { ConnectionTestResult, ModelDiscoveryResult, ModelEntry, ProviderConfig, ProviderPreset } from './types'

export function useModelConfigModal(open: Ref<boolean>, close: () => void) {
  const feedback = useFeedback()
  const autoDiscoveryAttempted = new Set<string>()
  const selectedId = ref<string | null>(activeProvider.value?.id ?? null)
  const showKey = ref(false)
  const showImport = ref(false)
  const importText = ref('')
  const importError = ref<string | null>(null)
  const testResult = ref<ConnectionTestResult | null>(null)
  const discoveryResult = ref<ModelDiscoveryResult | null>(null)
  const testing = ref(false)
  const discovering = ref(false)
  const newModelName = ref('')
  const editingModelId = ref<string | null>(null)
  const editingModelName = ref('')
  const isCreating = ref(false)
  const draft = reactive<{
    name: string
    baseUrl: string
    apiKey: string
    modelsUrl: string
    models: ModelEntry[]
    activeModelId: string | null
  }>({
    name: '',
    baseUrl: '',
    apiKey: '',
    modelsUrl: '',
    models: [],
    activeModelId: null,
  })

  function genDraftModelId(): string {
    return `draft_${Math.random().toString(36).slice(2, 10)}`
  }

  function cloneModels(models: ModelEntry[]): ModelEntry[] {
    return models.map((model) => ({
      ...model,
    }))
  }

  function setDraftFromProvider(provider: ProviderConfig | null) {
    draft.name = provider?.name ?? ''
    draft.baseUrl = provider?.baseUrl ?? ''
    draft.apiKey = provider?.apiKey ?? ''
    draft.modelsUrl = provider?.modelsUrl ?? ''
    draft.models = provider ? cloneModels(provider.models) : []
    draft.activeModelId = provider?.activeModelId ?? draft.models[0]?.id ?? null
  }

  const selectedProvider = computed(() => {
    if (isCreating.value) return null
    if (selectedId.value) return providers.value.find((provider) => provider.id === selectedId.value) ?? null
    return activeProvider.value ?? providers.value[0] ?? null
  })

  const editableProvider = computed<ProviderConfig | null>(() => {
    if (!isCreating.value && !selectedProvider.value) return null
    return {
      id: selectedProvider.value?.id ?? 'draft-provider',
      name: draft.name.trim() || (isCreating.value ? '未保存线路' : selectedProvider.value?.name ?? '未命名 Provider'),
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl,
      modelsUrl: draft.modelsUrl.trim() || undefined,
      models: draft.models,
      activeModelId: draft.activeModelId,
      createdAt: selectedProvider.value?.createdAt ?? Date.now(),
      lastTestedAt: selectedProvider.value?.lastTestedAt,
      lastTestOk: selectedProvider.value?.lastTestOk,
      lastTestMessage: selectedProvider.value?.lastTestMessage,
      lastModelsSyncedAt: selectedProvider.value?.lastModelsSyncedAt,
    }
  })

  const selectedModelName = computed(() => {
    const provider = editableProvider.value
    if (!provider) return ''
    const model = provider.models.find((item) => item.id === provider.activeModelId)
    const name = model?.name ?? provider.models[0]?.name ?? ''
    if (name) return name
    if (isCreating.value) {
      const draftModel = draft.models.find((item) => item.id === draft.activeModelId)
      return draftModel?.name ?? draft.models[0]?.name ?? ''
    }
    return ''
  })

  const selectedPreset = computed(() => presetForProvider(editableProvider.value))
  const selectedProviderTone = computed(() => selectedPreset.value?.accent ?? '#38bdf8')
  const readiness = computed(() => providerReadiness(editableProvider.value))
  const modelSyncCopy = computed(() => {
    const provider = editableProvider.value
    if (!provider) return ''
    if (discovering.value) return `正在自动探测候选端点（/v1/models、/models 等）`
    if (discoveryResult.value?.ok) return `已刷新可用模型，手动添加的模型已保留。`
    if (discoveryResult.value && !discoveryResult.value.ok) return `同步失败：${discoveryResult.value.message}`
    if (!draft.apiKey.trim()) return `同步会自动探测 /v1/models、/models 等候选端点，需要先填写 API Key。`
    return `同步会自动探测候选端点（/v1/models、/models，含剥离兼容子路径）；成功后刷新可用模型，并保留手动添加的模型。`
  })

  const statusCopy = computed(() => {
    if (!hasUiConfig.value) return '选择预设或自定义 OpenAI 兼容线路'
    if (!configured.value) return readiness.value.title
    return `${activeProvider.value?.name ?? '当前线路'} / ${activeModel.value || '未选择模型'}`
  })

  const sortedPresets = computed(() => PROVIDER_PRESETS)
  const draftDirty = computed(() => {
    if (isCreating.value) return !!draft.name.trim() || !!draft.baseUrl.trim() || !!draft.apiKey.trim() || draft.models.length > 0
    const provider = selectedProvider.value
    if (!provider) return false
    return provider.name !== draft.name.trim()
      || provider.baseUrl !== draft.baseUrl.trim().replace(/\/+$/, '')
      || provider.apiKey !== draft.apiKey.trim()
      || provider.activeModelId !== draft.activeModelId
      || JSON.stringify(provider.models) !== JSON.stringify(draft.models)
  })
  const canSaveDraft = computed(() => !!draft.name.trim() && !!draft.baseUrl.trim())

  function shouldAutoDiscover(provider: ProviderConfig | null): boolean {
    if (!provider?.apiKey.trim()) return false
    if (discovering.value || testing.value) return false
    if (autoDiscoveryAttempted.has(provider.id)) return false
    const confirmedCount = provider.models.filter((model) => model.available).length
    const stale = !provider.lastModelsSyncedAt || Date.now() - provider.lastModelsSyncedAt > 24 * 60 * 60 * 1000
    return confirmedCount === 0 || stale
  }

  function maybeAutoDiscover(provider: ProviderConfig | null) {
    if (!open.value || !shouldAutoDiscover(provider)) return
    if (!provider) return
    autoDiscoveryAttempted.add(provider.id)
    void discoverSelectedModels()
  }

  watch(selectedProvider, (provider) => {
    if (isCreating.value) return
    if (!provider) {
      setDraftFromProvider(null)
      return
    }
    setDraftFromProvider(provider)
    testResult.value = null
    discoveryResult.value = null
    nextTick(() => maybeAutoDiscover(provider))
  }, { immediate: true, flush: 'sync' })

  watch(activeProvider, (provider) => {
    if (!selectedId.value && provider) selectedId.value = provider.id
  })

  function selectProvider(id: string) {
    isCreating.value = false
    selectedId.value = id
    setActiveProvider(id)
    setDraftFromProvider(providers.value.find((provider) => provider.id === id) ?? null)
  }

  function focusInput(selector: string) {
    nextTick(() => {
      const el = document.querySelector<HTMLInputElement>(selector)
      el?.focus()
      el?.select?.()
    })
  }

  function createFromPreset(preset: ProviderPreset) {
    isCreating.value = true
    selectedId.value = null
    draft.name = preset.name
    draft.baseUrl = preset.baseUrl
    draft.apiKey = ''
    draft.modelsUrl = ''
    draft.models = []
    draft.activeModelId = null
    testResult.value = null
    discoveryResult.value = null
    focusInput('.mm-key-input')
  }

  function createCustomProvider() {
    isCreating.value = true
    selectedId.value = null
    draft.name = '自定义 Provider'
    draft.baseUrl = 'https://api.example.com/v1'
    draft.apiKey = ''
    draft.modelsUrl = ''
    draft.models = []
    draft.activeModelId = null
    testResult.value = null
    discoveryResult.value = null
    focusInput('.mm-name-input')
  }

  function saveDraft() {
    if (!canSaveDraft.value) return

    if (isCreating.value) {
      const provider = addProvider({
        name: draft.name,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        modelsUrl: draft.modelsUrl.trim() || undefined,
        models: draft.models,
      })
      selectedId.value = provider.id
      setActiveProvider(provider.id)
      if (draft.activeModelId && provider.models.some((model) => model.id === draft.activeModelId)) {
        setActiveModel(provider.id, draft.activeModelId)
      }
      isCreating.value = false
      setDraftFromProvider(provider)
      return
    }

    const provider = selectedProvider.value
    if (!provider) return
    updateProvider(provider.id, {
      name: draft.name,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      modelsUrl: draft.modelsUrl.trim() || undefined,
      models: draft.models,
      activeModelId: draft.activeModelId,
    })
    setDraftFromProvider(providers.value.find((item) => item.id === provider.id) ?? null)
  }

  async function deleteProvider(provider: ProviderConfig) {
    const confirmed = await feedback.confirmDanger({
      title: '删除模型线路',
      message: `确定删除「${provider.name}」及其模型列表？API Key、模型列表和验证状态都会从本地移除。`,
      confirmLabel: '删除线路',
    })
    if (!confirmed) return
    if (!removeProvider(provider.id)) {
      await feedback.alert({
        tone: 'warning',
        title: '需要保留可用模型',
        message: '至少需要保留一个已确认可用的模型。请先添加并验证另一条可用线路后再删除。',
      })
      return
    }
    feedback.success({
      title: '线路已删除',
      message: `「${provider.name}」已从本地模型配置中移除。`,
    })
    selectedId.value = activeProvider.value?.id ?? providers.value[0]?.id ?? null
  }

  function selectModel(modelId: string) {
    if (draft.models.some((model) => model.id === modelId)) draft.activeModelId = modelId
  }

  function removeModelFromSelected(modelId: string) {
    if (draft.models.length <= 1) return
    const idx = draft.models.findIndex((model) => model.id === modelId)
    if (idx < 0) return
    draft.models.splice(idx, 1)
    if (draft.activeModelId === modelId) draft.activeModelId = draft.models[0]?.id ?? null
  }

  async function clearProviders() {
    if (!providers.value.length) return
    const confirmed = await feedback.confirmDanger({
      title: '清空所有模型线路',
      message: '确定清空所有大模型线路？API Key、模型列表和验证状态都会从本地移除。',
      confirmLabel: '清空线路',
    })
    if (!confirmed) return
    if (!clearAllConfig()) {
      await feedback.alert({
        tone: 'warning',
        title: '不能清空全部可用线路',
        message: '至少需要保留一个已确认可用的模型，不能清空全部可用线路。',
      })
      return
    }
    feedback.success({
      title: '线路已清空',
      message: '本地模型配置已重置，可以重新添加 Provider。',
    })
    selectedId.value = null
    testResult.value = null
    discoveryResult.value = null
  }

  /**
   * 有 Key + baseUrl 就直接用：若还没保存则先落盘，返回可操作的 provider。
   * 落盘后SelectedProvider 才会从 null 变实值，后续 recordTestResult / mergeDiscoveredModels 才有 id。
   */
  async function ensureTestableProvider(): Promise<ProviderConfig | null> {
    if (!draft.apiKey.trim() || !draft.baseUrl.trim()) return null
    if (isCreating.value || !selectedProvider.value) {
      if (!canSaveDraft.value) return null
      saveDraft()
      // 等 Vue 把 providers / selectedProvider 响应式更新，再取最新的实体
      await nextTick()
    }
    return selectedProvider.value
  }

  async function testSelectedProvider() {
    if (!draft.apiKey.trim() || !draft.baseUrl.trim()) return
    const provider = await ensureTestableProvider()
    if (!provider) return
    testing.value = true
    testResult.value = null
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 8_000)
    try {
      const result = await testLlmConnection({
        apiKey: draft.apiKey,
        baseUrl: draft.baseUrl,
        model: selectedModelName.value,
        signal: ctrl.signal,
      })
      testResult.value = result
      const saved = selectedProvider.value
      if (saved) recordTestResult(saved.id, result.ok, result.message, selectedModelName.value)
    } finally {
      clearTimeout(timeout)
      testing.value = false
    }
  }

  async function discoverSelectedModels() {
    if (!draft.apiKey.trim() || !draft.baseUrl.trim()) return
    const provider = await ensureTestableProvider()
    if (!provider) return
    discovering.value = true
    discoveryResult.value = null
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 10_000)
    try {
      const result = await discoverLlmModels({
        apiKey: draft.apiKey,
        baseUrl: draft.baseUrl,
        modelsUrl: draft.modelsUrl.trim() || undefined,
        signal: ctrl.signal,
      })
      discoveryResult.value = result
      if (result.ok) {
        mergeDiscoveredModels(provider.id, result.models)
        setDraftFromProvider(providers.value.find((item) => item.id === provider.id) ?? null)
      }
    } finally {
      clearTimeout(timeout)
      discovering.value = false
    }
  }

  function addModelToSelected() {
    const name = newModelName.value.trim()
    if (!name) return
    const model: ModelEntry = { id: genDraftModelId(), name, available: false, source: 'manual' }
    draft.models.push(model)
    draft.activeModelId = model.id
    newModelName.value = ''
  }

  function startRenameModel(modelId: string, name: string) {
    editingModelId.value = modelId
    editingModelName.value = name
    focusInput('.mm-model-rename')
  }

  function confirmRenameModel() {
    const name = editingModelName.value.trim()
    if (!editingModelId.value || !name) return
    const model = draft.models.find((item) => item.id === editingModelId.value)
    if (model) model.name = name
    editingModelId.value = null
  }

  function handleExport() {
    const json = exportConfig()
    navigator.clipboard.writeText(json)
      .then(() => {
        feedback.success({
          title: '配置已复制',
          message: '模型线路 JSON 已写入剪贴板。',
        })
      })
      .catch(() => {
        void feedback.alert({
          tone: 'danger',
          title: '复制配置失败',
          message: '浏览器未授予剪贴板权限。下面是当前配置 JSON，可手动复制。',
          detail: json,
        })
      })
  }

  function handleImport() {
    importError.value = null
    const text = importText.value.trim()
    if (!text) {
      importError.value = '请粘贴配置 JSON'
      feedback.warning({
        title: '缺少配置内容',
        message: '请先粘贴 hao123-llm-config JSON。',
      })
      return
    }
    if (!importConfig(text)) {
      importError.value = 'JSON 格式不正确'
      feedback.danger({
        title: '导入失败',
        message: 'JSON 格式不正确，或缺少 providers 字段。',
      })
      return
    }
    importText.value = ''
    showImport.value = false
    selectedId.value = activeProvider.value?.id ?? providers.value[0]?.id ?? null
    feedback.success({
      title: '导入完成',
      message: '模型线路配置已更新。',
    })
  }

  function closeImport() {
    showImport.value = false
  }

  let holdingLock = false
  watch(open, (isOpen) => {
    if (isOpen) {
      selectedId.value = activeProvider.value?.id ?? providers.value[0]?.id ?? null
      nextTick(() => maybeAutoDiscover(selectedProvider.value))
      if (!holdingLock) {
        document.body.style.overflow = 'hidden'
        holdingLock = true
      }
    } else if (holdingLock) {
      document.body.style.overflow = ''
      holdingLock = false
    }
  }, { immediate: true })

  function onKeydown(e: KeyboardEvent) {
    if (!open.value || e.key !== 'Escape') return
    if (editingModelId.value) editingModelId.value = null
    else if (showImport.value) showImport.value = false
    else close()
  }

  watch(open, (isOpen) => {
    if (isOpen) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
    if (holdingLock) document.body.style.overflow = ''
  })

  return {
    activeProvider,
    activeModel,
    discovering,
    discoveryResult,
    configured,
    canSaveDraft,
    draft,
    draftDirty,
    editableProvider,
    editingModelId,
    editingModelName,
    hasUiConfig,
    importError,
    importText,
    isCreating,
    newModelName,
    modelSyncCopy,
    providers,
    readiness,
    selectedModelName,
    selectedPreset,
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
    closeImport,
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
  }
}
