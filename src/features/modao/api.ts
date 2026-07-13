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
/**
 * 从 HTML 文本中提取公开墨刀原型链接（modao.cc/proto/<token> 或带 access_token 的分享链接）。
 * 优先解析 <a href>（禅道富文本里墨刀链接通常是超链接），再用正则兜底裸链接；
 * 过 isModaoPrototypeUrl 校验后去重，供「原型深读」从任务描述/需求规格里找原型外链。
 */
export function extractModaoUrls(html?: string): string[] {
  if (!html) return []
  const found: string[] = []
  // modao 原型链接本身为纯 ASCII、不会以标点结尾；裸链接（正则兜底）常尾随句号 /
  // 逗号 / 右括号 / 引号 / CJK 标点或汉字，剥离后再过 isModaoPrototypeUrl，避免
  // token 被尾随字符污染导致后端 404。对 <a href> 通常无影响（href 本身就是干净的）。
  const TRAILING_JUNK = /(?:[^\x21-\x7e]|[.,;:!?)\]}"'。，；：！？）】》」』""'…])+$/
  const push = (raw: string) => {
    const u = raw.trim().replace(TRAILING_JUNK, '')
    if (u && isModaoPrototypeUrl(u) && !found.includes(u)) found.push(u)
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('a[href]').forEach((a) => push(a.getAttribute('href') || ''))
  } catch {
    // DOMParser 不可用时跳过，走正则兜底
  }
  const matches = html.match(/https?:\/\/[^\s"'<>]*modao\.cc[^\s"'<>]*/gi)
  if (matches) matches.forEach(push)
  return found
}
