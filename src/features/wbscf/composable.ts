/**
 * wbscf-web 本地 dev 服务 · 响应式状态（composable）
 *
 * 状态栏导航（StatusNav）据此渲染 dev 之前的「localhost」入口：
 *   - running=true → 文字绿色，点击直接打开应用 URL；
 *   - 否则         → 点击打开中转页（/wbscf/launch，在点击手势内 window.open，不重复拉起）。
 *
 * 启动反馈（toasts）：点击未运行的服务时，弹一条 toast「正在启动 … localhost:port」，
 * 并对该 app 起一个 ~1.2s 的快轮询，端口就绪后 toast 转为「已就绪」并自动消失；
 * 这样即便用户关掉了新开的「中转页」标签，也能在主界面知道启动进度与结果。
 *
 * 拉起本身由中转页（dev server 的 /wbscf/launch，ensureStarted 幂等）完成；
 * toast 只做观察 + 提示，不重复 spawn。
 *
 * 常规轮询：挂载后每 4s 拉一次状态；页面切到后台时暂停，回到前台立即刷新。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import type { WbscfServiceStatus } from './types'
import { fetchWbscfReady, fetchWbscfServices, wbscfLaunchUrl } from './api'
import { wbscfServices } from './config'
import { LAUNCH_TIMEOUT_MS } from './llm-tools'

const POLL_MS = 4000
/** 启动期间的快轮询间隔（让 toast 尽快从「启动中」翻到「已就绪」） */
const LAUNCH_POLL_MS = 1200
/** toast「已就绪」后停留时长再自动消失 */
const READY_DISMISS_MS = 4500

export interface WbscfToast {
  id: number
  app: string
  label: string
  port: number
  url: string
  state: 'starting' | 'ready' | 'failed'
}

/** toast id 自增（应用运行时，模块级计数即可，无需随机） */
let toastSeq = 0

export function useWbscfServices() {
  const services = ref<WbscfServiceStatus[]>([])
  const toasts = ref<WbscfToast[]>([])
  /** 主轮询：用「自驱递归 setTimeout」而非 setInterval，等上一次 refresh 完再排下一次，
   *  避免慢响应时多轮 tick 叠加并发、乱序写回 services.value（review #10）。 */
  let timer: ReturnType<typeof setTimeout> | null = null
  let refreshing = false
  /** 各 app 的启动快轮询句柄（自驱递归，同样避免叠加）+ 其待消失的 dismiss 句柄（卸载/手动关闭时清理） */
  const launchTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function defOf(app: string) {
    return wbscfServices.find((s) => s.app === app)
  }

  async function refresh(): Promise<void> {
    if (refreshing) return // 已在请求中，跳过本拍，等下一轮（防叠加并发）
    refreshing = true
    try {
      const next = (await fetchWbscfServices()).services
      // 仅在拿到有效数据时更新；失败时保留上一次的状态，避免一次网络抖动把绿字/按钮闪没（review #9）。
      // 注意：首屏还没拿到过数据时仍是空数组，localhost 入口不会提前出现——符合「未就绪即隐藏」。
      services.value = next
    } catch {
      /* dev 未配置 / 生产无 dev server / 网络瞬断：保留现有状态，不清空 */
    } finally {
      refreshing = false
    }
  }

  /** 写/更新某 app 的 toast（同 app 只保留一条；同时清掉它旧的 dismiss 句柄） */
  function upsertToast(app: string, state: WbscfToast['state']): void {
    clearDismiss(app)
    const def = defOf(app)
    const id = ++toastSeq
    toasts.value = [
      ...toasts.value.filter((t) => t.app !== app),
      { id, app, label: def?.label ?? app, port: def?.port ?? 0, url: def?.url ?? '', state },
    ]
  }

  function dismissToast(app: string, delay = 0): void {
    const target = toasts.value.find((t) => t.app === app)
    if (!target) return
    clearDismiss(app)
    const id = target.id
    const h = setTimeout(() => {
      dismissTimers.delete(app)
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, delay)
    dismissTimers.set(app, h)
  }
  function clearDismiss(app: string): void {
    const h = dismissTimers.get(app)
    if (h) {
      clearTimeout(h)
      dismissTimers.delete(app)
    }
  }

  /** 对启动中的 app 起快轮询（自驱递归）：就绪 → toast「已就绪」并停；超时 → toast「失败」 */
  function startLaunchPoll(app: string): void {
    if (launchTimers.has(app)) return
    const startedAt = Date.now()
    const tick = async () => {
      await refresh()
      const s = statusOf(app)
      if (s?.running) {
        try {
          if (await fetchWbscfReady(app)) {
            upsertToast(app, 'ready')
            dismissToast(app, READY_DISMISS_MS)
            stopLaunchPoll(app)
            return
          }
        } catch {
          /* ready 端点抖动时继续轮询 */
        }
      }
      if (Date.now() - startedAt > LAUNCH_TIMEOUT_MS) {
        upsertToast(app, 'failed')
        dismissToast(app, READY_DISMISS_MS * 2)
        stopLaunchPoll(app)
        return
      }
      launchTimers.set(app, setTimeout(tick, LAUNCH_POLL_MS))
    }
    launchTimers.set(app, setTimeout(tick, LAUNCH_POLL_MS))
  }
  function stopLaunchPoll(app: string): void {
    const h = launchTimers.get(app)
    if (h) {
      clearTimeout(h)
      launchTimers.delete(app)
    }
  }

  /** 点击 localhost 入口：手势内打开（运行中→应用 URL，否则→中转页拉起）；
   *  未运行时另起 toast 反馈启动进度（中转页负责真正 spawn，幂等不重复拉） */
  function startOrOpen(app: string): void {
    const def = defOf(app)
    if (!def) return
    const running = statusOf(app)?.running === true
    const target = wbscfLaunchUrl(app, running, def.url)
    if (target) window.open(target, '_blank', 'noopener,noreferrer')
    if (!running) {
      upsertToast(app, 'starting')
      startLaunchPoll(app)
    }
    void refresh()
  }

  /** 手动关闭一条 toast（同时停其快轮询 + 取消待执行的 dismiss） */
  function closeToast(app: string): void {
    stopLaunchPoll(app)
    clearDismiss(app)
    toasts.value = toasts.value.filter((t) => t.app !== app)
  }

  function statusOf(app: string | undefined): WbscfServiceStatus | undefined {
    return app ? services.value.find((s) => s.app === app) : undefined
  }

  function start(): void {
    if (timer) return
    const loop = async () => {
      await refresh()
      timer = setTimeout(loop, POLL_MS)
    }
    timer = setTimeout(loop, POLL_MS)
  }
  function stop(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  function onVisibility(): void {
    if (document.hidden) stop()
    else {
      void refresh()
      start()
    }
  }

  onMounted(() => {
    void refresh()
    start()
    document.addEventListener('visibilitychange', onVisibility)
  })
  onUnmounted(() => {
    stop()
    for (const app of [...launchTimers.keys()]) stopLaunchPoll(app)
    for (const app of [...dismissTimers.keys()]) clearDismiss(app)
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { services, toasts, refresh, startOrOpen, closeToast, statusOf }
}
