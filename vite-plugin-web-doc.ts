import dns from 'node:dns/promises'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestOptions,
  type ServerResponse,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer, isIP } from 'node:net'
import type { Plugin } from 'vite'

const MAX_URL_CHARS = 2048
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_TEXT_CHARS = 6000
const REQUEST_TIMEOUT_MS = 10000
const MODAO_RENDER_TIMEOUT_MS = 35000
const MODAO_RENDER_TEXT_CHARS = 8000

interface ExtractedLink {
  text: string
  url: string
}

interface ModaoEntry {
  id: string
  parent: string
  type?: string
  bunch?: string
  name?: string
  asFolder?: boolean
  device?: string
  w?: number
  h?: number
  deviceW?: number
  deviceH?: number
  zIndex?: number
}

interface ModaoPageSummary {
  id: string
  name: string
  parent: string
  folder: boolean
  depth: number
  path: string[]
}

interface RenderedPageText {
  title: string
  url: string
  bodyText: string
  workspaceText: string
  canvasText: string
  commentsText: string
  buttonTexts: string[]
  canvasCount: number
  iframeCount: number
  imageCount: number
  error?: string
}

interface PublicHttpUrl {
  url: URL
  address: string
  family: 4 | 6
}

interface PublicHttpResponse {
  ok: boolean
  status: number
  url: string
  headers: IncomingHttpHeaders
  body: Uint8Array
  limited: boolean
}

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

function textOfHtml(raw: string): string {
  return decodeHtmlEntities(
    raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
      .replace(/<\/(h[1-6]|p|div|li|tr|section|article|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  )
}

function attr(raw: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i')
  return decodeHtmlEntities(raw.match(re)?.[1] || '').trim()
}

function metaContent(html: string, key: string): string {
  const re = new RegExp(`<meta\\b(?=[^>]*(?:name|property)\\s*=\\s*["']${key}["'])[^>]*>`, 'i')
  const tag = html.match(re)?.[0] || ''
  return attr(tag, 'content')
}

function extractTitle(html: string): string {
  const ogTitle = metaContent(html, 'og:title')
  if (ogTitle) return ogTitle
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''
  return textOfHtml(title)
}

function extractDescription(html: string): string {
  return metaContent(html, 'description') || metaContent(html, 'og:description')
}

function extractLinks(html: string, baseUrl: string): ExtractedLink[] {
  const out: ExtractedLink[] = []
  const seen = new Set<string>()
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      const url = new URL(decodeHtmlEntities(m[1]), baseUrl)
      if (!/^https?:$/.test(url.protocol)) continue
      const text = textOfHtml(m[2]).slice(0, 120) || url.href
      if (seen.has(url.href)) continue
      seen.add(url.href)
      out.push({ text, url: url.href })
      if (out.length >= 20) break
    } catch {
      // ignore invalid href
    }
  }
  return out
}

function isPrivateIpAddress(ip: string): boolean {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1] || ip
  if (isIP(v4) === 4) {
    const parts = v4.split('.').map(Number)
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    )
  }
  const v6 = ip.toLowerCase()
  return v6 === '::1' || v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd')
}

function isBlockedHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')
}

async function resolvePublicHttpUrl(raw: string | URL): Promise<PublicHttpUrl> {
  const rawText = raw instanceof URL ? raw.href : raw
  if (!rawText || rawText.length > MAX_URL_CHARS) throw new Error('URL is empty or too long')
  const url = raw instanceof URL ? raw : new URL(raw)
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http/https URLs are supported')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (isBlockedHost(host)) throw new Error('Local/private hosts are not allowed')
  const literalIp = isIP(host)
  if (literalIp && isPrivateIpAddress(host)) throw new Error('Local/private hosts are not allowed')
  if (literalIp) return { url, address: host, family: literalIp as 4 | 6 }

  const addresses = await dns.lookup(host, { all: true })
  if (!addresses.length || addresses.some((a) => isPrivateIpAddress(a.address))) {
    throw new Error('Local/private hosts are not allowed')
  }
  const picked = addresses[0]
  return { url, address: picked.address, family: picked.family as 4 | 6 }
}

