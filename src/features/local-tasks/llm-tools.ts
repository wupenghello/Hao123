/**
 * 本地任务 · LLM 工具层（function-calling / tool-use）
 *
 * 与天气 / 禅道 / 知识库工具层同构（复用 LlmToolDef 接口），把「本地待办」以工具形式
 * 暴露给小吴：查看 / 新建 / 修改 / 完成 / 删除。这是手动任务接入 LLM 的唯一入口，
 * 小吴据此能替用户管理首页的本地待办（如「帮我记一下明天要交周报」→ local.create）。
 *
 * 与禅道工具的关键差异：禅道仅「只读」，本地任务「可写」（增删改查都在前端 localStorage +
 * IndexedDB，无后端依赖，故可放心暴露写操作）。附件二进制不进模型上下文（太大），工具只
 * 返回附件元数据清单；图片/文件的实际预览/下载留给前端 UI。
 *
 * 设计原则（对齐项目其它工具层）：
 *   - 在 execute() 内取 Pinia store（与 zentao llm-tools 同构），避免顶层 store 单例过早求值；
 *   - 返回值做「LLM 友好」裁剪（剔除 attachments 的二进制，只留元数据），省 token；
 *   - 出错返回 { error } 文本而非抛出，避免中断整轮对话，与禅道/知识库一致。
 */
import type { LlmToolDef, LlmTool } from '@/features/chat/llm/types'
import { useLocalTaskStore } from './store'
import type { LocalTask, LocalTaskPri } from './types'

// ============ 裁剪：把任务压成 LLM 友好的结构（剔除大字段，数值化）============

function summarizeTask(t: LocalTask) {
  return {
    id: t.id,
    title: t.title,
    note: t.note || undefined,
    done: t.done,
    pri: t.pri,
    deadline: t.deadline || undefined,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    /** 附件只回元数据（名称/类型/大小/是否图片），Blob 不进上下文 */
    attachments: (t.attachments ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      size: a.size,
      isImage: a.isImage,
    })),
  }
}

// ============ 参数 Schema 片段 ============

const titleProp = { type: 'string', description: '任务标题（必填，简短一句话）' }
const noteProp = { type: 'string', description: '备注 / 描述（可选）' }
const priProp: Record<string, unknown> = {
  type: 'integer',
  enum: [1, 2, 3, 4],
  description: '优先级 1~4（数字越小越高）：1 紧急 / 2 高 / 3 中（默认）/ 4 低',
}
const deadlineProp = { type: 'string', description: '截止日期 yyyy-MM-dd（可选）' }
const idProp = { type: 'string', description: '任务 id（来自 list 查询结果）' }
const includeDoneProp = {
  type: 'boolean',
  description: '是否包含已完成任务，默认 false（只看未完成）',
}

/** 把模型给的 pri 归一为合法 1~4，非法回退 3 */
function pickPri(v: unknown): LocalTaskPri {
  const n = Number(v)
  if ([1, 2, 3, 4].includes(n)) return n as LocalTaskPri
  return 3
}

// ============ 工具定义 ============

/** 1. 查看本地待办列表 */
const listTool: LlmTool<{ includeDone?: boolean }> = {
  name: 'local.list',
  description:
    '查看用户的本地待办任务（手动创建、与禅道无关，纯前端本地存储）。默认只返回未完成，可选包含已完成。' +
    '每条含 id/标题/备注/优先级/截止日期/附件清单（附件只回元数据，不含二进制）。' +
    '【适用】用户问"我的待办""有哪些本地任务""还有什么没做完"等。',
  parameters: { type: 'object', properties: { includeDone: includeDoneProp } },
  async execute({ includeDone }) {
    const store = useLocalTaskStore()
    const open = store.open.map(summarizeTask)
    if (!includeDone) return { count: open.length, open }
    return { count: open.length + store.doneCount, open, done: store.done.map(summarizeTask) }
  },
}

/** 2. 新建本地任务 */
const createTool: LlmTool<{ title: string; note?: string; pri?: number; deadline?: string }> = {
  name: 'local.create',
  description:
    '为用户新建一条本地待办任务（手动任务，与禅道无关）。标题必填，可选备注/优先级/截止日期。' +
    '【适用】用户说"帮我记一下…""提醒我明天…""加个待办：…"等需要记录待办时。',
  parameters: {
    type: 'object',
    properties: { title: titleProp, note: noteProp, pri: priProp, deadline: deadlineProp },
    required: ['title'],
  },
  async execute({ title, note, pri, deadline }) {
    const store = useLocalTaskStore()
    const created = store.add({ title, note, pri: pickPri(pri), deadline })
    if (!created) return { error: '标题不能为空' }
    return { created: true, task: summarizeTask(created) }
  },
}

