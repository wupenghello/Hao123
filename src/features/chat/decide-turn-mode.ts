/**
 * Chat 助手 · 回合渲染形态判定（纯函数）
 *
 * 对话类型决定渲染形态：answer-first（默认）/ report（调研）/ taskflow（操作+审批）。
 * 判定规则硬编码、零 LLM、可单测锁定。用户可在 Turn 卡上手动切换形态兜底。
 */
import type { Turn } from './turns'

export type TurnMode = 'answer-first' | 'report' | 'taskflow'

/** 写操作工具前缀（触发 taskflow 形态）——只列真正的写工具，读工具（local__list 等）不算 */
const WRITE_TOOLS = new Set([
  'git__checkout', 'git__fetch', 'git__pull', 'git__push', 'git__add', 'git__commit', 'git__branch',
  'local__create', 'local__update', 'local__complete', 'local__delete',
  'wbscf__launch', 'claude__launch',
])

export function decideTurnMode(turn: Pick<Turn, 'steps' | 'answer'>): TurnMode {
  const steps = turn.steps ?? []

  // 有待审批 / 写操作 → 操作台形态（审批在过程中，结论在上）
  if (steps.some((s) => s.approval || s.status === 'pending')) return 'taskflow'
  if (steps.some((s) => WRITE_TOOLS.has(s.tool))) return 'taskflow'

  // 外部调研 / 网页读取且长回答 → 报告形态
  const research = steps.some((s) => s.tool.startsWith('reach__') || s.tool.startsWith('webdoc__'))
  if (research && turn.answer.length >= 2000) return 'report'
  if (steps.length > 2 && turn.answer.length >= 2000) return 'report'

  return 'answer-first'
}
