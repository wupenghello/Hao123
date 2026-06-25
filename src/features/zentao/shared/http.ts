/**
 * 禅道 HTTP 核心（鉴权 + 底层请求，业务无关）
 *
 * 职责：屏蔽 URL 拼接、sessionID 注入、禅道特有的「二次 JSON 解析」、错误归一化，
 *      并提供会话/登录两个鉴权接口。任务、Bug 的业务接口分别建立在 task/api.ts、bug/api.ts，
 *      它们都复用这里的 request() 与 toArray()。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 接口形态（pm.esteel.tech 实测 2026-06：12.5.3 专业版，**PATH_INFO 路由模式**）：
 *
 * 该禅道开启了 URL 重写，请求形态是「模块-方法.json」而非 ?m=&f=&t=json：
 *   1) 取会话    GET  api-getsessionid.json
 *               → data.sessionID（data 是被二次编码的 JSON 字符串）
 *   2) 登录      GET  user-login.json?zentaosid=&account=&password=
 *               → 成功后该会话即为登录态；user 直接在**外层**（非 data.user）
 *   3) 我的任务  GET  my-task-<type>.json?zentaosid=（见 task/api.ts）
 *   4) 我的Bug   GET  my-bug-<type>.json?zentaosid=（见 bug/api.ts）
 *
 * ⚠️ PATH_INFO 模式下，子页 type 必须嵌在路径里（my-task-finishedBy.json），
 *    若作为 query（?type=xxx）会被忽略、始终返回默认 assignedTo 页。
 *
 * 为何用 zentaosid URL 参数而非 Cookie：
 *   开发代理（vite proxy）跨域转发时浏览器对 Set-Cookie 的处理极易丢失/不回传，
 *   禅道原生支持把 sessionID 作为 URL 参数传递，用它可彻底绕开 Cookie 难题。
 *
 * 禅道返回值怪癖：
 *   外层 { status:'success'|'failed', data:... }，其中 data 是「再次被 JSON 编码的字符串」，
 *   需要二次 JSON.parse。这些都在本文件内消化，对外只给干净的强类型结果。
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { ZentaoEnvelope, SessionData, ZentaoUser } from './types'

/** 走 vite 代理 /zentao → 禅道服务器（见 vite.config.ts） */
const BASE = '/zentao'

/**
 * 统一错误类型
 * code: 'no-key'/'network'/'parse'/'auth'/'http' 等本地归类，便于 store 分支处理
 */
export class ZentaoApiError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZentaoApiError'
    this.code = code
  }
}

export interface RequestOptions {
  /** 传入 AbortSignal 以支持取消请求 */
  signal?: AbortSignal
}

/** 把禅道 message（可能是字符串/数组/字段映射）压平成一行文案 */
function flattenMessage(msg: ZentaoEnvelope['message']): string {
  if (!msg) return ''
  if (typeof msg === 'string') return msg
  if (Array.isArray(msg)) return msg.join('；')
  // { field: [msg, ...] } 形式
  return Object.values(msg).flat().join('；')
}

/**
 * 把「以 id 为 key 的对象」或「数组」统一成数组。
 * 禅道分页列表常返回 { '12': {...}, '34': {...} }，这里抹平差异。
 */
export function toArray<T>(v: Record<string, T> | T[] | undefined | null): T[] {
  if (!v) return []
  if (Array.isArray(v)) return v
  return Object.values(v)
}

/**
 * 底层请求：拼 PATH_INFO 风格 URL（模块-方法.json）→ 注入 zentaosid →
 * 解析外层 → 对 data 做「二次 JSON 解析」→ 错误归一化。
 *
 * 返回**完整外层对象**（含 status / data / 可能的外层 user），
 * 各方法自行取所需字段——因登录接口的 user 在外层而非 data 内。
 *
 * @param route  形如 'api-getsessionid' / 'my-task' 的路由（不含 .json 与查询串）
 * @param sid    会话 ID（可空，仅 getSessionID 阶段为空）
 * @param extra  追加查询参数
 */
