import type { WebDocReadResponse } from './types'

const BASE = '/web-doc'
const DEFAULT_REQUEST_TIMEOUT = 12000
const DYNAMIC_PROTOTYPE_TIMEOUT = 60000

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

function isModaoPrototypeUrl(raw: string): boolean {
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

export async function fetchWebDoc(url: string, signal?: AbortSignal): Promise<WebDocReadResponse> {
  const params = new URLSearchParams({ url })
  const requestTimeout = isModaoPrototypeUrl(url)
    ? DYNAMIC_PROTOTYPE_TIMEOUT
    : DEFAULT_REQUEST_TIMEOUT
  const res = await fetch(`${BASE}/read?${params}`, {
    headers: { accept: 'application/json' },
    signal: timeoutSignal(requestTimeout, signal),
  })
  if (!res.ok) throw new Error(await responseError(res, `/web-doc/read -> ${res.status}`))
  return res.json() as Promise<WebDocReadResponse>
}
