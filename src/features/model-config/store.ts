/**
 * 大模型设置 · 状态层
 *
 * 多 Provider / 多模型管理，localStorage 持久化。
 * 页面内配置用于本地工作台；API Key 会经 dev 代理转发，不写入源码或 .env。
 */
import { computed, reactive } from 'vue'
import type { ActiveLlmConfig, DiscoveredModel, ModelEntry, ProviderConfig, StoredConfig } from './types'
import { presetByBaseUrl, PROVIDER_PRESETS } from './presets'

const STORAGE_KEY = 'hao123-llm-config'

function genId(prefix: 'p' | 'm'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function normalizeModel(input: Partial<ModelEntry>, fallbackSource: ModelEntry['source'] = 'manual'): ModelEntry | null {
  const name = String(input.name ?? '').trim()
  if (!name) return null
  return {
    id: input.id || genId('m'),
    name,
    description: input.description,
    role: input.role,
    available: !!input.available,
    source: input.source ?? fallbackSource,
    lastSeenAt: input.lastSeenAt,
  }
}

function normalizeProvider(input: Partial<ProviderConfig>): ProviderConfig | null {
  const name = String(input.name ?? '').trim()
  const baseUrl = normalizeBaseUrl(String(input.baseUrl ?? ''))
  if (!name || !baseUrl) return null

  const models = Array.isArray(input.models) && input.models.length > 0
    ? input.models
        .map((model) => normalizeModel(model, model.source ?? 'manual'))
        .filter((model): model is ModelEntry => !!model)
        .filter((model) => model.source !== 'preset' || model.available)
    : []

  const finalModels = models
  const activeModelId = finalModels.some((model) => model.id === input.activeModelId)
    ? input.activeModelId!
    : finalModels[0]?.id ?? null

  return {
    id: input.id || genId('p'),
    name,
    apiKey: String(input.apiKey ?? '').trim(),
    baseUrl,
    modelsUrl: input.modelsUrl?.trim() || undefined,
    models: finalModels,
    activeModelId,
    createdAt: Number(input.createdAt) || Date.now(),
    lastTestedAt: input.lastTestedAt,
    lastTestOk: input.lastTestOk,
    lastTestMessage: input.lastTestMessage,
    lastModelsSyncedAt: input.lastModelsSyncedAt,
  }
}

function loadFromStorage(): StoredConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { providers: [], activeProviderId: null }
    const parsed = JSON.parse(raw) as StoredConfig
    if (!Array.isArray(parsed.providers)) return { providers: [], activeProviderId: null }

    const providers = parsed.providers
      .map((provider) => {
        // 迁移旧格式（单 model 字段 → models 数组）
        if (!Array.isArray((provider as ProviderConfig).models) || (provider as ProviderConfig).models.length === 0) {
          const oldModel = (provider as any).model as string | undefined
          const modelId = genId('m')
          ;(provider as ProviderConfig).models = [{ id: modelId, name: oldModel || 'deepseek-chat' }]
          ;(provider as ProviderConfig).activeModelId = modelId
        }
        return normalizeProvider(provider)
      })
      .filter((provider): provider is ProviderConfig => !!provider)

    const activeProviderId = providers.some((provider) => provider.id === parsed.activeProviderId)
      ? parsed.activeProviderId
      : providers[0]?.id ?? null
    return { providers, activeProviderId }
  } catch {
    return { providers: [], activeProviderId: null }
  }
}

function persist(data: StoredConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // localStorage 可能被禁用；页面内配置失败时不打断 UI。
  }
}

const initial = loadFromStorage()
const state = reactive<StoredConfig>({
  providers: initial.providers,
  activeProviderId: initial.activeProviderId,
})

function providerUsableModels(provider: ProviderConfig): ModelEntry[] {
  if (!provider.apiKey.trim() || !provider.baseUrl.trim()) return []
  return provider.models.filter((model) => model.available)
}

function usableModelCount(list: ProviderConfig[]): number {
  return list.reduce((sum, provider) => sum + providerUsableModels(provider).length, 0)
}

function wouldRemoveLastUsableModel(remainingProviders: ProviderConfig[]): boolean {
  return usableModelCount(state.providers) > 0 && usableModelCount(remainingProviders) === 0
}

function save(): void {
  persist({ providers: state.providers, activeProviderId: state.activeProviderId })
}

export const providers = computed<ProviderConfig[]>(() => state.providers)

export const activeProvider = computed<ProviderConfig | null>(() => {
  if (!state.activeProviderId) return state.providers[0] ?? null
  return state.providers.find((provider) => provider.id === state.activeProviderId) ?? state.providers[0] ?? null
})

export const activeModel = computed<string>(() => {
  const provider = activeProvider.value
  if (!provider) return ''
  const model = provider.models.find((item) => item.id === provider.activeModelId)
  return model?.name ?? provider.models[0]?.name ?? ''
})

export const hasUiConfig = computed<boolean>(() => state.providers.length > 0)