export async function request(
  route: string,
  sid: string | null,
  extra: Record<string, string> = {},
  opts: RequestOptions = {},
): Promise<ZentaoEnvelope & Record<string, unknown>> {
  const params = new URLSearchParams({ ...extra })
  if (sid) params.set('zentaosid', sid)
  const qs = params.toString()
  const url = `${BASE}/${route}.json${qs ? `?${qs}` : ''}`

  let res: Response
  try {
    res = await fetch(url, {
      signal: opts.signal,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw new ZentaoApiError('network', '网络请求失败，请检查禅道地址与网络连接')
  }

  if (!res.ok) {
    // 401/403 多为会话过期（服务端直接返回状态码而非 HTML 重定向），
    // 归为 'auth' 让上层 withSession 触发一次重新登录重试，而非直接硬报错
    const code = res.status === 401 || res.status === 403 ? 'auth' : 'http'
    throw new ZentaoApiError(code, `禅道服务返回 HTTP ${res.status}`)
  }

  // 未登录时禅道会吐 HTML 重定向到登录页（self.location=...），这里做容错
  const text = await res.text()
  let env: ZentaoEnvelope & Record<string, unknown>
  try {
    env = JSON.parse(text) as ZentaoEnvelope & Record<string, unknown>
  } catch {
    throw new ZentaoApiError(
      'auth',
      '禅道返回内容无法解析（会话失效，已被重定向到登录页）',
    )
  }

  const status = env.status ?? env.result
  if (status && status !== 'success') {
    const msg = flattenMessage(env.message) || '禅道接口返回失败'
    // 仅「会话/登录失效」类失败归为 auth（触发重登重试）；
    // 「无操作权限」等业务级失败不应触发重登——重登后依旧无权限，徒增请求且掩盖真实原因
    const isAuth = /未登录|请登录|登录超时|登录失效|会话|session|not\s*logged|please\s*login/i.test(msg)
    throw new ZentaoApiError(isAuth ? 'auth' : 'biz', msg)
  }

  // data 多为「被字符串化的 JSON」，做二次解析（解析后写回 env.data）
  if (typeof env.data === 'string') {
    try {
      env.data = JSON.parse(env.data)
    } catch {
      // 不是 JSON 字符串就原样保留（极少数纯文本场景）
    }
  }
  return env
}

/**
 * 鉴权接口（会话 + 登录），任务/Bug 业务接口的共同前置。
 * store 层（shared/session.ts）会编排这套流程并缓存 sessionID。
 */
export const authApi = {
  /**
   * 取会话 ID。每次「新建会话」时调用一次，得到的 sessionID 贯穿后续所有请求。
   */
  async getSessionID(opts?: RequestOptions): Promise<SessionData> {
    const env = await request('api-getsessionid', null, {}, opts)
    const data = env.data as SessionData | undefined
    if (!data?.sessionID) {
      throw new ZentaoApiError('parse', '未能获取禅道会话 ID（getSessionID 返回异常）')
    }
    return data
  },

  /**
   * 账号密码登录。成功后该 sessionID 即为已登录态。
   * 注意：该版本登录成功时 user 在响应**外层**（env.user），而非 env.data。
   * @returns 当前登录用户信息
   */
  async login(
    sid: string,
    account: string,
    password: string,
    opts?: RequestOptions,
  ): Promise<ZentaoUser | null> {
    const env = await request('user-login', sid, { account, password }, opts)
    // 外层 user 优先；个别版本可能落在 data.user / data，全部兜底
    const data = env.data as { user?: ZentaoUser } | ZentaoUser | undefined
    const user =
      (env.user as ZentaoUser | undefined) ??
      (data as { user?: ZentaoUser })?.user ??
      (data as ZentaoUser)
    return user && (user as ZentaoUser).account ? (user as ZentaoUser) : null
  },
}
