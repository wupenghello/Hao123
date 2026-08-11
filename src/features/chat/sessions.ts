/**
 * Chat 助手 · 会话层
 *
 * 会话 = Turn[]（一次问答一个 Turn）。旧格式（messages: ChatMessage[]，靠 _loopGroup
 * 拼回合）在 loadSessions 时一次性迁移为 turns，迁移成功立即写回新格式。
 *
 * 持久化性能：不再「流式每 token 触发 deep watch 整库 stringify」——只有 turn 收尾
 * （status 落定 / answer 完成 / 停止 / 删除 / 切换）才 schedulePersist。流式期间只写内存。
 */
import { setLocalStorageItem } from '@/features/storage-health/index'
import type { Turn, ToolStep } from './turns'
import { slimTurn, genId } from './turns'
import type { ChatUiBlock } from './ui-types'

export interface ChatSession {
  id: string
  title: string
  turns: Turn[]
  createdAt: number
  updatedAt: number
}

/** 会话数量上限：超出时删除最久未更新的会话（保留当前），防止 localStorage 无限膨胀 */
export const MAX_SESSIONS = 50
const KEY = 'hao123-chat-sessions'
/** step.result 裁剪上限（与 turns.ts 的 STEP_RESULT_STORAGE_MAX 一致） */
const RESULT_MAX = 800

// ============ 旧格式 → 新格式迁移 ============

/** 旧版持久化的消息形态（含已被协议 ChatMessage 移除的 UI-only 字段） */
interface LegacyActivity {
  name: string
  label?: string
  detail?: string
  status: string
  startTime?: number
  endTime?: number
  duration?: number
  result?: string
  approval?: unknown
}
interface LegacyToolCall {
  id: string
  function?: { name?: string; arguments?: string }
}
interface LegacyChatMessage {
  role?: string
  content?: string
  images?: string[]
  ts?: number
  ui?: ChatUiBlock[]
  _loopGroup?: string
  _loopFinal?: boolean
  tool_calls?: LegacyToolCall[]
  activities?: LegacyActivity[]
}

function legacyActivityToStep(a: LegacyActivity, call: LegacyToolCall | undefined): ToolStep {
  return {
    callId: call?.id || `call_${a.name}`,
    tool: a.name,
    label: a.label || a.name,
    detail: a.detail,
    args: safeParse(call?.function?.arguments) as Record<string, unknown>,
    status: (['running', 'done', 'error', 'pending'] as const).includes(a.status as never)
      ? (a.status as ToolStep['status'])
      : 'done',
    startTime: a.startTime,
    endTime: a.endTime,
    duration: a.duration,
    result: a.result
      ? a.result.length > RESULT_MAX ? a.result.slice(0, RESULT_MAX) : a.result
      : undefined,
    approval: a.approval as ToolStep['approval'] | undefined,
  }
}

