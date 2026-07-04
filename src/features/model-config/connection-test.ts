import type {
  ConnectionTestResult,
  DiscoveredModel,
  ModelDiscoveryResult,
} from './types'

function extractModels(payload: unknown): DiscoveredModel[] {
  const root = payload as { data?: unknown; models?: unknown }
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.models)
        ? root.models
        : []

  const models: DiscoveredModel[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      const name = item.trim()
      if (name) models.push({ name })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const model = item as { id?: unknown; name?: unknown; model?: unknown; description?: unknown; owned_by?: unknown }
    const name = String(model.id ?? model.name ?? model.model ?? '').trim()
    if (!name) continue
    models.push({
      name,
      description: typeof model.description === 'string'
        ? model.description
        : typeof model.owned_by === 'string'
          ? `owned_by: ${model.owned_by}`
          : undefined,
    })
  }
  return models
}

/**
 * 通过 dev 代理测试 OpenAI-compatible chat/completions。
 *
 * 不直接请求 provider baseUrl，避免浏览器 CORS；代理会剥离 api_key/base_url 后转发。
 */
export async function testLlmConnection(input: {
  apiKey: string
  baseUrl: string
  model: string
  signal?: AbortSignal
}): Promise<ConnectionTestResult> {
  const apiKey = input.apiKey.trim()
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  const model = input.model.trim()

  if (!apiKey) return { ok: false, message: '请先填写 API Key' }
  if (!baseUrl) return { ok: false, message: '请先填写 Base URL' }
  if (!model) return { ok: false, message: '请先选择模型' }

  try {
    const res = await fetch('/deepseek/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        base_url: baseUrl,
        model,
        messages: [{ role: 'user', content: '1' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: input.signal,
    })

    if (res.ok) return { ok: true, message: `连接成功，${model} 可以使用`, status: res.status }

    const raw = await res.text().catch(() => '')
    let detail = raw
    try {
      const parsed = JSON.parse(raw) as { error?: string }
      detail = parsed.error || raw
    } catch {
      // ignore
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: `认证失败（${res.status}）：Key 无效或无权限` }
    }
    return { ok: false, status: res.status, message: `返回 ${res.status}：${detail.slice(0, 160)}` }
  } catch (e) {
    return {
      ok: false,
      message: (e as Error)?.name === 'AbortError'
        ? '连接超时，请检查 Base URL 和网络'
        : `网络错误：${(e as Error)?.message || '未知错误'}`,
    }
  }
}

export async function discoverLlmModels(input: {
  apiKey: string
  baseUrl: string
  signal?: AbortSignal
}): Promise<ModelDiscoveryResult> {
  const apiKey = input.apiKey.trim()
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')

  if (!apiKey) return { ok: false, message: '请先填写 API Key', models: [] }
  if (!baseUrl) return { ok: false, message: '请先填写 Base URL', models: [] }

  try {
    const res = await fetch('/deepseek/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, base_url: baseUrl }),
      signal: input.signal,
    })

    const raw = await res.text().catch(() => '')
    let parsed: unknown = null
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      // ignore
    }

    if (!res.ok) {
      const detail = typeof parsed === 'object' && parsed && 'error' in parsed
        ? String((parsed as { error?: unknown }).error || raw)
        : raw
      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: res.status, message: `认证失败（${res.status}）：Key 无效或无权限`, models: [] }
      }
      return { ok: false, status: res.status, message: `返回 ${res.status}：${detail.slice(0, 160)}`, models: [] }
    }

    const models = extractModels(parsed)
      .sort((a, b) => a.name.localeCompare(b.name))

    if (!models.length) return { ok: false, status: res.status, message: '服务端返回了空模型列表', models: [] }
    return { ok: true, status: res.status, message: `已获取 ${models.length} 个可用模型`, models }
  } catch (e) {
    return {
      ok: false,
      message: (e as Error)?.name === 'AbortError'
        ? '获取超时，请检查 Base URL 和网络'
        : `网络错误：${(e as Error)?.message || '未知错误'}`,
      models: [],
    }
  }
}
