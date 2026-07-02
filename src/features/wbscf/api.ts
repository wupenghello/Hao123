/**
 * wbscf-web 本地 dev 服务 · 浏览器侧 HTTP 客户端
 *
 * 浏览器无法直接 spawn 子进程，故由 vite-plugin-wbscf 在 dev server（Node）暴露
 * /wbscf/* 中间件：探测 / 拉起 / 停止 wbscf-web 的 dev 脚本。这里只做状态拉取与拉起触发。
 *
 * 启动有两条路径，都命中同一个中转端点 /wbscf/launch（dev server 侧 ensureStarted 幂等拉起）：
 *   - 用户点击：在点击手势内 window.open 打开中转页（HTML，会轮询端口就绪后自动跳转到应用），
 *     走手势窗口、不被弹窗拦截；
 *   - LLM 工具调用：无用户手势，window.open 会被弹窗拦截，故改为只 fetch 该端点触发服务端拉起
 *     （忽略返回的 HTML），再轮询 /wbscf/services 等 running=true。与点击走同一拉起路径，幂等。
 *
 * 生产构建无 dev server，端点 404 → 调用方 catch 后降级为「不展示 localhost 入口」。
 */
import type { WbscfServicesResponse } from './types'

const BASE = '/wbscf'

/** 拉取全部 wbscf-web dev 服务的状态（含 available / running / booting） */
export async function fetchWbscfServices(): Promise<WbscfServicesResponse> {
  const res = await fetch(`${BASE}/services`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`/wbscf/services -> ${res.status}`)
  return (await res.json()) as WbscfServicesResponse
}

/**
 * 本地 dev 服务的「启动 + 等待就绪 + 跳转」中转页地址：
 * 已在运行时前端直接用应用 URL 打开；否则打开此中转页，由它拉起并跳转。
 */
export function wbscfLaunchUrl(app: string, running: boolean, url: string): string {
  return running ? url : `${BASE}/launch?app=${encodeURIComponent(app)}`
}

/**
 * 触发服务端拉起指定服务并返回最新状态（无需用户手势，供 LLM 工具调用）。
 * 命中与点击相同的 /wbscf/launch 路径（带 json=1，返回 JSON 而非整页 HTML）——
 * dev server 侧 ensureStarted 幂等：已拉起 / 外部已在运行 / 脚本不存在 / 根未配置 都不重复拉起。
 * 非 2xx（未知 app / 拉起抛错）会抛出，让调用方即时失败，而不是傻等超时。
 */
export async function triggerWbscfLaunch(app: string): Promise<WbscfServicesResponse> {
  const res = await fetch(`${BASE}/launch?app=${encodeURIComponent(app)}&json=1`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`/wbscf/launch -> ${res.status}`)
  return (await res.json()) as WbscfServicesResponse
}

/** 跳转前的重型 ready 探测：端口已 listen 后，再等首个 HTTP 响应完成。 */
export async function fetchWbscfReady(app: string): Promise<boolean> {
  const res = await fetch(`${BASE}/ready?app=${encodeURIComponent(app)}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`/wbscf/ready -> ${res.status}`)
  return Boolean(((await res.json()) as { ready?: boolean }).ready)
}

