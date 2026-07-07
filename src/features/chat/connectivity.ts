/**
 * Chat 助手 · LLM 连通性状态层
 *
 * 解决「连不上大模型」时缺乏统一提示的问题：把网络可达性从「等用户发一条消息等 7 秒重试
 * 再看红色错误条」的被动发现，变成「全局可观测 + 自动恢复 + 各 ambient 入口协同降级」的
 * 主动状态。
 *
 * 设计要点：
 *  - **复用真实调用结果作为信号**（不空探测）：provider 每次成功 → markSuccess；
 *    每次网络类错误 → markUnreachable。避免每次进站都烧 token 探活。
 *  - **只在需要时主动 probe**：失败后进入 unreachable，启动指数退避自动 probe；
 *    用户点「重试」也立即 probe 一次。probe 用最小 ping（max_tokens:1）+ 5s 超时，
 *    不走 fetchWithRetry 的 1/2/4s 三次重试，保证快速反馈。
 *  - **离线优先**：navigator.onLine===false 时直接 unreachable('offline')，跳过任何
 *    网络请求；监听 window online/offline 事件自动翻转。
 *  - **恢复广播**：ambient 模块（晨报 / 洞察 / welcome-guide）通过 onRecover 注册回调，
 *    连通恢复时自动续生成，无需用户干预。
 *  - **不持久化**：连通性是瞬态，纯内存（持久化反而下次进站看到陈旧的「不可用」）。
 *
 * 状态分层语义（与 store.error 区分）：
 *  - store.error     —— 真·业务错误（解析失败、工具异常、4xx 鉴权），红色条
 *  - connectivity    —— 网络可达性（healthy/checking/unreachable），琥珀条 / Launcher 色点
 */
import { reactive, readonly, computed } from 'vue'
import { getActiveConfig, getClientAuthBody } from '@/features/model-config'

/** 连通性根因（决定文案与修法指引） */
export type ConnectivityReason =
  | 'offline' // 浏览器离线
  | 'proxy' // dev 代理 / TodayOps dev server 不可达（fetch 直接 TypeError）
  | 'provider' // 提供方返回 5xx / 超时 / 网关错误
  | 'auth' // 401 / 403 鉴权失败
  | 'unknown'

export type ConnectivityStatus = 'healthy' | 'checking' | 'unreachable'

interface ConnectivityState {
  status: ConnectivityStatus
  reason: ConnectivityReason | null
  /** 给用户看的一句中文说明（含行动指引） */
  message: string | null
  lastSuccessAt: number | null
  lastErrorAt: number | null
  /** 自动重试是否在跑（用于 UI 显示「正在重试…」） */
  autoRetrying: boolean
}

const state = reactive<ConnectivityState>({
  status: 'healthy',
  reason: null,
  message: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  autoRetrying: false,
})

/** 把异常归类为连通性根因（网络/离线/proxy/provider/auth）；非网络错误返回 null（不归连通性管） */
export function classifyError(e: unknown): ConnectivityReason | null {
  if ((e as Error)?.name === 'AbortError') return null // 用户主动中止，不算连通性问题
  const msg = (e as Error)?.message || String(e)

  // 离线（开发者工具 / 系统断网）
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'

  // 鉴权类
  if (/401|403|Unauthorized|Forbidden/.test(msg)) return 'auth'

  // dev 代理 / dev server 不可达：fetch 在网络层直接失败（没有 Response）
  if (/Failed to fetch|NetworkError|fetch failed|ECONNRESET|ETIMEDOUT|ERR_NETWORK/i.test(msg)) {
    return 'proxy'
  }

  // 提供方错误：上游 5xx / 网关
  if (/(5\d\d|gateway|bad gateway|service unavailable|timeout|超时)/i.test(msg)) return 'provider'

  // 瞬态可重试的网络抖动也算 provider 不可达
  return null
}

/** 根因 → 用户文案（含行动指引） */
function messageForReason(reason: ConnectivityReason): string {
  const provider = getActiveConfig().provider || '当前模型服务'
  switch (reason) {
    case 'offline':
      return '网络已断开，恢复后会自动重连'
    case 'proxy':
      return '无法连接 TodayOps 开发服务器，请确认 npm run dev 正在运行'
    case 'provider':
      return `小吴的大脑（${provider}）暂时没响应，正在自动重试`
    case 'auth':
      return 'LLM 认证失败，API Key 已过期或无效，请在模型配置面板中更新 Key'
    default:
      return '暂时连不上小吴，正在自动重试'
  }
}

/** 标记一次成功调用 —— 任何 provider 调用成功后调用 */
export function markSuccess(): void {
  const wasDown = state.status === 'unreachable'
  state.status = 'healthy'
  state.reason = null
  state.message = null
  state.lastSuccessAt = Date.now()
  state.autoRetrying = false
  if (wasDown) fireRecover()
}

