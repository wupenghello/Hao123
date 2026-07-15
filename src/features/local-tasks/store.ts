import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { genId } from './util'
import { putAttachment, deleteAttachment, deleteAttachments } from './attachments'
import type { LocalTask, LocalTaskInput, LocalTaskPri, TaskAttachment } from './types'

/**
 * 本地任务状态层
 *
 * 与禅道无关：任务元数据全部存 localStorage（key `hao123-local-tasks`），附件二进制存
 * IndexedDB（见 attachments.ts）。不发任何网络请求。元数据变更用不可变更新（重新赋值
 * 数组），保证 useStorage 的 deep watch 持久化生效；附件 Blob 的读写由本层统一编排，
 * 组件只负责收集 File 对象，避免 IDB 逻辑散落各处。
 */
export const useLocalTaskStore = defineStore('local-tasks', () => {
  // ============ 列表数据（localStorage 持久化）============
  const tasks = useStorage<LocalTask[]>('hao123-local-tasks', [])

  const open = computed(() =>
    tasks.value
      .filter((t) => !t.done)
      .sort(byPriorityThenCreated),
  )
  const done = computed(() =>
    tasks.value
      .filter((t) => t.done)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
  )
  const openCount = computed(() => open.value.length)
  const doneCount = computed(() => done.value.length)

  // ============ 变更操作 ============

  /** 新建任务（title 去空格后为空则忽略），返回新建的任务（便于随后追加附件） */
  function add(input: LocalTaskInput): LocalTask | null {
    const title = input.title.trim()
    if (!title) return null
    const task: LocalTask = {
      id: genId(),
      title,
      note: input.note?.trim() || undefined,
      done: false,
      pri: input.pri,
      deadline: input.deadline || undefined,
      createdAt: Date.now(),
      source: input.source,
    }
    tasks.value = [task, ...tasks.value]
    return task
  }

  /** 更新任务字段（用于编辑） */
  function update(id: string, patch: Partial<LocalTaskInput>): void {
    const norm = normalizePatch(patch)
    if (!norm) return
    tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, ...norm } : t))
  }

  /** 勾选 / 取消完成：切换 done 并维护 completedAt */
  function toggle(id: string): void {
    tasks.value = tasks.value.map((t) => {
      if (t.id !== id) return t
      const done = !t.done
      return { ...t, done, completedAt: done ? Date.now() : undefined }
    })
  }

  /** 删除一条（连同其附件 Blob 一并清理，避免 IDB 残留孤立数据） */
  async function remove(id: string): Promise<void> {
    const t = tasks.value.find((x) => x.id === id)
    const attIds = (t?.attachments ?? []).map((a) => a.id)
    tasks.value = tasks.value.filter((x) => x.id !== id)
    if (attIds.length) await deleteAttachments(attIds).catch(() => {})
  }

  /** 清除所有已完成（连同其附件 Blob） */
  async function clearDone(): Promise<void> {
    const doneTasks = tasks.value.filter((t) => t.done)
    const attIds = doneTasks.flatMap((t) => (t.attachments ?? []).map((a) => a.id))
    tasks.value = tasks.value.filter((t) => !t.done)
    if (attIds.length) await deleteAttachments(attIds).catch(() => {})
  }

  // ============ 附件操作（Blob 存 IDB，元数据同步进任务）============

  /**
   * 给任务追加一个附件：Blob 写入 IndexedDB，元数据 push 到任务的 attachments。
   * @returns 新增的附件元数据（含 id）；写失败返回 null
   */
  async function addAttachment(taskId: string, file: File): Promise<TaskAttachment | null> {
    let meta: TaskAttachment
    try {
      meta = await putAttachment(file)
    } catch {
      return null
    }
    tasks.value = tasks.value.map((t) =>
      t.id === taskId ? { ...t, attachments: [...(t.attachments ?? []), meta] } : t,
    )
    return meta
  }

  /** 移除任务的一个附件：删 IDB 里的 Blob，并从 attachments 元数据里剔除 */
  async function removeAttachment(taskId: string, attachmentId: string): Promise<void> {
    await deleteAttachment(attachmentId).catch(() => {})
    tasks.value = tasks.value.map((t) =>
      t.id === taskId
        ? { ...t, attachments: (t.attachments ?? []).filter((a) => a.id !== attachmentId) }
        : t,
    )
  }

  return {
    tasks,
    open,
    done,
    openCount,
    doneCount,
    add,
    update,
    toggle,
    remove,
    clearDone,
    addAttachment,
    removeAttachment,
  }
})

// ============ 内部工具 ============

/** 排序：优先级高（数字小）在前，同级按创建时间倒序（新的在前） */
function byPriorityThenCreated(a: LocalTask, b: LocalTask): number {
  if (a.pri !== b.pri) return a.pri - b.pri
  return b.createdAt - a.createdAt
}

/** 把表单 patch 规整：title 去空格、空串拒收，note/deadline 空串转 undefined */
function normalizePatch(patch: Partial<LocalTaskInput>): Partial<LocalTask> | null {
  const out: Partial<LocalTask> = {}
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (!title) return null // 改成空标题：拒绝
    out.title = title
  }
  if (patch.note !== undefined) out.note = patch.note.trim() || undefined
  if (patch.pri !== undefined) out.pri = patch.pri as LocalTaskPri
  if (patch.deadline !== undefined) out.deadline = patch.deadline || undefined
  return out
}
