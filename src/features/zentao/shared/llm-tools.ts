/**
 * Zentao LLM tools.
 *
 * Read-only function tools for tasks and bugs. The UI keeps the full rich text,
 * while the model receives a compact text version plus extracted external links.
 */
import type { LlmToolDef, LlmTool } from '@/features/chat/llm/types'
import { useZentaoSession } from './session'
import { taskApi } from '../task/api'
import { bugApi } from '../bug/api'
import type { ZentaoTask } from '../task/types'
import type { ZentaoBug } from '../bug/types'

interface ZentaoExternalLink {
  source: string
  text: string
  url: string
}

interface ParsedHtml {
  text?: string
  links: ZentaoExternalLink[]
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

function stripTagsOnly(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function parseHtml(html: string | undefined, source: string, maxLen = 800): ParsedHtml {
  if (!html) return { links: [] }

  const links: ZentaoExternalLink[] = []
  const seen = new Set<string>()
  const addLink = (url: string, text = '') => {
    const cleanUrl = decodeHtmlEntities(url).trim()
    if (!/^https?:\/\//i.test(cleanUrl) || seen.has(cleanUrl)) return
    seen.add(cleanUrl)
    links.push({ source, text: text.trim().slice(0, 120) || cleanUrl, url: cleanUrl })
  }

  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  const withAnchorText = withoutScripts.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (all, attrs: string, body: string) => {
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) return all
    const url = decodeHtmlEntities(href).trim()
    if (!/^https?:\/\//i.test(url)) return all
    const label = stripTagsOnly(body)
    addLink(url, label)
    return label && label !== url ? `${label} (${url})` : url
  })

  const plainText = stripTagsOnly(withAnchorText)
  const urlRe = /https?:\/\/[^\s<>"')\]]+/gi
  let plain: RegExpExecArray | null
  while ((plain = urlRe.exec(plainText))) addLink(plain[0], plain[0])

  return {
    text: plainText ? (plainText.length > maxLen ? `${plainText.slice(0, maxLen)}...` : plainText) : undefined,
    links,
  }
}

function cleanDate(d: string | undefined): string | undefined {
  return d && !/^0000/.test(d) ? d : undefined
}


function collectLinks(groups: ParsedHtml[]): ZentaoExternalLink[] {
  const out: ZentaoExternalLink[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const link of group.links) {
      if (seen.has(link.url)) continue
      seen.add(link.url)
      out.push(link)
      if (out.length >= 12) return out
    }
  }
  return out
}

function summarizeTask(t: ZentaoTask) {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    pri: t.pri,
    project: t.projectName || undefined,
    deadline: cleanDate(t.deadline),
    assignedTo: t.assignedTo || undefined,
  }
}

function summarizeBug(b: ZentaoBug) {
  return {
    id: b.id,
    title: b.title,
    status: b.status,
    severity: b.severity,
    pri: b.pri,
    product: b.productName || undefined,
    assignedTo: b.assignedTo || undefined,
  }
}

function detailTask(t: ZentaoTask) {
  const desc = parseHtml(t.desc, 'task.desc', 1200)
  const storySpec = parseHtml(t.storySpec, 'story.spec', 1200)
  const storyVerify = parseHtml(t.storyVerify, 'story.verify', 800)

  return {
    ...summarizeTask(t),
    type: t.type,
    estimate: t.estimate,
    consumed: t.consumed,
    left: t.left,
    progress: t.progress,
    openedBy: t.openedBy,
    openedDate: cleanDate(t.openedDate),
    finishedBy: t.finishedBy,
    finishedDate: cleanDate(t.finishedDate),
    desc: desc.text,
    storyTitle: t.storyTitle,
    storySpec: storySpec.text,
    storyVerify: storyVerify.text,
    links: collectLinks([desc, storySpec, storyVerify]),
  }
}

function detailBug(b: ZentaoBug) {
  const steps = parseHtml(b.steps, 'bug.steps', 1200)

  return {
    ...summarizeBug(b),
    type: b.type,
    resolution: b.resolution,
    openedBy: b.openedBy,
    openedDate: cleanDate(b.openedDate),
    resolvedBy: b.resolvedBy,
    resolvedDate: cleanDate(b.resolvedDate),
    os: b.os,
    browser: b.browser,
    steps: steps.text,
    links: collectLinks([steps]),
  }
}

const taskTypeProp = {
  type: 'string',
  enum: ['assignedTo', 'finishedBy', 'openedBy'],
  description: '任务维度：assignedTo（指派给我，默认）/ finishedBy（由我完成）/ openedBy（由我创建）',
}

const bugTypeProp = {
  type: 'string',
  enum: ['resolvedBy', 'assignedTo', 'openedBy'],
  description: 'Bug 维度：resolvedBy（由我解决，默认）/ assignedTo（指派给我）/ openedBy（由我创建）',
}

const idProp = { type: 'integer', description: '禅道内部数字 ID' }
const limitProp = { type: 'integer', description: '返回条数上限，默认 20', minimum: 1, maximum: 100 }

type TaskType = 'finishedBy' | 'assignedTo' | 'openedBy'
type BugType = 'resolvedBy' | 'assignedTo' | 'openedBy'

function pickTaskType(t: unknown): TaskType {
  return (['assignedTo', 'finishedBy', 'openedBy'] as string[]).includes(t as string)
    ? (t as TaskType)
    : 'assignedTo'
}

function pickBugType(t: unknown): BugType {
  return (['resolvedBy', 'assignedTo', 'openedBy'] as string[]).includes(t as string)
    ? (t as BugType)
    : 'resolvedBy'
}

const myTasksTool: LlmTool<{ type?: string; limit?: number }> = {
  name: 'zentao.my_tasks',
  description:
    '查询当前用户在禅道里的任务列表（只读）。返回 id、标题、状态、优先级、项目、截止日期等。' +
    '适用于用户问“我的任务”“待办任务”等；如果用户问具体任务详情，请用 zentao.task_detail。',
  parameters: { type: 'object', properties: { type: taskTypeProp, limit: limitProp } },
  async execute({ type, limit }) {
    const session = useZentaoSession()
    const maxItems = Number(limit) > 0 ? Math.min(Number(limit), 100) : 20
    const list = await session.withSession((sid) => taskApi.myTasks(sid, pickTaskType(type), maxItems))
    return { dimension: pickTaskType(type), count: list.length, tasks: list.map(summarizeTask) }
  },
}

const taskDetailTool: LlmTool<{ id: string | number }> = {
  name: 'zentao.task_detail',
  description:
    '查询某个禅道任务详情（只读）：工时、进度、描述、关联需求、验收标准和外部链接。' +
    '如果详情里 links 包含外部 PRD/原型/文档链接，可继续用 webdoc.read 尝试读取链接内容。',
  parameters: { type: 'object', properties: { id: idProp }, required: ['id'] },
  async execute({ id }) {
    const session = useZentaoSession()
    const task = await session.withSession((sid) => taskApi.taskDetail(sid, Number(id)))
    return detailTask(task)
  },
}

const myBugsTool: LlmTool<{ type?: string; limit?: number }> = {
  name: 'zentao.my_bugs',
  description:
    '查询当前用户在禅道里的 Bug 列表（只读）。返回 id、标题、状态、严重程度、优先级、产品等。' +
    '适用于用户问“我的 Bug”“有哪些缺陷要修”等；如果用户问具体 Bug 详情，请用 zentao.bug_detail。',
  parameters: { type: 'object', properties: { type: bugTypeProp, limit: limitProp } },
  async execute({ type, limit }) {
    const session = useZentaoSession()
    const maxItems = Number(limit) > 0 ? Math.min(Number(limit), 100) : 20
    const list = await session.withSession((sid) => bugApi.myBugs(sid, pickBugType(type), maxItems))
    return { dimension: pickBugType(type), count: list.length, bugs: list.map(summarizeBug) }
  },
}

const bugDetailTool: LlmTool<{ id: string | number }> = {
  name: 'zentao.bug_detail',
  description:
    '查询某个禅道 Bug 详情（只读）：复现步骤、解决方案、环境和外部链接。' +
    '如果详情里 links 包含外部文档链接，可继续用 webdoc.read 尝试读取链接内容。',
  parameters: { type: 'object', properties: { id: idProp }, required: ['id'] },
  async execute({ id }) {
    const session = useZentaoSession()
    const bug = await session.withSession((sid) => bugApi.bugDetail(sid, Number(id)))
    return detailBug(bug)
  },
}

export const zentaoTools: LlmTool[] = [myTasksTool, taskDetailTool, myBugsTool, bugDetailTool]

export const zentaoToolDefs: LlmToolDef[] = zentaoTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

export async function callZentaoTool(name: string, params: unknown): Promise<unknown> {
  const tool = zentaoTools.find((t) => t.name === name)
  if (!tool) throw new Error(`未知禅道工具：${name}`)
  try {
    return await tool.execute((params ?? {}) as Record<string, unknown>)
  } catch (e) {
    const session = useZentaoSession()
    return { error: session.toMessage(e, '禅道查询失败') }
  }
}
