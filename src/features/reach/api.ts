import type {
  ReachGithubRepoResponse,
  ReachReadUrlResponse,
  ReachSearchResponse,
  ReachStatusResponse,
  ReachVideoSummaryResponse,
} from './types'

const BASE = '/agent-reach'
const DEFAULT_TIMEOUT = 45_000
const VIDEO_TIMEOUT = 90_000

function timeoutSignal(ms: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  if (!external) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([timeout, external])
  // 手动 polyfill：同时监听两个信号，任一触发即 abort
  const ctrl = new AbortController()
  const onAbort = () => {
    external.removeEventListener('abort', onAbort)
    timeout.removeEventListener('abort', onAbort)
    ctrl.abort()
  }
  external.addEventListener('abort', onAbort, { once: true })
  timeout.addEventListener('abort', onAbort, { once: true })
  return ctrl.signal
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

async function getJson<T>(path: string, params: Record<string, string>, signal?: AbortSignal, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const qs = new URLSearchParams(params)
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { accept: 'application/json' },
    signal: timeoutSignal(timeout, signal),
  })
  if (!res.ok) throw new Error(await responseError(res, `${BASE}${path} -> ${res.status}`))
  return res.json() as Promise<T>
}

export function fetchReachStatus(signal?: AbortSignal): Promise<ReachStatusResponse> {
  return getJson('/status', {}, signal, 25_000)
}

export function fetchReachSearch(query: string, limit = 5, signal?: AbortSignal): Promise<ReachSearchResponse> {
  return getJson('/search', { query, limit: String(limit) }, signal)
}

export function fetchReachReadUrl(url: string, signal?: AbortSignal): Promise<ReachReadUrlResponse> {
  return getJson('/read-url', { url }, signal)
}

export function fetchReachGithubRepo(repoOrUrl: string, signal?: AbortSignal): Promise<ReachGithubRepoResponse> {
  return getJson('/github-repo', { repo: repoOrUrl }, signal)
}

export function fetchReachVideoSummary(url: string, signal?: AbortSignal): Promise<ReachVideoSummaryResponse> {
  return getJson('/video-summary', { url }, signal, VIDEO_TIMEOUT)
}