/** 3. 修改本地任务（标题/备注/优先级/截止日期，不改完成态） */
const updateTool: LlmTool<{ id: string; title?: string; note?: string; pri?: number; deadline?: string }> = {
  name: 'local.update',
  description:
    '修改一条已有本地待办任务的字段（标题/备注/优先级/截止日期）。需提供任务 id。' +
    '只传需要改的字段即可。改完成态请用 local.complete。',
  parameters: {
    type: 'object',
    properties: { id: idProp, title: titleProp, note: noteProp, pri: priProp, deadline: deadlineProp },
    required: ['id'],
  },
  async execute({ id, title, note, pri, deadline }) {
    const store = useLocalTaskStore()
    const exists = store.tasks.find((t) => t.id === id)
    if (!exists) return { error: `找不到任务 ${id}` }
    const patch: Record<string, unknown> = {}
    if (title !== undefined) patch.title = title
    if (note !== undefined) patch.note = note
    if (pri !== undefined) patch.pri = pickPri(pri)
    if (deadline !== undefined) patch.deadline = deadline
    if (!Object.keys(patch).length) return { error: '未提供任何要修改的字段' }
    store.update(id, patch)
    const updated = store.tasks.find((t) => t.id === id)
    return { updated: true, task: updated ? summarizeTask(updated) : null }
  },
}

/** 4. 标记完成 / 取消完成（toggle） */
const completeTool: LlmTool<{ id: string; done?: boolean }> = {
  name: 'local.complete',
  description:
    '把一条本地待办标记为完成，或取消完成（再次标记为未完成）。需提供任务 id。' +
    'done 省略时为切换（toggle）；传 true=完成、false=取消完成。',
  parameters: { type: 'object', properties: { id: idProp, done: { type: 'boolean', description: 'true=完成 / false=取消完成，省略=切换' } }, required: ['id'] },
  async execute({ id, done }) {
    const store = useLocalTaskStore()
    const exists = store.tasks.find((t) => t.id === id)
    if (!exists) return { error: `找不到任务 ${id}` }
    // 传了 done 且与当前一致：直接返回当前态，不重复 toggle
    if (done !== undefined && exists.done === done) {
      return { task: summarizeTask(exists), note: `任务已是${done ? '完成' : '未完成'}状态` }
    }
    store.toggle(id)
    const updated = store.tasks.find((t) => t.id === id)
    return { task: updated ? summarizeTask(updated) : null, completed: updated?.done }
  },
}

/** 5. 删除本地任务（连同附件一并清理） */
const deleteTool: LlmTool<{ id: string }> = {
  name: 'local.delete',
  description:
    '删除一条本地待办任务（连同其附件一并清理）。需提供任务 id。不可恢复，删除前应向用户确认。',
  parameters: { type: 'object', properties: { id: idProp }, required: ['id'] },
  async execute({ id }) {
    const store = useLocalTaskStore()
    const exists = store.tasks.find((t) => t.id === id)
    if (!exists) return { error: `找不到任务 ${id}` }
    await store.remove(id)
    return { deleted: true, id }
  },
}

/** 全部本地任务工具 */
export const localTaskTools: LlmTool[] = [listTool, createTool, updateTool, completeTool, deleteTool]

/** 喂给 LLM 的工具声明（剥离 execute，可直接序列化） */
export const localTaskToolDefs: LlmToolDef[] = localTaskTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

/**
 * 按名执行本地任务工具（LLM 返回 tool_call 后由此分发）。
 * 与知识库 / 禅道一致：执行出错时返回 { error } 文本而非抛出，
 * 既避免中断整轮对话，也让上层（store）据 result.error 标记工具活动为错误。
 */
export async function callLocalTaskTool(name: string, params: unknown): Promise<unknown> {
  const tool = localTaskTools.find((t) => t.name === name)
  if (!tool) return { error: `未知本地任务工具：${name}` }
  try {
    return await tool.execute((params ?? {}) as Record<string, unknown>)
  } catch (e) {
    return { error: (e as Error)?.message || '本地任务操作失败' }
  }
}
