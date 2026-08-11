/**
 * 大模型设置 · env 默认值种子
 *
 * 仅当页面内模型配置为空（localStorage 无任何线路）时，用 import.meta.env 的
 * VITE_LLM_* 默认值 seed 一条线路，避免换端口 / 清缓存后每次都要重新配置。
 * 页面内已有配置时这些值不生效（不覆盖用户手动保存的线路）。
 *
 * 需要四个变量同时可读才会 seed：Provider 名称 / Base URL / API Key / 模型名。
 */
import type { ProviderConfig, StoredConfig } from './types'

function genId(prefix: 'p' | 'm'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

interface EnvSeedConfig {
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

export function readEnvSeed(): EnvSeedConfig | null {
  const name = (import.meta.env.VITE_LLM_PROVIDER || '').trim()
  const baseUrl = normalizeBaseUrl(import.meta.env.VITE_LLM_BASE_URL || '')
  const apiKey = (import.meta.env.VITE_LLM_API_KEY || '').trim()
  const model = (import.meta.env.VITE_LLM_MODEL || '').trim()
  if (!name || !baseUrl || !apiKey || !model) return null
  return { name, baseUrl, apiKey, model }
}

export function buildEnvProvider(cfg: EnvSeedConfig): ProviderConfig {
  const modelId = genId('m')
  return {
    id: genId('p'),
    name: cfg.name,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    models: [{ id: modelId, name: cfg.model, available: true, source: 'manual' }],
    activeModelId: modelId,
    createdAt: Date.now(),
  }
}

/** 只在没有已保存线路时 seed；已有任何线路（无论是否可用）都不覆盖。 */
export function seedFromEnv(existing: StoredConfig): StoredConfig {
  const cfg = readEnvSeed()
  if (!cfg) return existing
  if (existing.providers.length > 0) return existing
  const provider = buildEnvProvider(cfg)
  return { providers: [provider], activeProviderId: provider.id }
}