async function assertPublicHttpUrl(raw: string | URL): Promise<URL> {
  return (await resolvePublicHttpUrl(raw)).url
}

async function readLimitedBody(res: IncomingMessage): Promise<{ bytes: Uint8Array; limited: boolean }> {
  const contentLength = Number(res.headers['content-length'] || 0)
  if (contentLength > MAX_RESPONSE_BYTES) {
    res.destroy()
    throw new Error('Response is too large')
  }
  const chunks: Buffer[] = []
  let total = 0
  let limited = false

  try {
    for await (const chunk of res) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += value.length
      if (total > MAX_RESPONSE_BYTES) {
        const keep = value.slice(0, Math.max(0, value.length - (total - MAX_RESPONSE_BYTES)))
        if (keep.length) chunks.push(keep)
        limited = true
        res.destroy()
        break
      }
      chunks.push(value)
    }
  } catch (e) {
    if (!limited) throw e
  }

  const body = Buffer.concat(chunks)
  return { bytes: new Uint8Array(body.buffer, body.byteOffset, body.byteLength), limited }
}

function isTextual(contentType: string): boolean {
  return (
    /^text\//i.test(contentType) ||
    /\/(?:json|xml|xhtml\+xml|javascript)/i.test(contentType)
  )
}

function headerValue(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0] || ''
  return value ? String(value) : ''
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status)
}

function requestPinnedPublic(resolved: PublicHttpUrl, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'))
      return
    }

    const { url, address, family } = resolved
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const options: RequestOptions & { servername?: string } = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        accept: 'text/html, text/plain, application/json;q=0.8, */*;q=0.2',
        'user-agent': 'TodayOps-WebDocReader/1.0',
        host: url.host,
      },
      lookup(_hostname, lookupOptions, callback) {
        if (typeof lookupOptions === 'object' && lookupOptions?.all) {
          callback(null, [{ address, family }])
          return
        }
        callback(null, address, family)
      },
    }
    if (url.protocol === 'https:') options.servername = url.hostname

    const req = request(options, (res) => {
      signal.removeEventListener('abort', onAbort)
      resolve(res)
    })
    const onAbort = () => req.destroy(new Error('Aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    req.on('timeout', () => req.destroy(new Error('Request timed out')))
    req.on('error', (error) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    req.end()
  })
}

function modaoTokenFromUrl(url: URL): string | null {
  if (!/(^|\.)modao\.cc$/i.test(url.hostname)) return null
  const pathToken = url.pathname.match(/\/proto\/([^/]+)/i)?.[1]
  const queryToken = url.searchParams.get('access_token')
  const token = pathToken || queryToken
  return token && /^[a-zA-Z0-9_-]{8,80}$/.test(token) ? token : null
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    signal,
    redirect: 'error',
    headers: {
      accept: 'application/json',
      'user-agent': 'TodayOps-WebDocReader/1.0',
    },
  })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json()
}

async function fetchPublicWithRedirects(url: URL, signal: AbortSignal, maxRedirects = 5): Promise<PublicHttpResponse> {
  let current = url
  for (let i = 0; i <= maxRedirects; i++) {
    const resolved = await resolvePublicHttpUrl(current)
    const res = await requestPinnedPublic(resolved, signal)
    const status = res.statusCode || 0
    if (!isRedirectStatus(status)) {
      const body = await readLimitedBody(res)
      return {
        ok: status >= 200 && status < 300,
        status,
        url: current.href,
        headers: res.headers,
        body: body.bytes,
        limited: body.limited,
      }
    }
    const location = headerValue(res.headers, 'location')
    if (!location) {
      const body = await readLimitedBody(res)
      return {
        ok: status >= 200 && status < 300,
        status,
        url: current.href,
        headers: res.headers,
        body: body.bytes,
        limited: body.limited,
      }
    }
    res.resume()
    current = (await resolvePublicHttpUrl(new URL(location, current))).url
  }
  throw new Error('Too many redirects')
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function toModaoEntries(raw: unknown): ModaoEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 3 || !isRecord(row[2])) return []
    return [{ id: String(row[0]), parent: String(row[1]), ...(row[2] as Record<string, unknown>) } as ModaoEntry]
  })
}

