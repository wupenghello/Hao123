import { computed, ref } from 'vue'

const APP_KEY_PREFIX = 'hao123-'
const CHAT_HISTORY_KEY = 'hao123-chat-history'
const BRIEFING_KEY = 'hao123-morning-briefing'
const INSIGHT_KEY = 'hao123-inbox-insight'
const CHAT_PANEL_SIZE_KEY = 'hao123-chat-panel-size'

const ASSUMED_LOCAL_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024
const WARNING_RATIO = 0.74
const CLEANUP_RATIO = 0.82
const TARGET_RATIO = 0.68
const CHAT_HISTORY_SOFT_BYTES = 900 * 1024
const CHAT_HISTORY_TARGET_BYTES = 650 * 1024
const CHAT_HISTORY_HARD_TARGET_BYTES = 360 * 1024
const MIN_CHAT_MESSAGES = 24
const CHECK_INTERVAL_MS = 60_000
const NOTICE_TTL_MS = 9_000
const WARNING_THROTTLE_MS = 10 * 60_000

export type StorageNoticeKind = 'warning' | 'cleaned' | 'error'

export interface StorageUsage {
  bytes: number
  quotaBytes: number
  ratio: number
  appBytes: number
}

export interface StorageNotice {
  id: number
  kind: StorageNoticeKind
  title: string
  detail: string
  usage: StorageUsage
  freedBytes?: number
}

interface CleanupResult {
  freedBytes: number
  actions: string[]
}

interface StoredChatMessage {
  role?: string
  content?: string
  ts?: number
  images?: unknown
  activities?: unknown
  ui?: unknown
  [key: string]: unknown
}

const usageState = ref<StorageUsage>(emptyUsage())
const notices = ref<StorageNotice[]>([])

let noticeSeq = 0
let monitorStarted = false
let monitorTimer: ReturnType<typeof window.setInterval> | null = null
let lastWarningAt = 0

function emptyUsage(): StorageUsage {
  return {
    bytes: 0,
    quotaBytes: ASSUMED_LOCAL_STORAGE_QUOTA_BYTES,
    ratio: 0,
    appBytes: 0,
  }
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function entryBytes(key: string, value: string): number {
  return (key.length + value.length) * 2
}

function valueBytes(value: string): number {
  return value.length * 2
}

function estimateLocalStorageUsage(): StorageUsage {
  if (!canUseLocalStorage()) return emptyUsage()

  let bytes = 0
  let appBytes = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      const value = localStorage.getItem(key) ?? ''
      const size = entryBytes(key, value)
      bytes += size
      if (key.startsWith(APP_KEY_PREFIX)) appBytes += size
    }
  } catch {
    return emptyUsage()
  }

  return {
    bytes,
    appBytes,
    quotaBytes: ASSUMED_LOCAL_STORAGE_QUOTA_BYTES,
    ratio: bytes / ASSUMED_LOCAL_STORAGE_QUOTA_BYTES,
  }
}

export function formatStorageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function pushNotice(input: Omit<StorageNotice, 'id'>): void {
  const id = ++noticeSeq
  notices.value = [...notices.value.slice(-2), { ...input, id }]
  window.setTimeout(() => dismissStorageNotice(id), NOTICE_TTL_MS)
}

export function dismissStorageNotice(id: number): void {
  notices.value = notices.value.filter((notice) => notice.id !== id)
}

function isQuotaExceeded(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22 ||
    error.code === 1014
  )
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function cacheGeneratedAt(key: string): number {
  const data = safeJsonParse<{ generatedAt?: number; date?: string }>(localStorage.getItem(key))
  if (typeof data?.generatedAt === 'number') return data.generatedAt
  if (data?.date) {
    const ts = new Date(data.date).getTime()
    if (Number.isFinite(ts)) return ts
  }
  return 0
}

