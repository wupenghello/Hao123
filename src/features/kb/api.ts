/**
 * 知识库 / RAG · 浏览器侧 API
 *
 * dev 模式下由 vite-plugin-kb.ts 提供 /rag/*；生产或远程静态模式下若端点不可用，
 * 上层会回退到浏览器内静态检索。
 */
import type { KbHealthResponse, KbSearchResponse } from './types'

const BASE = '/rag'
const REQUEST_TIMEOUT = 6000

function timeoutSignal(ms: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  if (!external) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([timeout, external])
  return timeout
}

async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json()
    if (typeof data?.error === 'string') return data.error
  } catch {
    // ignore non-JSON error body
  }
  return fallback
}

export async function fetchRagSearch(query: string, topK = 5, signal?: AbortSignal): Promise<KbSearchResponse> {
  const params = new URLSearchParams({ q: query, top_k: String(topK) })
  const res = await fetch(`${BASE}/search?${params}`, {
    headers: { accept: 'application/json' },
    signal: timeoutSignal(REQUEST_TIMEOUT, signal),
  })
  if (!res.ok) throw new Error(await responseError(res, `/rag/search -> ${res.status}`))
  return res.json() as Promise<KbSearchResponse>
}

export async function fetchRagHealth(signal?: AbortSignal): Promise<KbHealthResponse> {
  const res = await fetch(`${BASE}/health`, {
    headers: { accept: 'application/json' },
    signal: timeoutSignal(REQUEST_TIMEOUT, signal),
  })
  if (!res.ok) throw new Error(await responseError(res, `/rag/health -> ${res.status}`))
  return res.json() as Promise<KbHealthResponse>
}
