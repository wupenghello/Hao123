/**
 * Claude Code 本地启动 · 类型定义
 */

/** 服务状态响应 */
export interface ClaudeStatusResponse {
  /** 是否可用（配置了VITE_WBSCF_WEB_ROOT且存在package.json） */
  enabled: boolean
}

/** 启动响应 */
export interface ClaudeLaunchResponse {
  /** 是否启动成功 */
  ok: boolean
  /** 失败时的错误信息 */
  error?: string
}
