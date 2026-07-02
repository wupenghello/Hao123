import type { ModaoPrototypeReadResponse, ModaoStatusResponse } from './types'
import { MODAO_PROJECT_URL } from './config'

const BASE = '/modao'
const MODAO_REQUEST_TIMEOUT = 60_000

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
    // ignore non-JSON response body
  }
  return fallback
}

export function isModaoPrototypeUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (!/(^|\.)modao\.cc$/i.test(url.hostname)) return false
    const pathToken = url.pathname.match(/\/proto\/([^/]+)/i)?.[1]
    const queryToken = url.searchParams.get('access_token')
    return !!(pathToken || queryToken)
  } catch {
    return false
  }
}

export async function fetchModaoStatus(): Promise<ModaoStatusResponse> {
  const res = await fetch(`${BASE}/status`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(await responseError(res, `/modao/status -> ${res.status}`))
  return res.json() as Promise<ModaoStatusResponse>
}

export async function fetchModaoPrototype(
  url = MODAO_PROJECT_URL,
  signal?: AbortSignal,
): Promise<ModaoPrototypeReadResponse> {
  if (!url) {
    return { enabled: false, ok: false, error: '未配置 VITE_MODAO_PROJECT_URL。' }
  }
  const params = new URLSearchParams({ url })
  const res = await fetch(`${BASE}/read?${params}`, {
    headers: { accept: 'application/json' },
    signal: timeoutSignal(MODAO_REQUEST_TIMEOUT, signal),
  })
  if (!res.ok) throw new Error(await responseError(res, `/modao/read -> ${res.status}`))
  return res.json() as Promise<ModaoPrototypeReadResponse>
}
