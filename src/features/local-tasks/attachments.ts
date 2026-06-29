/**
 * 本地任务 · 附件二进制存储（IndexedDB）
 *
 * 任务元数据（标题/备注/附件清单）存在 localStorage，但 localStorage 只能放字符串、
 * 配额仅数 MB，存图片/文件会瞬间撑爆。故二进制 Blob 单独存 IndexedDB（配额宽松、
 * 原生支持 Blob），key 用附件 id，与 localStorage 里的 TaskAttachment.id 一一对应。
 *
 * 对外只暴露 put / get / delete / deleteMany 四个操作，store 层在增删任务/附件时调用。
 */
import { genId, isImageMime } from './util'
import type { TaskAttachment } from './types'

const DB_NAME = 'hao123-local-tasks'
const DB_VERSION = 1
const STORE = 'attachments'

/** 复用同一个连接（IndexedDB 打开有开销，且多次 open 同库会触发 versionchange 冲突） */
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB，无法保存附件'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        // key = 附件 id（out-of-line key，由 put 第二参显式传入）；value = Blob
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 拿一个 object store（指定事务模式） */
async function getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb()
  return db.transaction(STORE, mode).objectStore(STORE)
}

/**
 * 存入一个附件文件，返回其元数据。
 * Blob 以附件 id 为 key 写入；id 由这里生成，与返回的 TaskAttachment.id 一致。
 */
export async function putAttachment(file: File): Promise<TaskAttachment> {
  const id = genId()
  const store = await getStore('readwrite')
  await reqToPromise(store.put(file, id))
  return { id, name: file.name, type: file.type || 'application/octet-stream', size: file.size, isImage: isImageMime(file.type) }
}

/** 按 id 取回附件 Blob（用于生成预览 / 下载 object URL） */
export async function getAttachmentBlob(id: string): Promise<Blob | null> {
  const store = await getStore('readonly')
  const blob = await reqToPromise(store.get(id))
  return blob ?? null
}

/** 按 id 删除单个附件 */
export async function deleteAttachment(id: string): Promise<void> {
  const store = await getStore('readwrite')
  await reqToPromise(store.delete(id))
}

/** 批量删除（删任务 / 清已完成时，连带清理其附件 Blob，避免孤立数据） */
export async function deleteAttachments(ids: string[]): Promise<void> {
  if (!ids.length) return
  // 同一事务内串行 delete，比各自开事务更稳更快
  const store = await getStore('readwrite')
  await Promise.all(ids.map((id) => reqToPromise(store.delete(id))))
}
