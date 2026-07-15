/**
 * 一键导入禅道任务 / Bug 到本地待办 —— 纯函数辅助层
 *
 * 页面级胶水逻辑（同时依赖 @/features/zentao 与 @/features/local-tasks 两个互不耦合的
 * 特性模块），刻意不放进任一模块内部，避免两模块产生反向依赖。
 */
import { hasDeadline, htmlToText, type ZentaoBug, type ZentaoTask } from '@/features/zentao'
import type { LocalTaskInput, LocalTaskPri } from '@/features/local-tasks'

export type ZentaoLinkKind = 'task' | 'bug'

/** 从禅道链接（或裸路径片段）里识别类型与 id；识别不出返回 null */
export function parseZentaoLink(raw: string): { kind: ZentaoLinkKind; id: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let pathish = trimmed
  try {
    pathish = new URL(trimmed).pathname
  } catch {
    // 非完整 URL（缺协议等）：直接在原字符串里找
  }
  const m = pathish.match(/(task|bug)-view-(\d+)/i)
  if (!m) return null
  return { kind: m[1].toLowerCase() as ZentaoLinkKind, id: m[2] }
}

/** 禅道优先级（1~4，可能带小数/越界）归一化为本地待办的优先级枚举 */
function toLocalPri(raw: string | number | undefined): LocalTaskPri {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 3
  return Math.min(4, Math.max(1, Math.round(n))) as LocalTaskPri
}

/** 截止日期：过滤掉禅道的「无」占位值 '0000-00-00' */
function toLocalDeadline(raw: string | undefined): string | undefined {
  return raw && hasDeadline(raw) ? raw : undefined
}

/** 拼接正文（HTML→纯文本）与来源链接，作为本地待办的备注 */
function buildNote(bodyHtml: string, kind: ZentaoLinkKind, id: string, sourceUrl: string): string {
  const body = htmlToText(bodyHtml).trim()
  const sourceLine = `— 来源禅道${kind === 'task' ? '任务' : 'Bug'} #${id}：${sourceUrl}`
  return body ? `${body}\n\n${sourceLine}` : sourceLine
}

export function zentaoTaskToLocalInput(task: ZentaoTask, sourceUrl: string): LocalTaskInput {
  return {
    title: task.name,
    note: buildNote(task.desc || task.storySpec || '', 'task', task.id, sourceUrl),
    pri: toLocalPri(task.pri),
    deadline: toLocalDeadline(task.deadline),
  }
}

export function zentaoBugToLocalInput(bug: ZentaoBug, sourceUrl: string): LocalTaskInput {
  return {
    title: bug.title,
    note: buildNote(bug.steps || '', 'bug', bug.id, sourceUrl),
    pri: toLocalPri(bug.pri),
    deadline: toLocalDeadline(bug.deadline),
  }
}
