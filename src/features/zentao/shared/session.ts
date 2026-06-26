import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { authApi, ZentaoApiError } from './http'
import { ZENTAO_MOCK } from './mock'
import type { ZentaoUser } from './types'

/**
 * 禅道会话状态层（任务、Bug 共用的鉴权核心）
 *
 * 编排：确保登录态（缓存 sessionID）。凭证（账号/密码/地址）来自 .env（VITE_ZENTAO_*），
 * 不在前端持久化明文密码；仅把换来的 sessionID 持久化到 localStorage 复用，
 * 会话失效时自动重新登录一次。
 *
 * 对外提供 withSession(fn)：包一层「取会话 → 执行业务 → 会话失效则强制重登重试一次」，
 * 任务/Bug 的 load/detail 都基于它，避免各自重复这套重试逻辑。
 */
export const useZentaoSession = defineStore('zentao-session', () => {
  // ============ 凭证（来自 .env，构建期注入）============
  const account = import.meta.env.VITE_ZENTAO_ACCOUNT || ''
  const password = import.meta.env.VITE_ZENTAO_PASSWORD || ''
  // 演示模式视为已配置（无需真实地址即可预览）；否则要求三项齐全
  const configured = ZENTAO_MOCK || !!(import.meta.env.VITE_ZENTAO_BASE && account && password)

  // ============ 会话（缓存复用，避免每次进页面都重新登录）============
  const sessionID = useStorage<string>('hao123-zentao-sid', '')

  // ============ 登录/用户态 ============
  const user = ref<ZentaoUser | null>(null)
  const loggingIn = ref(false)
  // 进行中的「取会话+登录」流程，用于并发去重：
  // 首屏 TaskPanel/BugPanel 同时 load() 时，复用同一次登录，避免创建多个服务端会话
  let loginInflight: Promise<string> | null = null

  /** 把任意异常规整成可展示文案 */
  function toMessage(e: unknown, fallback: string): string {
    return e instanceof ZentaoApiError ? e.message : e instanceof Error ? e.message : fallback
  }

  /**
   * 确保有可用登录态：
   *   - 已有缓存 sessionID 且非强制 → 直接复用（请求失败时上层会触发重登）
   *   - 否则 getSessionID → login，缓存新的 sessionID
   *   - 并发调用复用同一次登录流程，避免重复建会话
   * @returns 可用的 sessionID
   */
  async function ensureSession(force = false, signal?: AbortSignal): Promise<string> {
    // 演示模式：不连真实禅道，返回占位会话；后续 api 层会短路到本地假数据
    if (ZENTAO_MOCK) return 'mock-session'
    if (!configured) {
      throw new ZentaoApiError('no-key', '未配置禅道连接信息，请在 .env 中设置 VITE_ZENTAO_BASE / ACCOUNT / PASSWORD')
    }
    if (!force && sessionID.value) return sessionID.value
    // 已有进行中的登录流程：直接复用（force 也复用——并发的强制重登只需一次）
    if (loginInflight) return loginInflight

    loggingIn.value = true
    const run = (async () => {
      const session = await authApi.getSessionID({ signal })
      const loggedUser = await authApi.login(session.sessionID, account, password, { signal })
      if (!loggedUser) {
        throw new ZentaoApiError('auth', '禅道登录失败，请检查账号或密码')
      }
      sessionID.value = session.sessionID
      user.value = loggedUser
      return session.sessionID
    })()
    loginInflight = run
    try {
      return await run
    } finally {
      loggingIn.value = false
      if (loginInflight === run) loginInflight = null
    }
  }

  /**
   * 以登录态执行一段业务请求，并在会话失效（auth/parse）时强制重登一次重试。
   * @param fn      业务函数，入参为可用的 sessionID
   * @param signal  取消信号，透传给 ensureSession 与业务请求
   */
  async function withSession<T>(
    fn: (sid: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let sid = await ensureSession(false, signal)
    try {
      return await fn(sid)
    } catch (e) {
      if (e instanceof ZentaoApiError && (e.code === 'auth' || e.code === 'parse')) {
        sid = await ensureSession(true, signal)
        return await fn(sid)
      }
      throw e
    }
  }

  return {
    configured,
    sessionID,
    user,
    loggingIn,
    ensureSession,
    withSession,
    toMessage,
  }
})
