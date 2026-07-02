import { computed, ref } from 'vue'
import { fetchModaoPrototype, fetchModaoStatus, isModaoPrototypeUrl } from './api'
import { MODAO_PROJECT_LABEL, MODAO_PROJECT_URL } from './config'
import type { ModaoPrototypeReadResponse, ModaoStatusResponse } from './types'

const open = ref(false)
const detailLoading = ref(false)
const statusLoading = ref(false)
const result = ref<ModaoPrototypeReadResponse | null>(null)
const status = ref<ModaoStatusResponse | null>(null)
const error = ref<string | null>(null)
const selectedScreenId = ref('')
const loadingScreenId = ref('')
const activeTargetKey = ref('project')
const pendingReads = ref(0)

const ready = computed(() => !!status.value?.enabled)
const renderReady = computed(() => !!status.value?.browserRender)
const currentTitle = computed(() => result.value?.title || result.value?.project?.name || MODAO_PROJECT_LABEL)
const loading = computed(() => pendingReads.value > 0)
const projectUrl = MODAO_PROJECT_URL
const projectLabel = MODAO_PROJECT_LABEL

let statusPromise: Promise<void> | null = null
let bootPromise: Promise<void> | null = null
const cache = new Map<string, ModaoPrototypeReadResponse>()
const inflight = new Map<string, Promise<ModaoPrototypeReadResponse | null>>()

function screenUrl(screenId?: string): string {
  if (!screenId) return MODAO_PROJECT_URL
  const url = new URL(MODAO_PROJECT_URL)
  url.searchParams.set('screen', screenId)
  return url.href
}

async function refreshStatus(): Promise<void> {
  if (statusPromise) return statusPromise
  statusLoading.value = true
  statusPromise = fetchModaoStatus()
    .then((data) => {
      status.value = data
    })
    .catch((e) => {
      status.value = { enabled: false, browserRender: false, note: (e as Error)?.message || '墨刀读取不可用' }
    })
    .finally(() => {
      statusLoading.value = false
      statusPromise = null
    })
  return statusPromise
}

async function readTarget(
  key: string,
  target: string,
  signal?: AbortSignal,
): Promise<ModaoPrototypeReadResponse | null> {
  const cached = cache.get(key)
  if (cached) {
    if (activeTargetKey.value === key) {
      result.value = cached
      error.value = cached.ok ? null : cached.error || '墨刀读取失败'
    }
    return cached
  }
  const running = inflight.get(key)
  if (running) return running

  const clean = target
  error.value = null
  if (!clean) {
    error.value = '未配置 VITE_MODAO_PROJECT_URL。'
    return null
  }
  if (!isModaoPrototypeUrl(clean)) {
    error.value = 'VITE_MODAO_PROJECT_URL 不是有效的 modao.cc/proto 原型链接。'
    return null
  }
  pendingReads.value += 1
  const request = fetchModaoPrototype(clean, signal)
    .then((data) => {
      cache.set(key, data)
      if (activeTargetKey.value === key) {
        result.value = data
        selectedScreenId.value = data.targetScreen?.id || selectedScreenId.value
        if (!data.ok) error.value = data.error || '墨刀读取失败'
      }
      return data
    })
    .catch((e) => {
      if (activeTargetKey.value === key) {
        error.value = (e as Error)?.message || '墨刀读取失败'
      }
      return null
    })
    .finally(() => {
      pendingReads.value = Math.max(0, pendingReads.value - 1)
      inflight.delete(key)
    })
  inflight.set(key, request)
  return request
}

async function read(signal?: AbortSignal): Promise<ModaoPrototypeReadResponse | null> {
  selectedScreenId.value = ''
  activeTargetKey.value = 'project'
  return readTarget('project', MODAO_PROJECT_URL, signal)
}

async function readScreen(screenId: string, signal?: AbortSignal): Promise<ModaoPrototypeReadResponse | null> {
  if (!screenId) return read(signal)
  const key = `screen:${screenId}`
  selectedScreenId.value = screenId
  activeTargetKey.value = key
  loadingScreenId.value = screenId
  detailLoading.value = !cache.has(key)
  try {
    return await readTarget(key, screenUrl(screenId), signal)
  } finally {
    if (activeTargetKey.value === key) {
      loadingScreenId.value = ''
      detailLoading.value = false
    }
  }
}

async function boot(): Promise<void> {
  if (bootPromise) return bootPromise
  bootPromise = Promise.all([refreshStatus(), read()])
    .then(() => undefined)
    .finally(() => {
      bootPromise = null
    })
  return bootPromise
}

function clear(): void {
  result.value = null
  error.value = null
  activeTargetKey.value = 'project'
  loadingScreenId.value = ''
  detailLoading.value = false
  cache.clear()
  inflight.clear()
}

function hasScreenCache(screenId: string): boolean {
  return cache.has(`screen:${screenId}`)
}

export function useModaoDashboard() {
  return {
    open,
    projectUrl,
    projectLabel,
    loading,
    detailLoading,
    loadingScreenId,
    statusLoading,
    status,
    result,
    error,
    selectedScreenId,
    ready,
    renderReady,
    currentTitle,
    boot,
    refreshStatus,
    read,
    readScreen,
    hasScreenCache,
    clear,
  }
}