function outlinePages(entries: ModaoEntry[]): ModaoPageSummary[] {
  const pages = entries
    .filter((e) => e.bunch === 'rbPage')
    .map((e) => ({
      id: e.id,
      name: e.name || e.id,
      parent: e.parent,
      folder: !!e.asFolder,
      depth: 0,
      path: [] as string[],
    }))
  const byId = new Map(pages.map((p) => [p.id, p]))
  const pathOf = (p: ModaoPageSummary, seen = new Set<string>()): string[] => {
    if (seen.has(p.id)) return [p.name]
    seen.add(p.id)
    const parent = byId.get(p.parent)
    return parent ? [...pathOf(parent, seen), p.name] : [p.name]
  }
  return pages.map((p) => {
    const path = pathOf(p)
    return { ...p, depth: Math.max(path.length - 1, 0), path }
  })
}

function groupOutline(pages: ModaoPageSummary[], maxGroups = 12, maxChildren = 24) {
  const children = new Map<string, ModaoPageSummary[]>()
  for (const p of pages) children.set(p.parent, [...(children.get(p.parent) || []), p])
  const roots = [...(children.get('B@main') || []), ...(children.get('@@M') || [])]
  return roots.slice(0, maxGroups).map((root) => ({
    name: root.name,
    id: root.id,
    folder: root.folder,
    children: (children.get(root.id) || [])
      .filter((p) => !p.folder)
      .slice(0, maxChildren)
      .map((p) => ({ id: p.id, name: p.name })),
  }))
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function browserCandidates(): string[] {
  const envPath = process.env.WEB_DOC_BROWSER_PATH
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA || ''
  return [
    envPath || '',
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  ].filter(Boolean)
}

function findBrowserExecutable(): string | null {
  return browserCandidates().find((candidate) => existsSync(candidate)) || null
}

async function waitForJson(url: string, timeoutMs: number): Promise<unknown> {
  const started = Date.now()
  let lastError = ''
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return res.json()
      lastError = `${res.status}`
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Browser debug endpoint did not become ready: ${lastError}`)
}

class CdpClient {
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private waiters = new Map<string, Array<(params: unknown) => void>>()
  private ws: WebSocket

  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } }
      if (msg.id && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(new Error(msg.error.message || 'CDP command failed'))
        else pending.resolve(msg.result)
        return
      }
      if (msg.method) {
        const listeners = this.waiters.get(msg.method) || []
        this.waiters.delete(msg.method)
        listeners.forEach((fn) => fn(msg.params))
      }
    }
    ws.onclose = () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP socket closed'))
      this.pending.clear()
    }
  }

  static async connect(wsUrl: string): Promise<CdpClient> {
    const ws = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('CDP socket failed to open'))
    })
    return new CdpClient(ws)
  }

  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 10000): Promise<unknown> {
    const id = this.nextId++
    const payload = JSON.stringify({ id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP command timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.ws.send(payload)
    })
  }

  waitFor(method: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP event timed out: ${method}`)), timeoutMs)
      const listeners = this.waiters.get(method) || []
      listeners.push((params) => {
        clearTimeout(timer)
        resolve(params)
      })
      this.waiters.set(method, listeners)
    })
  }

  close(): void {
    this.ws.close()
  }
}

