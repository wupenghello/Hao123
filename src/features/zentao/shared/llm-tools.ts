/**
 * 禅道模块 · LLM 工具层（function-calling / tool-use）
 *
 * 把禅道「查看」能力以工具形式暴露给大模型，与天气工具层同构（复用其 LlmToolDef 接口）：
 *   - zentaoToolDefs            喂给 LLM 的工具声明（name + description + 参数 JSON Schema）
 *   - callZentaoTool(name, ..)  执行 LLM 选中的工具，返回结构化数据
 *
 * 约束：仅「查看」，不提供任何操作功能。所有工具均为只读查询（GET），
 *      底层只调用现有只读 API（taskApi.myTasks/taskDetail、bugApi.myBugs/bugDetail），
 *      不引入新建/编辑/指派/改状态/评论/关闭等任何写操作。
 *
 * 设计原则：
 *   - 鉴权全部委托 useZentaoSession.withSession（与面板共用会话，失效自动重登）；
 *   - 返回值做「LLM 友好」裁剪（剔除 HTML 大字段，详情正文去标签），省 token；
 *   - 未配置禅道时不抛错中断整轮对话，返回 { error } 让模型据此说明。
 */
import type { LlmToolDef, LlmTool } from '@/features/chat/llm/types'
import { useZentaoSession } from './session'
import { taskApi } from '../task/api'
import { bugApi } from '../bug/api'
import type { ZentaoTask } from '../task/types'
import type { ZentaoBug } from '../bug/types'

// ============ 小工具 ============

/** 去除 HTML 标签 + 折叠空白，便于喂给模型（截断到 maxLen，省 token） */
function stripHtml(html: string | undefined, maxLen = 800): string | undefined {
  if (!html) return undefined
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return undefined
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

/** 0000-00-00 之类的空日期视为无 */
function cleanDate(d: string | undefined): string | undefined {
  return d && !/^0000/.test(d) ? d : undefined
}

// ============ 列表/详情裁剪 ============

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
    desc: stripHtml(t.desc),
    storyTitle: t.storyTitle,
    storySpec: stripHtml(t.storySpec),
  }
}

function detailBug(b: ZentaoBug) {
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
    steps: stripHtml(b.steps),
  }
}

// ============ 参数 Schema 片段 ============

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

// ============ 工具定义（均为只读查询）============

/** 1. 我的任务 */
const myTasksTool: LlmTool<{ type?: string; limit?: number }> = {
  name: 'zentao.my_tasks',
  description:
    '查询当前用户在禅道里的任务列表（只读）。可按维度过滤，返回 id/标题/状态/优先级/所属项目/截止日期等。' +
    '【适用】用户问"我的任务""有哪些开发工作""待办任务"等。' +
    '【不适用】用户问某个具体任务的详情——请用 task_detail。',
  parameters: { type: 'object', properties: { type: taskTypeProp, limit: limitProp } },
  async execute({ type, limit }) {
    const session = useZentaoSession()
    const maxItems = Number(limit) > 0 ? Math.min(Number(limit), 100) : 20
    const list = await session.withSession((sid) => taskApi.myTasks(sid, pickTaskType(type), maxItems))
    return { dimension: pickTaskType(type), count: list.length, tasks: list.map(summarizeTask) }
  },
}

/** 2. 任务详情 */
const taskDetailTool: LlmTool<{ id: string | number }> = {
  name: 'zentao.task_detail',
  description:
    '查询某个任务的详情（只读）：工时、进度、描述、关联需求等。需提供任务 id。' +
    '【适用】用户问"任务 XX 的详情""XX 号任务进度怎样"等需要深入信息时。' +
    '【不适用】用户只问"有哪些任务"——请用 my_tasks（列表更省 token）。',
  parameters: { type: 'object', properties: { id: idProp }, required: ['id'] },
  async execute({ id }) {
    const session = useZentaoSession()
    const task = await session.withSession((sid) => taskApi.taskDetail(sid, Number(id)))
    return detailTask(task)
  },
}

/** 3. 我的 Bug */
const myBugsTool: LlmTool<{ type?: string; limit?: number }> = {
  name: 'zentao.my_bugs',
  description:
    '查询当前用户在禅道里的 Bug 列表（只读）。可按维度过滤，返回 id/标题/状态/严重程度/优先级/所属产品等。' +
    '【适用】用户问"我的 Bug""有哪些缺陷要修""测试提了什么问题"等。' +
    '【不适用】用户问某个具体 Bug 的详情——请用 bug_detail。',
  parameters: { type: 'object', properties: { type: bugTypeProp, limit: limitProp } },
  async execute({ type, limit }) {
    const session = useZentaoSession()
    const maxItems = Number(limit) > 0 ? Math.min(Number(limit), 100) : 20
    const list = await session.withSession((sid) => bugApi.myBugs(sid, pickBugType(type), maxItems))
    return { dimension: pickBugType(type), count: list.length, bugs: list.map(summarizeBug) }
  },
}

/** 4. Bug 详情 */
const bugDetailTool: LlmTool<{ id: string | number }> = {
  name: 'zentao.bug_detail',
  description:
    '查询某个 Bug 的详情（只读）：重现步骤、解决方案、环境等。需提供 Bug id。' +
    '【适用】用户问"Bug XX 的详情""XX 号 Bug 怎么重现"等需要深入信息时。' +
    '【不适用】用户只问"有哪些 Bug"——请用 my_bugs（列表更省 token）。',
  parameters: { type: 'object', properties: { id: idProp }, required: ['id'] },
  async execute({ id }) {
    const session = useZentaoSession()
    const bug = await session.withSession((sid) => bugApi.bugDetail(sid, Number(id)))
    return detailBug(bug)
  },
}

/** 全部禅道工具（仅只读查看能力） */
export const zentaoTools: LlmTool[] = [myTasksTool, taskDetailTool, myBugsTool, bugDetailTool]

/** 喂给 LLM 的工具声明（剥离 execute，可直接序列化） */
export const zentaoToolDefs: LlmToolDef[] = zentaoTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

/**
 * 按名执行禅道工具（LLM 返回 tool_call 后由此分发）。
 * 未配置禅道（no-key）时返回 { error } 文本而非抛出，避免中断整轮对话。
 */
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
