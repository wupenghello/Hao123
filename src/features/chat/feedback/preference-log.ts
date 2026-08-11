/**
 * Chat 助手 · 偏好数据飞轮（preference data flywheel）
 *
 * 把 👍 / 👎 / 重新生成 三个自然信号结构化成偏好对 (context, chosen, rejected)，存 IndexedDB。
 * 纯前端、零网络、append-only（不去重不回撤，下游清洗按 ts 取最新）。
 *
 * 这是日后 few-shot 召回与 DPO 微调的养料——在没训任何模型之前，手里就有了真数据集。
 * 与对话历史（localStorage `hao123-chat-history`）、聚合计数器（`hao123-chat-feedback`）
 * 完全独立：独立 IDB 库，不动它们。
 *
 * IDB 模式逐字复刻自 src/features/local-tasks/attachments.ts（单例连接 + out-of-line key）。
 */
import type { FeedbackCategory } from '../types'

const DB_NAME = 'hao123-chat-preferences'
const DB_VERSION = 1
const STORE = 'pairs'
/** 偏好记录条数上限：超出时按 ts 裁掉最老的，防止 IDB 无限膨胀 */
export const MAX_PREFERENCE_RECORDS = 500

/** 偏好来源：点赞 / 点踩 / 重新生成（重新生成 = 老 rejected、新 chosen） */
export type PreferenceSource = 'thumbs_up' | 'thumbs_down' | 'regenerate'

/** 一条上下文消息（剥离图片/工具调用/活动等，只留角色+正文） */
export interface PreferenceContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

/** 一条偏好记录。chosen/rejected 视来源而定（thumbs_up 只有 chosen，thumbs_down 只有 rejected，regenerate 两者都有） */
export interface PreferenceRecord {
  /** 主键（out-of-line key） */
  id: string
  /** 毫秒时间戳；下游清洗按它去重取最新 */
  ts: number
  source: PreferenceSource
  /** 反馈归因分类（复用 chat 的 FeedbackCategory），便于看哪类能力偏好最集中 */
  category?: FeedbackCategory
  /** 历史字段：旧版 👎 原因（已停止收集，旧记录中可能存在） */
  reason?: string
  /** 到被评回答为止的对话上下文（已裁剪） */
  context: PreferenceContextMessage[]
  /** 被采纳的回答（👍 或重新生成的新回答） */
  chosen?: string
  /** 被否决的回答（👎 或重新生成的老回答） */
  rejected?: string
  /** 产生该回答的模型（best-effort：触发瞬间读 getActiveConfig） */
  model?: string
  /** 产生该回答的 provider */
  provider?: string
}

/** logPreference 的入参（id 由内部生成；ts 可选，默认 Date.now()——测试可注入以消除时序竞态） */
export interface PreferenceInput {
  source: PreferenceSource
  category?: FeedbackCategory
  context: PreferenceContextMessage[]
  chosen?: string
  rejected?: string
  model?: string
  provider?: string
  /** 记录时间戳（ms）；省略则用 Date.now() */
  ts?: number
}

/** 复用同一个连接（IndexedDB 打开有开销，且多次 open 同库会触发 versionchange 冲突） */
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB，无法保存偏好数据'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        // key = 记录 id（out-of-line key，由 put 第二参显式传入）；value = PreferenceRecord
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

async function getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb()
  return db.transaction(STORE, mode).objectStore(STORE)
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 写一条偏好记录。**吞错**：IDB 不可用 / 写失败只 console.warn，绝不抛进对话流。
 * 调用方 fire-and-forget 即可（store 里用 `void logPreference(...)`）。
 * 写入后按 ts 裁掉超出 MAX_PREFERENCE_RECORDS 的最老记录（append-only 但总量有界）。
 */
export async function logPreference(input: PreferenceInput): Promise<void> {
  try {
    const record: PreferenceRecord = {
      id: genId(),
      ts: input.ts ?? Date.now(),
      source: input.source,
      category: input.category,
      context: input.context,
      chosen: input.chosen,
      rejected: input.rejected,
      model: input.model,
      provider: input.provider,
    }
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    // 注意：同一事务内的多个请求必须同步发起（不在中间 await），否则事务会在
    // await 的 microtask 间隙自动提交（idle），后续 getAll/delete 将抛
    // TransactionInactiveError 而被静默吞掉 → 裁剪不生效。
    store.put(record, record.id)
    const allReq = store.getAll()
    allReq.onsuccess = () => {
      const all = allReq.result as PreferenceRecord[]
      if (all.length > MAX_PREFERENCE_RECORDS) {
        const sorted = [...all].sort((a, b) => a.ts - b.ts)
        const excess = sorted.length - MAX_PREFERENCE_RECORDS
        for (const r of sorted.slice(0, excess)) store.delete(r.id)
      }
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.warn('[preference-log] 写入失败，已忽略：', e)
  }
}

/** 取全部偏好记录（按 ts 升序），供 few-shot 召回 / 检视 */
export async function getAllPreferences(): Promise<PreferenceRecord[]> {
  try {
    const store = await getStore('readonly')
    const all = await reqToPromise(store.getAll())
    return (all as PreferenceRecord[]).sort((a, b) => a.ts - b.ts)
  } catch (e) {
    console.warn('[preference-log] 读取失败，已返回空：', e)
    return []
  }
}