function compactChatHistoryValue(raw: string, targetBytes: number): { value: string; freedBytes: number; changed: boolean } {
  const parsed = safeJsonParse<StoredChatMessage[]>(raw)
  if (!Array.isArray(parsed)) return { value: raw, freedBytes: 0, changed: false }

  let next = parsed.map((msg) => {
    const copy: StoredChatMessage = { ...msg }
    delete copy.images
    return copy
  })

  if (valueBytes(JSON.stringify(next)) > targetBytes) {
    next = next.map((msg, index) => {
      if (index >= next.length - 18) return msg
      const copy: StoredChatMessage = { ...msg }
      delete copy.activities
      delete copy.ui
      if (copy.role === 'tool' && typeof copy.content === 'string' && copy.content.length > 1200) {
        copy.content = `${copy.content.slice(0, 1200)}\n...[stored result trimmed]`
      }
      return copy
    })
  }

  let compacted = JSON.stringify(next)
  while (valueBytes(compacted) > targetBytes && next.length > MIN_CHAT_MESSAGES) {
    next.shift()
    while (next.length > MIN_CHAT_MESSAGES && next[0]?.role !== 'user') next.shift()
    compacted = JSON.stringify(next)
  }

  if (next.length && next[0]?.role !== 'user') {
    const firstUser = next.findIndex((msg) => msg.role === 'user')
    if (firstUser > 0) {
      next = next.slice(firstUser)
      compacted = JSON.stringify(next)
    }
  }

  const changed = compacted !== raw
  return { value: compacted, freedBytes: changed ? Math.max(0, valueBytes(raw) - valueBytes(compacted)) : 0, changed }
}

function compactValueForKey(key: string, value: string, targetBytes = CHAT_HISTORY_TARGET_BYTES) {
  if (key !== CHAT_HISTORY_KEY || valueBytes(value) <= CHAT_HISTORY_SOFT_BYTES) {
    return { value, freedBytes: 0, changed: false }
  }
  return compactChatHistoryValue(value, targetBytes)
}

function setRawLocalStorageItem(key: string, value: string): void {
  localStorage.setItem(key, value)
}

function removeKey(key: string, label: string, result: CleanupResult): void {
  const current = localStorage.getItem(key)
  if (current === null) return
  const before = entryBytes(key, current)
  localStorage.removeItem(key)
  result.freedBytes += before
  result.actions.push(label)
}

function compactStoredChatHistory(targetBytes: number, result: CleanupResult): void {
  const raw = localStorage.getItem(CHAT_HISTORY_KEY)
  if (!raw) return
  const compacted = compactChatHistoryValue(raw, targetBytes)
  if (!compacted.changed) return
  localStorage.setItem(CHAT_HISTORY_KEY, compacted.value)
  result.freedBytes += compacted.freedBytes
  result.actions.push('压缩较早的聊天记录')
}

function cleanupLocalStorageCaches(targetBytes = ASSUMED_LOCAL_STORAGE_QUOTA_BYTES * TARGET_RATIO): CleanupResult {
  const result: CleanupResult = { freedBytes: 0, actions: [] }
  if (!canUseLocalStorage()) return result

  compactStoredChatHistory(CHAT_HISTORY_TARGET_BYTES, result)

  let usage = estimateLocalStorageUsage()
  if (usage.bytes <= targetBytes) return result

  const removableCaches = [
    { key: INSIGHT_KEY, label: '清理收件箱洞察缓存', at: cacheGeneratedAt(INSIGHT_KEY) },
    { key: BRIEFING_KEY, label: '清理每日晨报缓存', at: cacheGeneratedAt(BRIEFING_KEY) },
    { key: CHAT_PANEL_SIZE_KEY, label: '清理聊天面板尺寸缓存', at: 0 },
  ]
    .filter((item) => localStorage.getItem(item.key) !== null)
    .sort((a, b) => a.at - b.at)

  for (const cache of removableCaches) {
    if (usage.bytes <= targetBytes) break
    removeKey(cache.key, cache.label, result)
    usage = estimateLocalStorageUsage()
  }

  if (usage.bytes > targetBytes) {
    compactStoredChatHistory(CHAT_HISTORY_HARD_TARGET_BYTES, result)
  }

  return result
}

function noteCleanup(result: CleanupResult, usage: StorageUsage): void {
  if (!result.freedBytes) return
  pushNotice({
    kind: 'cleaned',
    title: '已清理本地缓存',
    detail: `${result.actions.join('、')}，释放 ${formatStorageBytes(result.freedBytes)}，当前占用 ${formatStorageBytes(usage.bytes)}。`,
    freedBytes: result.freedBytes,
    usage,
  })
}

