/**
 * 大模型设置 · 类型契约
 *
 * 该模块只描述「用户在页面内管理 LLM 接入」这件事，不依赖 chat store。
 */

export interface ModelEntry {
  id: string
  /** 模型名，如 "deepseek-chat" */
  name: string
  /** 给用户看的短说明，手动模型可为空 */
  description?: string
  /** 模型定位：日常 / 推理 / 多模态 / 低成本等 */
  role?: string
  /** 是否已经由 /models 或连通性测试确认可用 */
  available?: boolean
  /** 模型来源：预设 / 手动 / 服务端发现 */
  source?: 'preset' | 'manual' | 'discovered'
  /** 最近一次由服务端确认存在或测试成功的时间 */
  lastSeenAt?: number
}

export interface ProviderConfig {
  id: string
  /** 显示名称，如 "DeepSeek" */
  name: string
  /** API Key（明文存 localStorage；仅适合本地工作台） */
  apiKey: string
  /** OpenAI compatible API 根地址，不含 /chat/completions */
  baseUrl: string
  /** 可选：精确指定模型列表端点（用户自定义完整 URL，绕过候选探测） */
  modelsUrl?: string
  /** 该 Provider 下可选的模型列表 */
  models: ModelEntry[]
  /** 当前激活的模型 id */
  activeModelId: string | null
  createdAt: number
  /** 最近一次连通性测试 */
  lastTestedAt?: number
  lastTestOk?: boolean
  lastTestMessage?: string
  /** 最近一次成功从 /models 同步模型列表 */
  lastModelsSyncedAt?: number
}

export interface StoredConfig {
  providers: ProviderConfig[]
  /** 当前激活的 Provider id */
  activeProviderId: string | null
}

/** 给 llm/openai-provider 用的接入配置 */
export interface ActiveLlmConfig {
  provider: string
  apiKey: string
  model: string
  endpoint: string
  baseUrl: string
  configured: boolean
}

export interface ProviderPresetModel {
  name: string
  role: string
  description: string
}

export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  accent: string
  summary: string
  bestFor: string[]
  models: ProviderPresetModel[]
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  status?: number
}

export interface DiscoveredModel {
  name: string
  description?: string
  role?: string
}

export interface ModelDiscoveryResult {
  ok: boolean
  message: string
  models: DiscoveredModel[]
  status?: number
}