export const configured = computed<boolean>(() => {
  const provider = activeProvider.value
  return !!provider?.apiKey?.trim() && !!activeModel.value
})

export function addProvider(cfg: {
  name: string
  apiKey?: string
  baseUrl: string
  modelsUrl?: string
  models?: Array<string | Partial<ModelEntry>>
}): ProviderConfig {
  const baseUrl = normalizeBaseUrl(cfg.baseUrl)
  const modelInputs: Partial<ModelEntry>[] = cfg.models?.length
    ? cfg.models.map((model) => typeof model === 'string' ? { name: model } : model)
    : []
  const models: ModelEntry[] = modelInputs.map((model) => ({
    id: model.id || genId('m'),
    name: String(model.name ?? '').trim(),
    description: model.description,
    role: model.role,
    available: !!model.available,
    source: model.source ?? 'manual',
    lastSeenAt: model.lastSeenAt,
  })).filter((model) => model.name)

  const preset = presetByBaseUrl(baseUrl)
  const finalModels = models
  const provider: ProviderConfig = {
    id: genId('p'),
    name: cfg.name.trim() || preset?.name || '未命名 Provider',
    apiKey: cfg.apiKey?.trim() || '',
    baseUrl,
    modelsUrl: cfg.modelsUrl?.trim() || undefined,
    models: finalModels,
    activeModelId: finalModels[0]?.id ?? null,
    createdAt: Date.now(),
  }

  state.providers.push(provider)
  if (!state.activeProviderId || state.providers.length === 1) state.activeProviderId = provider.id
  save()
  return provider
}

export function addProviderFromPreset(presetId: string, apiKey = ''): ProviderConfig | null {
  const preset = PROVIDER_PRESETS.find((item) => item.id === presetId)
  if (!preset) return null
  return addProvider({
    name: preset.name,
    apiKey,
    baseUrl: preset.baseUrl,
  })
}

export function updateProvider(id: string, updates: Partial<Pick<ProviderConfig, 'name' | 'apiKey' | 'baseUrl' | 'modelsUrl' | 'models' | 'activeModelId'>>): void {
  const idx = state.providers.findIndex((provider) => provider.id === id)
  if (idx < 0) return
  const previous = state.providers[idx]
  const next = {
    ...previous,
    ...updates,
    baseUrl: updates.baseUrl != null ? normalizeBaseUrl(updates.baseUrl) : previous.baseUrl,
  }
  const normalized = normalizeProvider(next)
  if (!normalized) return
  const identityChanged = normalized.baseUrl !== previous.baseUrl || normalized.apiKey !== previous.apiKey
  if (identityChanged) {
    normalized.lastTestedAt = undefined
    normalized.lastTestOk = undefined
    normalized.lastTestMessage = undefined
    normalized.lastModelsSyncedAt = undefined
    normalized.models = normalized.models.map((model) => ({
      ...model,
      available: false,
      lastSeenAt: undefined,
      source: model.source === 'discovered' ? 'manual' : model.source,
    }))
  }
  state.providers[idx] = normalized
  save()
}

export function removeProvider(id: string): boolean {
  const idx = state.providers.findIndex((provider) => provider.id === id)
  if (idx < 0) return false
  const remainingProviders = state.providers.filter((provider) => provider.id !== id)
  if (wouldRemoveLastUsableModel(remainingProviders)) return false
  state.providers.splice(idx, 1)
  if (state.activeProviderId === id) state.activeProviderId = state.providers[0]?.id ?? null
  save()
  return true
}

export function setActiveProvider(id: string): void {
  if (!state.providers.some((provider) => provider.id === id)) return
  state.activeProviderId = id
  save()
}

export function recordTestResult(providerId: string, ok: boolean, message: string, modelName?: string): void {
  const provider = state.providers.find((item) => item.id === providerId)
  if (!provider) return
  provider.lastTestedAt = Date.now()
  provider.lastTestOk = ok
  provider.lastTestMessage = message
  if (ok) {
    const testedName = modelName?.trim() || activeModel.value
    const model = provider.models.find((item) => item.name === testedName)
    if (model) {
      model.available = true
      model.lastSeenAt = Date.now()
      model.source = model.source ?? 'manual'
    }
  }
  save()
}

export function addModel(providerId: string, name: string): ModelEntry | null {
  const provider = state.providers.find((item) => item.id === providerId)
  const modelName = name.trim()
  if (!provider || !modelName) return null
  const entry: ModelEntry = { id: genId('m'), name: modelName, available: false, source: 'manual' }
  provider.models.push(entry)
  if (!provider.activeModelId) provider.activeModelId = entry.id
  save()
  return entry
}

function normalizeDiscovered(input: string | DiscoveredModel): DiscoveredModel | null {
  if (typeof input === 'string') {
    const name = input.trim()
    return name ? { name } : null
  }
  const name = input.name.trim()
  if (!name) return null
  return {
    ...input,
    name,
  }
}

