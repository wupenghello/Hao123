import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useZentaoSession } from '../shared/session'
import { taskApi } from './api'
import type { ZentaoTask } from './types'

/**
 * 禅道「我的任务」状态层
 *
 * 鉴权（会话/登录/失效重试）全部委托共享的 useZentaoSession.withSession，
 * 本 store 只关心：列表加载 + 详情按 id 懒加载并缓存。
 */
export const useTaskStore = defineStore('zentao-task', () => {
  const session = useZentaoSession()

  // ============ 列表数据 ============
  const tasks = ref<ZentaoTask[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const count = computed(() => tasks.value.length)

  // ============ 「指派给我」列表（首页待办提醒用，assignedTo 维度，与上面 finishedBy 独立）============
  const assigned = ref<ZentaoTask[]>([])
  const assignedLoading = ref(false)
  const assignedError = ref<string | null>(null)
  const assignedCount = computed(() => assigned.value.length)
  let assignedAbort: AbortController | null = null

  // ============ 详情（点击列表项弹窗，按 id 懒加载 + 缓存）============
  const detailOpen = ref(false)
  const detail = ref<ZentaoTask | null>(null)
  const detailLoading = ref(false)
  const detailError = ref<string | null>(null)
  const detailCache = new Map<string, ZentaoTask>()

  let abortController: AbortController | null = null
  let detailAbort: AbortController | null = null

  /**
   * 拉取「我的任务」面板列表：默认就是禅道「指派给我」维度。
   * 显式给大分页（默认仅首页 20 条），确保数量与列表完整。
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
        (sid) => taskApi.myTasks(sid, 'assignedTo', 200, { signal }),
        signal,
      )
      if (signal.aborted) return
      tasks.value = result
      assigned.value = result
      assignedError.value = null
      // 列表刷新后清空详情缓存，避免重开详情时拿到刷新前的陈旧数据
      detailCache.clear()
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      error.value = session.toMessage(e, '任务加载失败')
    } finally {
      if (abortController === controller) {
        loading.value = false
        abortController = null
      }
    }
  }

  function stop() {
    // 中止所有进行中的请求：列表 / 指派给我 / 详情。
    // 详情也要中止——否则 ZentaoInbox 卸载时点击行的详情请求仍会跑完并把陈旧结果写回 store。
    abortController?.abort()
    abortController = null
    assignedAbort?.abort()
    assignedAbort = null
    detailAbort?.abort()
    detailAbort = null
    // 被中止请求的 finally 会因 `xxxAbort === controller` 不成立而跳过复位，
    // 这里主动复位各 loading，避免「中止后 loading 永远卡在 true」。
    loading.value = false
    assignedLoading.value = false
    detailLoading.value = false
  }

  /**
   * 拉取「指派给我」(assignedTo) 的任务，供首页待办提醒展示。
   * 与 load() 各用各的 abortController 与状态，避免组件卸载/刷新时互相误中止。
   */
  async function loadAssigned() {
    assignedAbort?.abort()
    const controller = new AbortController()
    assignedAbort = controller
    const signal = controller.signal

    assignedLoading.value = true
    assignedError.value = null

    try {
      const result = await session.withSession(
        (sid) => taskApi.myTasks(sid, 'assignedTo', 200, { signal }),
        signal,
      )
      if (signal.aborted) return
      assigned.value = result
      tasks.value = result
      error.value = null
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      assignedError.value = session.toMessage(e, '任务加载失败')
    } finally {
      if (assignedAbort === controller) {
        assignedLoading.value = false
        assignedAbort = null
      }
    }
  }

  /**
   * 打开并加载任务详情：立即打开弹窗，命中缓存则秒显，否则发起请求。
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
        (sid) => taskApi.taskDetail(sid, id, { signal }),
        signal,
      )
      if (signal.aborted) return
      detailCache.set(cacheKey, data)
      detail.value = data
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      detailError.value = session.toMessage(e, '任务详情加载失败')
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
    // 共享的配置/登录态（透传给组件，省得组件再引 session）
    configured: computed(() => session.configured),
    loggingIn: computed(() => session.loggingIn),
    // 列表
    tasks,
    count,
    loading,
    error,
    load,
    stop,
    // 「指派给我」列表（首页待办提醒）
    assigned,
    assignedCount,
    assignedLoading,
    assignedError,
    loadAssigned,
    // 详情
    detailOpen,
    detail,
    detailLoading,
    detailError,
    openDetail,
    closeDetail,
  }
})