/** 清理过期的连通性错误，但不触发恢复回调。用于 4xx 业务错误已证明 dev 代理可达的场景。 */
export function clearConnectivityIssue(): void {
  state.status = 'healthy'
  state.reason = null
  state.message = null
  state.autoRetrying = false
  stopAutoRetry()
}

/** 标记连不上 —— 仅对网络类根因调用（classifyError 非 null） */
export function markUnreachable(reason: ConnectivityReason): void {
  state.status = 'unreachable'
  state.reason = reason
  state.message = messageForReason(reason)
  state.lastErrorAt = Date.now()
  state.autoRetrying = false
  // 离线 / 鉴权失败都不发起自动 probe；网络和上游瞬态错误才重试。
  if (reason === 'proxy' || reason === 'provider' || reason === 'unknown') startAutoRetry()
}

// ============ 自动重试（指数退避） ============

const RETRY_DELAYS = [5_000, 10_000, 30_000] // 5s → 10s → 30s，封顶 30s
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryAttempt = 0

function startAutoRetry(): void {
  if (retryTimer != null) return // 已在重试循环中
  retryAttempt = 0
  scheduleRetry()
}

function scheduleRetry(): void {
  if (state.status === 'healthy') return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return // 离线时等 online 事件触发
  const delay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)]
  retryAttempt++
  state.autoRetrying = true
  retryTimer = setTimeout(() => {
    retryTimer = null
    void probe().catch(() => {
      // probe 失败会内部 markUnreachable，再次 scheduleRetry；此处仅防 unhandled
    })
  }, delay)
}

function stopAutoRetry(): void {
  if (retryTimer != null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  state.autoRetrying = false
}

// ============ probe：最小 ping ============

let probeInFlight: Promise<boolean> | null = null

/**
 * 主动探测一次连通性（用户点「重试」/ 自动重试调用）。
 * 不走 fetchWithRetry 的三次退避——要的是快速反馈。
 * @returns true=已恢复 false=仍不可达
 */
export async function probe(): Promise<boolean> {
  const cfg = getActiveConfig()
  if (!cfg.configured) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    markUnreachable('offline')
    return false
  }
  if (probeInFlight) return probeInFlight

  state.status = state.status === 'unreachable' ? 'unreachable' : 'checking'

  probeInFlight = (async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    try {
      // 最小 ping：max_tokens:1，几乎不烧 token，但能验证 proxy + provider + auth 全链路
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: '1' }],
          max_tokens: 1,
          stream: false,
          ...getClientAuthBody(),
        }),
        signal: controller.signal,
      })
      if (res.ok) {
        markSuccess()
        stopAutoRetry()
        return true
      }
      if (res.status > 0 && res.status < 500 && res.status !== 401 && res.status !== 403) {
        // 429 / 400 等说明 TodayOps dev 代理已经接通，上游也返回了业务错误；
        // 它们不属于“无法连接开发服务器”，应交给具体调用方展示原始错误。
        clearConnectivityIssue()
        return true
      }
      const reason: ConnectivityReason =
        res.status === 401 || res.status === 403 ? 'auth' : res.status >= 500 ? 'provider' : 'proxy'
      markUnreachable(reason)
      scheduleRetry()
      return false
    } catch (e) {
      const reason = (e as Error)?.name === 'AbortError'
        ? 'provider'
        : classifyError(e)
      if (reason) {
        markUnreachable(reason)
        scheduleRetry()
      } else {
        clearConnectivityIssue()
      }
      return false
    } finally {
      clearTimeout(timeout)
      probeInFlight = null
    }
  })()

  return probeInFlight
}

// ============ 恢复回调 ============

const recoverCallbacks = new Set<() => void>()
let fired = false

/** 注册连通恢复回调（ambient 模块用：恢复后续生成）。返回注销函数 */
export function onRecover(cb: () => void): () => void {
  recoverCallbacks.add(cb)
  return () => recoverCallbacks.delete(cb)
}

function fireRecover(): void {
  if (fired) return
  fired = true
  // 重置 fired 让下次断网→恢复仍可触发
  setTimeout(() => (fired = false), 1_000)
  for (const cb of recoverCallbacks) {
    try {
      cb()
    } catch {
      // 单个回调失败不影响其它
    }
  }
}

// ============ 在线/离线监听（模块级单例，import 即生效） ============

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    // 网络恢复：立即探测一次
    if (state.status !== 'healthy') void probe()
  })
  window.addEventListener('offline', () => {
    stopAutoRetry()
    markUnreachable('offline')
  })
}

// ============ composable ============

/** 连通性只读视图（组件消费） */
export function useConnectivity() {
  return {
    state: readonly(state),
    status: computed(() => state.status),
    reason: computed(() => state.reason),
    message: computed(() => state.message),
    autoRetrying: computed(() => state.autoRetrying),
    /** 是否连不上（便捷判断） */
    unreachable: computed(() => state.status === 'unreachable'),
    /** 主动重试（用户点击） */
    retry: () => probe(),
  }
}