export function mergeDiscoveredModels(providerId: string, models: Array<string | DiscoveredModel>): number {
  const provider = state.providers.find((item) => item.id === providerId)
  if (!provider) return 0
  const now = Date.now()
  const discovered = models
    .map((model) => normalizeDiscovered(model))
    .filter((model): model is DiscoveredModel => !!model)
  const uniqueByName = new Map(discovered.map((model) => [model.name, model]))
  const previousByName = new Map(provider.models.map((model) => [model.name, model]))
  // 增量合并：保留所有已有模型（预设 / 手动 / 上次发现的），不因本次未返回就清空。
  // 已存在的模型若本次再次出现 → 标记可用并刷新 lastSeenAt；
  // 本次新发现的 → 追加为 discovered；本次未出现的已有模型 → 原样保留。
  const nextModels: ModelEntry[] = provider.models.map((model) => {
    const latest = uniqueByName.get(model.name)
    if (!latest) return model
    return {
      ...model,
      description: latest.description ?? model.description,
      role: latest.role ?? model.role,
      available: true,
      lastSeenAt: now,
    }
  })
  const existingNames = new Set(previousByName.keys())
  for (const name of uniqueByName.keys()) {
    if (existingNames.has(name)) continue
    const latest = uniqueByName.get(name)
    nextModels.push({
      id: genId('m'),
      name,
      description: latest?.description,
      role: latest?.role,
      available: true,
      source: 'discovered',
      lastSeenAt: now,
    })
  }

  provider.models.splice(0, provider.models.length, ...nextModels)
  provider.lastModelsSyncedAt = now
  if (!provider.activeModelId || !provider.models.some((model) => model.id === provider.activeModelId)) {
    provider.activeModelId = provider.models.find((model) => model.available)?.id ?? provider.models[0]?.id ?? null
  }
  save()
  return nextModels.length
}

export function availableModels(provider: ProviderConfig | null): ModelEntry[] {
  if (!provider) return []
  return provider.models.filter((model) => model.available)
}

export function hasUsableModel(provider: ProviderConfig | null): boolean {
  return !!provider && providerUsableModels(provider).length > 0
}

export function hasAnyUsableModel(): boolean {
  return usableModelCount(state.providers) > 0
}

export function removeModel(providerId: string, modelId: string): void {
  const provider = state.providers.find((item) => item.id === providerId)
  if (!provider || provider.models.length <= 1) return
  const idx = provider.models.findIndex((model) => model.id === modelId)
  if (idx < 0) return
  provider.models.splice(idx, 1)
  if (provider.activeModelId === modelId) provider.activeModelId = provider.models[0]?.id ?? null
  save()
}

export function setActiveModel(providerId: string, modelId: string): void {
  const provider = state.providers.find((item) => item.id === providerId)
  if (!provider?.models.some((model) => model.id === modelId)) return
  provider.activeModelId = modelId
  if (state.activeProviderId !== providerId) state.activeProviderId = providerId
  save()
}

export function renameModel(providerId: string, modelId: string, newName: string): void {
  const provider = state.providers.find((item) => item.id === providerId)
  const model = provider?.models.find((item) => item.id === modelId)
  const name = newName.trim()
  if (!model || !name) return
  model.name = name
  save()
}

export function exportConfig(): string {
  return JSON.stringify({ providers: state.providers, activeProviderId: state.activeProviderId }, null, 2)
}

export function importConfig(json: string): boolean {
  try {
    const data = JSON.parse(json) as StoredConfig
    if (!Array.isArray(data.providers)) return false
    const importedProviders = data.providers
      .map((provider) => normalizeProvider(provider))
      .filter((provider): provider is ProviderConfig => !!provider)
    state.providers.splice(0, state.providers.length, ...importedProviders)
    state.activeProviderId = importedProviders.some((provider) => provider.id === data.activeProviderId)
      ? data.activeProviderId
      : importedProviders[0]?.id ?? null
    save()
    return true
  } catch {
    return false
  }
}

export function clearAllConfig(): boolean {
  if (wouldRemoveLastUsableModel([])) return false
  state.providers.splice(0, state.providers.length)
  state.activeProviderId = null
  save()
  return true
}

export function getActiveConfig(): ActiveLlmConfig {
  const provider = activeProvider.value
  const model = activeModel.value || 'deepseek-chat'
  return {
    provider: (provider?.name || 'deepseek').toLowerCase().replace(/\s+/g, '-'),
    apiKey: provider?.apiKey?.trim() || '',
    model,
    endpoint: '/deepseek/chat/completions',
    baseUrl: provider?.baseUrl || 'https://api.deepseek.com',
    configured: configured.value,
  }
}

export function getClientAuthBody(): Record<string, unknown> {
  const cfg = getActiveConfig()
  if (!cfg.apiKey) return {}
  return { api_key: cfg.apiKey, base_url: cfg.baseUrl }
}
