/**
 * Claude Code 本地启动 · 浏览器侧 API 封装
 */
import type { ClaudeStatusResponse, ClaudeLaunchResponse } from './types'

/**
 * 查询 Claude Code 启动功能是否可用
 * 仅dev模式且配置了VITE_WBSCF_WEB_ROOT时可用
 */
export async function fetchClaudeStatus(): Promise<ClaudeStatusResponse> {
  const res = await fetch('/claude/status', { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Claude 状态查询失败: ${res.status}`)
  return res.json() as Promise<ClaudeStatusResponse>
}

/**
 * 触发启动 Claude Code（新开独立终端窗口，cwd = wbscf-web 根目录）
 */
export async function triggerClaudeLaunch(signal?: AbortSignal): Promise<ClaudeLaunchResponse> {
  const res = await fetch('/claude/launch', {
    headers: { accept: 'application/json' },
    signal,
  })
  // 非 2xx（如生产/preview 的 404 HTML）先抛语义化错误，避免 res.json() 解析 HTML 报 SyntaxError
  if (!res.ok) throw new Error(`/claude/launch -> ${res.status}`)
  return res.json() as Promise<ClaudeLaunchResponse>
}