async function closeBrowser(proc: ChildProcessWithoutNullStreams | null, profileDir: string): Promise<void> {
  const pid = proc?.pid
  try {
    if (pid && process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else if (pid) {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        proc?.kill('SIGTERM')
      }
    }
  } catch {
    // ignore cleanup failures
  }
  if (profileDir) {
    try {
      await rm(profileDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup failures
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Aborted')
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function renderPublicPageText(url: string, signal?: AbortSignal): Promise<RenderedPageText | null> {
  const browser = findBrowserExecutable()
  if (!browser) return null

  throwIfAborted(signal)
  const port = await getFreePort()
  const profileDir = await mkdtemp(path.join(tmpdir(), 'todayops-webdoc-'))
  let proc: ChildProcessWithoutNullStreams | null = null
  let cdp: CdpClient | null = null
  try {
    proc = spawn(browser, [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--window-size=1365,900',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ], { windowsHide: true, detached: process.platform !== 'win32' })

    throwIfAborted(signal)
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 8000)
    const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then((r) => r.json()) as { webSocketDebuggerUrl?: string }
    if (!created.webSocketDebuggerUrl) throw new Error('CDP page socket was not created')

    throwIfAborted(signal)
    cdp = await CdpClient.connect(created.webSocketDebuggerUrl)
    await cdp.call('Page.enable')
    await cdp.call('Runtime.enable')
    const load = cdp.waitFor('Page.loadEventFired', 18000).catch(() => null)
    await cdp.call('Page.navigate', { url }, 12000)
    await load
    await abortableDelay(7000, signal)
    throwIfAborted(signal)
    const evaluated = await cdp.call('Runtime.evaluate', {
      expression: `(() => {
        const text = (el) => String(el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();
        const all = (sel) => Array.from(document.querySelectorAll(sel)).map(text).filter(Boolean);
        return {
          title: document.title || '',
          url: location.href,
          bodyText: text(document.body).slice(0, ${MODAO_RENDER_TEXT_CHARS}),
          workspaceText: text(document.querySelector('#workspace')).slice(0, ${MODAO_RENDER_TEXT_CHARS}),
          canvasText: text(document.querySelector('#canvas')).slice(0, ${MODAO_RENDER_TEXT_CHARS}),
          commentsText: all('[class*=comment], [class*=Comment], [class*=annotation], [class*=Annotation]').join('\\n').slice(0, 3000),
          buttonTexts: all('button').slice(0, 30),
          canvasCount: document.querySelectorAll('canvas').length,
          iframeCount: document.querySelectorAll('iframe').length,
          imageCount: document.images.length
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    }, 12000) as { result?: { value?: RenderedPageText } }
    return evaluated.result?.value || null
  } catch (e) {
    return {
      title: '',
      url,
      bodyText: '',
      workspaceText: '',
      canvasText: '',
      commentsText: '',
      buttonTexts: [],
      canvasCount: 0,
      iframeCount: 0,
      imageCount: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    cdp?.close()
    await closeBrowser(proc, profileDir)
  }
}

async function readModaoPrototype(url: URL, token: string, signal: AbortSignal): Promise<unknown> {
  const viewMode = url.searchParams.get('view_mode') || 'read_only'
  const screenId = url.searchParams.get('screen') || ''
  const initial = await fetchJson(
    `https://modao.cc/api/flat/web_v1/preview/initial?access_token=${encodeURIComponent(token)}&view_mode=${encodeURIComponent(viewMode)}`,
    signal,
  )
  if (!isRecord(initial)) throw new Error('Modao preview initial response is not an object')

  const projectBasic = isRecord(initial.project_basic) ? initial.project_basic : {}
  const projectMeta = isRecord(initial.project_meta) ? initial.project_meta : {}
  const projectCid = asString(projectBasic.cid)
  const projectMetaCid = asString(projectMeta.cid)
  const entries = projectMetaCid
    ? toModaoEntries(await fetchJson(`https://modao.cc/flpak/ww-p2meta/${encodeURIComponent(projectMetaCid)}`, signal))
    : []
  const pages = outlinePages(entries)
  const pageById = new Map(pages.map((p) => [p.id, p]))
  const canvasByPage = new Map(
    entries
      .filter((e) => e.type === 'rResCanvas')
      .map((e) => [e.parent, {
        id: e.id,
        name: e.name || e.id,
        width: e.w || e.deviceW,
        height: e.h || e.deviceH,
        device: e.device,
      }]),
  )
  const targetPage = screenId ? pageById.get(screenId) : undefined
  const siblings = targetPage
    ? pages
        .filter((p) => p.parent === targetPage.parent && !p.folder)
        .slice(0, 40)
        .map((p) => ({ id: p.id, name: p.name }))
    : []
  const rendered = await renderPublicPageText(url.href, signal)

  return {
    enabled: true,
    ok: true,
    sourceType: 'modao-prototype',
    url: url.href,
    finalUrl: url.href,
    title: asString(initial.projectName) || asString(projectBasic.name) || asString(projectMeta.name),
    project: {
      cid: projectCid || undefined,
      name: asString(projectBasic.name) || asString(initial.projectName) || undefined,
      owner: asString(projectBasic.owner_name) || undefined,
      updatedAt: projectBasic.updated_at,
      width: projectBasic.width,
      height: projectBasic.height,
      device: projectBasic.device,
      screensCount: projectBasic.screens_count,
    },
    targetScreen: targetPage
      ? {
          id: targetPage.id,
          name: targetPage.name,
          path: targetPage.path,
          canvas: canvasByPage.get(targetPage.id),
          siblingScreens: siblings,
        }
      : screenId
        ? { id: screenId, error: 'Screen id was not found in project metadata.' }
        : undefined,
    rendered: rendered
      ? {
          title: rendered.title || undefined,
          finalUrl: rendered.url,
          currentCanvasText: rendered.canvasText || undefined,
          commentsText: rendered.commentsText || undefined,
          visibleText: rendered.workspaceText || rendered.bodyText || undefined,
          buttonTexts: rendered.buttonTexts,
          canvasCount: rendered.canvasCount,
          iframeCount: rendered.iframeCount,
          imageCount: rendered.imageCount,
          error: rendered.error,
        }
      : {
          error:
            'No local Edge/Chrome executable was found for dynamic rendering. Set WEB_DOC_BROWSER_PATH to enable rendered text extraction.',
        },
    outline: groupOutline(pages),
    pageCount: pages.filter((p) => !p.folder).length,
    folderCount: pages.filter((p) => p.folder).length,
    note:
      'Read via Modao public preview metadata plus a temporary no-login headless browser render when available. Metadata gives the project/page tree; rendered.visibleText/currentCanvasText gives text visible after the public page runs JavaScript. Use screenshots for pixel-level layout details.',
  }
}

async function readWebDoc(rawUrl: string): Promise<unknown> {
  const url = await assertPublicHttpUrl(rawUrl)
  const modaoToken = modaoTokenFromUrl(url)
  if (modaoToken) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MODAO_RENDER_TIMEOUT_MS)
    try {
      return await readModaoPrototype(url, modaoToken, controller.signal)
    } finally {
      clearTimeout(timer)
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetchPublicWithRedirects(url, controller.signal)
    const contentType = headerValue(res.headers, 'content-type')
    if (!isTextual(contentType)) {
      return {
        enabled: true,
        ok: res.ok,
        status: res.status,
        url: url.href,
        finalUrl: res.url,
        contentType,
        error: 'The URL did not return textual content.',
      }
    }

    const raw = new TextDecoder('utf-8', { fatal: false }).decode(res.body)
    const isHtml = /html/i.test(contentType) || /<html\b/i.test(raw)
    const text = isHtml ? textOfHtml(raw) : raw.replace(/\s+/g, ' ').trim()
    const usefulText = text.slice(0, MAX_TEXT_CHARS)
    const dynamicHint =
      isHtml && usefulText.length < 160 && /<script\b/i.test(raw)
        ? 'This looks like a JavaScript-rendered page; only the static shell was readable.'
        : undefined

    return {
      enabled: true,
      ok: res.ok,
      status: res.status,
      url: url.href,
      finalUrl: res.url,
      contentType,
      title: isHtml ? extractTitle(raw) : undefined,
      description: isHtml ? extractDescription(raw) : undefined,
      text: usefulText,
      links: isHtml ? extractLinks(raw, res.url || url.href) : [],
      limited: res.limited || text.length > MAX_TEXT_CHARS,
      dynamicHint,
    }
  } finally {
    clearTimeout(timer)
  }
}

export function webDocPlugin(): Plugin {
  return {
    name: 'web-doc-reader',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const reqUrl = req.url || ''
        if (!reqUrl.startsWith('/web-doc/')) return next()

        try {
          const url = new URL(reqUrl, 'http://localhost')
          if (url.pathname !== '/web-doc/read' || req.method !== 'GET') {
            sendJson(res, 404, { error: `Unknown endpoint: ${url.pathname}` })
            return
          }
          const target = url.searchParams.get('url') || ''
          sendJson(res, 200, await readWebDoc(target))
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          sendJson(res, 400, { enabled: true, ok: false, error: message })
        }
      })
    },
  }
}