/** 把旧 messages 数组按「user 起点 + 其后同 _loopGroup 的 assistant/tool」归组成 turns */
function groupMessagesToTurns(rawMessages: unknown[]): Turn[] {
  const messages = rawMessages as LegacyChatMessage[]
  const turns: Turn[] = []
  const ts = Date.now()
  let i = 0
  while (i < messages.length) {
    const m = messages[i]
    if (m.role === 'user') {
      // 收集其后同组的 assistant + tool 消息（同 _loopGroup；无 group 则到下一个 user 为止）
      const group: LegacyChatMessage[] = []
      let k = i + 1
      const groupId = messages[k]?._loopGroup
      while (k < messages.length) {
        const next = messages[k]
        if (next.role === 'user') break
        if (groupId && next.role === 'assistant' && next._loopGroup && next._loopGroup !== groupId) break
        if (!groupId && next.role === 'assistant' && next._loopGroup) break
        group.push(next)
        k++
      }
      // 从 group 提炼 steps / answer / uiBlocks / status
      const steps: ToolStep[] = []
      let answer = ''
      const uiBlocks: ChatUiBlock[] = []
      let waiting = false
      let failed = false
      for (const g of group) {
        if (g.role === 'assistant') {
          const calls = g.tool_calls ?? []
          if (g.activities) {
            for (let ai = 0; ai < g.activities.length; ai++) {
              const a = g.activities[ai]
              if (a.approval && a.status === 'pending') waiting = true
              if (a.status === 'error') failed = true
              steps.push(legacyActivityToStep(a, calls[ai]))
            }
          }
          if (g._loopFinal) {
            answer = g.content || ''
            if (g.ui?.length) uiBlocks.push(...g.ui)
          } else if (!g._loopGroup && g.content?.trim()) {
            // 无 _loopGroup 的独立 assistant 消息（旧格式的简单问答）→ 就是最终回答
            answer = g.content
            if (g.ui?.length) uiBlocks.push(...g.ui)
          }
        }
      }
      const t: Turn = {
        id: genId('t'),
        userContent: m.content || '',
        images: m.images,
        steps,
        answer,
        uiBlocks,
        status: waiting ? 'waiting_approval' : failed ? 'failed' : answer ? 'done' : 'aborted',
        createdAt: m.ts ?? ts,
        updatedAt: group[group.length - 1]?.ts ?? m.ts ?? ts,
      }
      turns.push(t)
      i = k
    } else {
      // 游离的 assistant（无前置 user，历史里少见）→ 单独成 turn
      turns.push({
        id: genId('t'),
        userContent: '',
        steps: [],
        answer: m.content || '',
        uiBlocks: m.ui ?? [],
        status: 'done',
        createdAt: m.ts ?? ts,
        updatedAt: m.ts ?? ts,
      })
      i++
    }
  }
  return turns
}

function safeParse(s?: string): unknown {
  if (!s) return {}
  try {
    return JSON.parse(s)
  } catch {
    return { __parseError: true, raw: s }
  }
}

/** 旧格式（messages）→ 新格式（turns）；已是新格式则原样通过；无法识别返回 null */
export function migrateLegacySessions(raw: unknown): ChatSession[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.every((s: unknown) => s && typeof s === 'object' && Array.isArray((s as { turns?: unknown }).turns))) {
    return raw as ChatSession[]
  }
  const old = raw.filter(
    (s: unknown) => s && typeof s === 'object' && Array.isArray((s as { messages?: unknown }).messages),
  )
  if (!old.length) return null
  return old.map((s: { id?: string; title?: string; createdAt?: number; updatedAt?: number; messages: unknown[] }) => ({
    id: s.id || genId('s'),
    title: s.title || '新的协作会话',
    createdAt: s.createdAt ?? Date.now(),
    updatedAt: s.updatedAt ?? Date.now(),
    turns: groupMessagesToTurns(s.messages),
  }))
}

// ============ 读取 / 持久化 ============

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const migrated = migrateLegacySessions(parsed)
      if (migrated) {
        // 迁移成功立即写回新格式，避免下次重复迁移
        setLocalStorageItem(KEY, JSON.stringify(migrated.map(serialize)))
        return migrated
      }
    }
  } catch (e) {
    console.warn('[chat] sessions 解析失败，已重置', e)
  }
  return []
}

/** 写盘形态：剥离开存储无关的字段（images/hiddenContexts），裁剪 result */
function serialize(s: ChatSession): ChatSession {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    turns: s.turns.map(slimTurn),
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 防抖写盘（400ms 合并多次收尾写盘） */
export function schedulePersist(getList: () => ChatSession[]) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeNow(getList)
  }, 400)
}

/** 立即落盘：页面关闭 / 隐藏时调用，避免防抖窗口内丢数据 */
export function flushPersist(getList: () => ChatSession[]) {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeNow(getList)
}

function writeNow(getList: () => ChatSession[]) {
  try {
    setLocalStorageItem(KEY, JSON.stringify(getList().map(serialize)))
  } catch (e) {
    console.warn('[chat] sessions 写盘失败', e)
  }
}
