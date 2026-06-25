import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useZentaoSession } from '../shared/session'
import { bugApi } from './api'
import type { ZentaoBug } from './types'

/**
 * 禅道「我的 Bug」状态层
 *
 * 鉴权（会话/登录/失效重试）全部委托共享的 useZentaoSession.withSession，
 * 本 store 只关心：列表加载 + 详情按 id 懒加载并缓存。
 */
export const useBugStore = defineStore('zentao-bug', () => {
  const session = useZentaoSession()

  // ============ 列表数据 ============
  const bugs = ref<ZentaoBug[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const count = computed(() => bugs.value.length)

  // ============ 详情（点击列表项弹窗，按 id 懒加载 + 缓存）============
  const detailOpen = ref(false)
  const detail = ref<ZentaoBug | null>(null)
  const detailLoading = ref(false)
  const detailError = ref<string | null>(null)
  const detailCache = new Map<string, ZentaoBug>()

  let abortController: AbortController | null = null
  let detailAbort: AbortController | null = null

  /**
   * 拉取「我的 Bug」。
   * Bug 取「由我解决」(resolvedBy)——该账号 assignedTo 维度通常为空，这个维度才有数据。
   */
  async function load() {
    abortController?.abort()
    const controller = new AbortController()
    abortController = controller
    const signal = controller.signal

    loading.value = true
    error.value = null

    try {
      const result = await session.withSession(
        (sid) => bugApi.myBugs(sid, 'resolvedBy', 500, { signal }),
        signal,
      )
      if (signal.aborted) return
      bugs.value = result
      // 列表刷新后清空详情缓存，避免重开详情时拿到刷新前的陈旧数据
      detailCache.clear()
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      error.value = session.toMessage(e, 'Bug 加载失败')
    } finally {
      if (abortController === controller) {
        loading.value = false
        abortController = null
      }
    }
  }

  function stop() {
    abortController?.abort()
    abortController = null
  }

  /**
   * 打开并加载 Bug 详情：立即打开弹窗，命中缓存则秒显，否则发起请求。
   */
  async function openDetail(id: string | number) {
    detailAbort?.abort()
    const controller = new AbortController()
    detailAbort = controller
    const signal = controller.signal

    detailOpen.value = true
    detailError.value = null

    const cacheKey = String(id)
    const cached = detailCache.get(cacheKey)
    if (cached) {
      detail.value = cached
      detailLoading.value = false // 命中缓存：复位 loading，避免被取消请求的 finally 跳过而残留
      return
    }

    detail.value = null
    detailLoading.value = true
    try {
      const data = await session.withSession(
        (sid) => bugApi.bugDetail(sid, id, { signal }),
        signal,
      )
      if (signal.aborted) return
      detailCache.set(cacheKey, data)
      detail.value = data
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      detailError.value = session.toMessage(e, 'Bug 详情加载失败')
    } finally {
      if (detailAbort === controller) {
        detailLoading.value = false
        detailAbort = null
      }
    }
  }

  /** 关闭详情弹窗 */
  function closeDetail() {
    detailAbort?.abort()
    detailAbort = null
    detailOpen.value = false
    detailLoading.value = false
    detailError.value = null
  }

  return {
    // 共享的配置/登录态
    configured: computed(() => session.configured),
    loggingIn: computed(() => session.loggingIn),
    // 列表
    bugs,
    count,
    loading,
    error,
    load,
    stop,
    // 详情
    detailOpen,
    detail,
    detailLoading,
    detailError,
    openDetail,
    closeDetail,
  }
})
