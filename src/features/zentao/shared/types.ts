/**
 * 禅道共享类型（鉴权 / 会话 / 分页等与具体业务无关的通用结构）
 *
 * 任务、Bug 各自的业务类型分别放在 task/types.ts、bug/types.ts。
 *
 * 禅道返回的 JSON 习惯：外层是 { status, data }，而 data 往往是「再次 JSON 编码的字符串」，
 * 需二次 JSON.parse。本文件只描述解析后的最终结构，二次解析逻辑收敛在 shared/http.ts。
 */

/** 禅道通用响应外壳：data 多为「被字符串化的 JSON」；登录接口的 user 在外层 */
export interface ZentaoEnvelope {
  /** 'success' | 'failed'（部分接口用 result 字段，http.ts 做兼容） */
  status?: string
  result?: string
  /** 失败时的提示信息 */
  message?: string | string[] | Record<string, string[]>
  /** 业务数据：对象或被二次编码的 JSON 字符串 */
  data?: unknown
  /** 登录成功时当前用户直接挂在外层（user-login.json 实测） */
  user?: ZentaoUser
}

/** getSessionID 接口返回的数据体 */
export interface SessionData {
  /** 会话 ID，后续请求以 ?zentaosid=xxx 形式带上 */
  sessionID: string
  /** 会话参数名（通常即 'zentaosid'），按返回值动态使用更稳妥 */
  sessionName?: string
  /** 会话过期窗口（秒），部分版本返回 */
  expiredTime?: string
}

/** 当前登录用户（user-login 成功后返回的 user 对象，按需保留常用字段） */
export interface ZentaoUser {
  id: string
  account: string
  realname: string
  role?: string
  dept?: string
  email?: string
  admin?: string | boolean
}

/** 分页信息 */
export interface ZentaoPager {
  recTotal: number
  recPerPage: number
  pageID: number
  pageTotal?: number
}