function maybeWarn(usage: StorageUsage): void {
  const now = Date.now()
  if (usage.ratio < WARNING_RATIO || now - lastWarningAt < WARNING_THROTTLE_MS) return
  lastWarningAt = now
  pushNotice({
    kind: 'warning',
    title: '本地存储空间偏高',
    detail: `当前占用约 ${formatStorageBytes(usage.bytes)}，任务等用户数据不会自动删除；可再生缓存会在接近上限时自动清理。`,
    usage,
  })
}

export function checkLocalStorageHealth(): StorageUsage {
  let usage = estimateLocalStorageUsage()
  usageState.value = usage

  if (usage.ratio >= CLEANUP_RATIO) {
    const result = cleanupLocalStorageCaches()
    usage = estimateLocalStorageUsage()
    usageState.value = usage
    noteCleanup(result, usage)
  }

  maybeWarn(usage)
  return usage
}

export function setLocalStorageItem(key: string, value: string): boolean {
  if (!canUseLocalStorage()) return false

  const compacted = compactValueForKey(key, value)
  const writeValue = compacted.value

  try {
    setRawLocalStorageItem(key, writeValue)
    if (compacted.changed) {
      pushNotice({
        kind: 'cleaned',
        title: '已压缩聊天记录',
        detail: `保留最近对话，释放约 ${formatStorageBytes(compacted.freedBytes)}。`,
        freedBytes: compacted.freedBytes,
        usage: estimateLocalStorageUsage(),
      })
    }
    checkLocalStorageHealth()
    return true
  } catch (error) {
    if (!isQuotaExceeded(error)) {
      console.warn(`[storage-health] Failed to write "${key}"`, error)
      return false
    }
  }

  const cleanup = cleanupLocalStorageCaches()
  try {
    setRawLocalStorageItem(key, writeValue)
    const usage = checkLocalStorageHealth()
    noteCleanup(cleanup, usage)
    return true
  } catch (error) {
    if (key === CHAT_HISTORY_KEY) {
      const smaller = compactChatHistoryValue(writeValue, CHAT_HISTORY_HARD_TARGET_BYTES)
      try {
        setRawLocalStorageItem(key, smaller.value)
        const usage = checkLocalStorageHealth()
        pushNotice({
          kind: 'cleaned',
          title: '已大幅压缩聊天记录',
          detail: `浏览器存储空间不足，已只保留最近对话，当前占用 ${formatStorageBytes(usage.bytes)}。`,
          freedBytes: smaller.freedBytes,
          usage,
        })
        return true
      } catch {
        // Fall through to the error notice below.
      }
    }

    const usage = estimateLocalStorageUsage()
    usageState.value = usage
    pushNotice({
      kind: 'error',
      title: '本地存储写入失败',
      detail: `浏览器 localStorage 已接近上限，自动清理后仍无法写入 "${key}"。请手动清理旧聊天或浏览器站点数据。`,
      usage,
    })
    console.warn(`[storage-health] Quota exceeded while writing "${key}"`, error)
    return false
  }
}

export function startStorageHealthMonitor(): void {
  if (monitorStarted || !canUseLocalStorage()) return
  monitorStarted = true
  checkLocalStorageHealth()
  monitorTimer = window.setInterval(checkLocalStorageHealth, CHECK_INTERVAL_MS)
  window.addEventListener('storage', checkLocalStorageHealth)
}

export function stopStorageHealthMonitor(): void {
  if (!monitorStarted) return
  monitorStarted = false
  if (monitorTimer !== null) window.clearInterval(monitorTimer)
  monitorTimer = null
  window.removeEventListener('storage', checkLocalStorageHealth)
}

export function useStorageHealth() {
  const usageText = computed(() => {
    const usage = usageState.value
    return `${formatStorageBytes(usage.bytes)} / ${formatStorageBytes(usage.quotaBytes)}`
  })

  return {
    notices,
    usage: usageState,
    usageText,
    check: checkLocalStorageHealth,
    dismiss: dismissStorageNotice,
  }
}

export { default as StorageHealthToastHost } from './components/StorageHealthToastHost.vue'
