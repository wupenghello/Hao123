/**
 * Chat 助手状态层 · 薄壳
 *
 * 职责边界（模块化拆分的产物）：
 *  - 面板开合 / 未读 / 流式阶段 / 错误：本文件
 *  - 会话 CRUD + Turn[] 持久化 + 旧格式迁移：sessions.ts
 *  - agent 循环引擎（纯逻辑）：agent/loop.ts + agent/build-messages.ts
 *  - 审批队列：approval.ts
 *  - 反馈 / 偏好飞轮 / few-shot：feedback/
 *  - 连通性：connectivity.ts（原地保留）
 *
 * 对外契约（外部消费者依赖，语义不变）：
 *  useChatStore().configured / show() / send(text) / openModelConfig() ...
 *  InboxDeck / GitDashboard / modao 面板等只调用 show + send + configured。
 */
import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { getActiveConfig } from '@/features/model-config'
import { llm } from './llm'
import { openModelConfigModal } from './model-modal-bridge'
import {
  classifyError,
  clearConnectivityIssue,
  markSuccess,
  markUnreachable,
  probe as probeConnectivity,
  onRecover,
} from './connectivity'
import { newTurn, genId, deriveSessionTitle } from './turns'
import type { Turn } from './turns'
import {
  loadSessions,
  schedulePersist,
  flushPersist,
  MAX_SESSIONS,
} from './sessions'
import type { ChatSession } from './sessions'
import { useApprovalQueue } from './approval'
import { runTurn } from './agent/loop'
import type { AgentPhase } from './agent/loop'
import { getFewShotSystemMessage } from './feedback/few-shot'
import { logPreference } from './feedback/preference-log'
import type { PreferenceContextMessage } from './feedback/preference-log'
import { normalizeFeedbackStats, defaultFeedbackStats, classifyAssistantMessage, incCategory, categoryLabel, FEEDBACK_CATEGORIES } from './feedback-stats'
import type { FeedbackStats } from './types'

// 旧版居中浮层面板的 UI 持久化键（沉浸式），一次性清理避免历史脏键残留。
try {
  localStorage.removeItem('hao123-chat-immersive')
  localStorage.removeItem('hao123-chat-immersive-sidebar')
} catch { /* localStorage 不可用时忽略 */ }

export type TurnPhase = 'idle' | 'thinking' | 'working' | 'composing' | 'done' | 'aborted' | 'failed'

/** 偏好数据飞轮的上下文裁剪上限（控制单条 IDB 记录体积） */
const PREF_CONTENT_MAX = 2000
const PREF_CONTEXT_MAX_BYTES = 16 * 1024

/** 把 turns[0..endIdx) 裁成 {role,content}[] 供偏好记录使用 */
function buildPreferenceContext(turns: Turn[], endIdx: number): PreferenceContextMessage[] {
  const slice = turns.slice(0, Math.max(0, endIdx))
  const out: PreferenceContextMessage[] = []
  let bytes = 0
  for (let i = slice.length - 1; i >= 0; i--) {
    const t = slice[i]
    let content = t.answer || ''
    if (content.length > PREF_CONTENT_MAX) content = content.slice(0, PREF_CONTENT_MAX) + '…'
    const size = content.length * 3
    if (bytes + size > PREF_CONTEXT_MAX_BYTES) break
    bytes += size
    out.unshift({ role: 'assistant', content })
    if (t.userContent) {
      const q = t.userContent.length > PREF_CONTENT_MAX ? t.userContent.slice(0, PREF_CONTENT_MAX) + '…' : t.userContent
      const qSize = q.length * 3
      if (bytes + qSize > PREF_CONTEXT_MAX_BYTES) break
      bytes += qSize
      out.unshift({ role: 'user', content: q })
    }
  }
  return out
}

export const useChatStore = defineStore('chat', () => {
  const open = ref(false)
  const sessions = ref<ChatSession[]>(loadSessions())
  const activeSessionId = useStorage<string | null>('hao123-chat-active-session', null)

  function ensureActiveSession(): ChatSession {
    let sess = sessions.value.find((s) => s.id === activeSessionId.value)
    if (!sess) sess = sessions.value[0]
    if (!sess) {
      sess = { id: genId('s'), title: '新的协作会话', turns: [], createdAt: Date.now(), updatedAt: Date.now() }
      sessions.value.push(sess)
    }
    activeSessionId.value = sess.id
    return sess
  }
  const activeSession = computed(() => sessions.value.find((s) => s.id === activeSessionId.value) ?? null)
  const activeTurns = computed(() => activeSession.value?.turns ?? [])

  // 未读：面板关闭时收到新回复，圆钮上显示提示
  const unread = ref(false)
  const streaming = ref(false)
  const turnPhase = ref<TurnPhase>('idle')
  const error = ref<string | null>(null)
  const feedbackStats = useStorage<FeedbackStats>('hao123-chat-feedback', defaultFeedbackStats())
  feedbackStats.value = normalizeFeedbackStats(feedbackStats.value)

  const configured = computed(() => llm.configured)
  const hasMessages = computed(() => activeTurns.value.some((t) => t.userContent || t.answer || t.uiBlocks.length))
  const currentSessionTitle = computed(() => activeSession.value?.title ?? '新的协作会话')

  const { pendingApprovals, approve, reject, approveAll, clearForTurn } = useApprovalQueue()

  // 会话持久化（sessions.ts 的防抖写盘）；turn 收尾时触发，不做流式逐 token 全库序列化
  const persist = () => schedulePersist(() => sessions.value)
  watch(activeTurns, () => {
    const sess = activeSession.value
    if (!sess) return
    sess.updatedAt = Date.now()
    if (!sess.title || sess.title === '新的协作会话') {
      sess.title = deriveSessionTitle(sess.turns)
    }
    // 只标记需要写盘（由 send/收尾处调用 persist），避免 deep watch 高频序列化
  })
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => flushPersist(() => sessions.value))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPersist(() => sessions.value)
    })
  }

  // 连通恢复时：若对话末尾是用户消息（断网期间发出的提问未得到答复），自动重跑
  onRecover(() => {
    if (streaming.value) return
    const tail = activeTurns.value[activeTurns.value.length - 1]
    if (tail?.status === 'running' && !tail.answer && !tail.steps.length) void submitTurn(tail)
  })

  function toggle() {
    open.value = !open.value
    if (open.value) unread.value = false
  }
  function show() {
    open.value = true
    unread.value = false
  }
  function close() {
    open.value = false
  }
  function openModelConfig() {
    openModelConfigModal()
  }

  let abortController: AbortController | null = null
  let currentRun: Promise<void> | null = null

  /** 提交一个 Turn 并跑引擎（send / 恢复续跑共用） */
  async function submitTurn(turn: Turn) {
    abortController?.abort()
    const controller = new AbortController()
    abortController = controller
    const signal = controller.signal
    error.value = null
    streaming.value = true
    turnPhase.value = 'thinking'
    clearForTurn(turn.id)

    const fewShotSystem = await getFewShotSystemMessage(turn.userContent, activeTurns.value.map((t) => t.answer))
    if (signal.aborted) return

    const deps = {
      signal,
      fewShot: fewShotSystem,
      requestApproval: (step: Turn['steps'][number]) => {
        const idx = turn.steps.findIndex((s) => s.callId === step.callId)
        return useApprovalQueue().requestApproval(turn.id, idx >= 0 ? idx : 0, step)
      },
      onPhase: (p: AgentPhase) => {
        turnPhase.value = p === 'composing' ? 'composing' : p === 'working' ? 'working' : 'thinking'
      },
    }

    const p = runTurn(turn, deps)
    currentRun = p
    try {
      await p
      markSuccess()
      turnPhase.value = 'done'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        turn.status = 'aborted'
        turnPhase.value = 'aborted'
      } else {
        const reason = classifyError(e)
        if (reason) {
          markUnreachable(reason)
        } else {
          clearConnectivityIssue()
          error.value = (e as Error)?.message || '对话出错了，请稍后重试'
        }
        turn.status = 'failed'
        turnPhase.value = 'failed'
      }
    } finally {
      if (abortController === controller) {
        streaming.value = false
        abortController = null
        if (!open.value) unread.value = true
        // turn 收尾落盘
        const sess = activeSession.value
        if (sess) {
          sess.updatedAt = Date.now()
          if (!sess.title || sess.title === '新的协作会话') sess.title = deriveSessionTitle(sess.turns)
        }
        persist()
      }
    }
  }

  // ============ 对外契约 ============

  /** 发送一条用户消息并跑完 agent 循环 */
  async function send(text: string, images: string[] = []) {
    const content = text.trim()
    if (!content && !images.length) return
    if (streaming.value) await stop()
    const sess = ensureActiveSession()
    const turn = newTurn(content, images.length ? images : undefined)
    sess.turns.push(turn)
    void submitTurn(turn)
  }

  /** 中止生成（保留半成品 turn） */
  async function stop() {
    abortController?.abort()
    abortController = null
    streaming.value = false
    const tail = activeTurns.value[activeTurns.value.length - 1]
    if (tail && tail.status === 'running') {
      tail.status = 'aborted'
      if (turnPhase.value !== 'failed') turnPhase.value = 'aborted'
    }
    if (currentRun) {
      await currentRun.catch(() => {})
      currentRun = null
    }
    persist()
  }

  /** 继续生成：从被停止/失败的半成品续跑 */
  async function resumeAfterStop() {
    if (streaming.value) return
    const tail = activeTurns.value[activeTurns.value.length - 1]
    if (tail && (tail.status === 'aborted' || tail.status === 'failed') && (tail.answer || tail.steps.length)) {
      tail.status = 'running'
      void submitTurn(tail)
      return
    }
    await regenerate()
  }

  // ============ 会话 CRUD ============

  async function newSession(): Promise<string> {
    if (streaming.value) await stop()
    const sess: ChatSession = {
      id: genId('s'),
      title: '新的协作会话',
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    sessions.value.unshift(sess)
    activeSessionId.value = sess.id
    capSessions()
    persist()
    return sess.id
  }

  function capSessions() {
    if (sessions.value.length <= MAX_SESSIONS) return
    const toDrop = sessions.value
      .filter((s) => s.id !== activeSessionId.value)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, sessions.value.length - MAX_SESSIONS)
    for (const s of toDrop) {
      const idx = sessions.value.findIndex((x) => x.id === s.id)
      if (idx >= 0) sessions.value.splice(idx, 1)
    }
    persist()
  }

  async function switchSession(id: string) {
    const sess = sessions.value.find((s) => s.id === id)
    if (!sess || sess.id === activeSessionId.value) return
    if (streaming.value) await stop()
    clearForTurn(activeSessionId.value ?? '')
    activeSessionId.value = id
    persist()
  }

  async function deleteSession(id: string) {
    const idx = sessions.value.findIndex((s) => s.id === id)
    if (idx < 0) return
    if (streaming.value) await stop()
    clearForTurn(id)
    sessions.value.splice(idx, 1)
    if (activeSessionId.value === id) {
      const next = sessions.value[0]
      if (next) {
        activeSessionId.value = next.id
      } else {
        const sess: ChatSession = { id: genId('s'), title: '新的协作会话', turns: [], createdAt: Date.now(), updatedAt: Date.now() }
        sessions.value.push(sess)
        activeSessionId.value = sess.id
      }
    }
    persist()
  }

  function renameSession(id: string, title: string) {
    const sess = sessions.value.find((s) => s.id === id)
    if (!sess) return
    sess.title = title.trim() || sess.title
    persist()
  }

  // ============ 回合操作 ============

  /** 批准一个待确认动作 → 引擎收到 'approved' 继续执行 */
  function approveTool(turnId: string, stepIndex: number) {
    approve(turnId, stepIndex)
  }
  function rejectTool(turnId: string, stepIndex: number) {
    reject(turnId, stepIndex)
  }
  function approveAllPending() {
    approveAll()
  }

  /** 重试单个失败工具：重跑该 step，替换结果，重跑 answer 阶段 */
  async function retryTool(turnId: string, stepIndex: number) {
    if (streaming.value) return
    const sess = sessions.value.find((s) => s.turns.some((t) => t.id === turnId))
    const turn = sess?.turns.find((t) => t.id === turnId)
    const step = turn?.steps[stepIndex]
    if (!turn || !step || step.status !== 'error') return
    step.status = 'running'
    step.startTime = Date.now()
    step.endTime = undefined
    step.duration = undefined
    step.result = undefined
    turn.status = 'running'
    void submitTurn(turn)
  }

  /** 重新生成最后一条回答：清空其 answer/steps，重跑引擎（老答案进偏好飞轮 rejected） */
  async function regenerate() {
    if (streaming.value) return
    const turns = activeTurns.value
    const lastUser = [...turns].reverse().find((t) => t.userContent.trim())
    if (!lastUser) return
    const oldContent = lastUser.answer || ''
    const regenCategory = lastUser.qualityCategory || 'general'
    const context = buildPreferenceContext(turns, turns.indexOf(lastUser) + 1)
    const cfg = getActiveConfig()
    lastUser.steps = []
    lastUser.answer = ''
    lastUser.uiBlocks = []
    lastUser.status = 'running'
    feedbackStats.value.regenerations++
    incCategory(feedbackStats.value, regenCategory, 'regenerations', 1)
    void submitTurn(lastUser)
    if (oldContent) {
      void logPreference({
        source: 'regenerate',
        category: regenCategory,
        context,
        chosen: undefined,
        rejected: oldContent,
        model: cfg.model,
        provider: cfg.provider,
      })
    }
  }

  /** 用户反馈（👍/👎）→ 更新统计 + 偏好飞轮 */
  function rate(turnIndex: number, rating: 'up' | 'down') {
    const turn = activeTurns.value[turnIndex]
    if (!turn || !turn.answer) return
    if (!turn.qualityCategory) {
      turn.qualityCategory = classifyAssistantMessage(activeTurns.value.slice(0, turnIndex), turn)
    }
    const cat = turn.qualityCategory || 'general'
    if (turn.feedback === 'up') {
      feedbackStats.value.up--
      incCategory(feedbackStats.value, cat, 'up', -1)
    }
    if (turn.feedback === 'down') {
      feedbackStats.value.down--
      incCategory(feedbackStats.value, cat, 'down', -1)
    }
    if (turn.feedback === rating) {
      turn.feedback = undefined
    } else {
      turn.feedback = rating
      if (rating === 'up') {
        feedbackStats.value.up++
        incCategory(feedbackStats.value, cat, 'up', 1)
      }
      if (rating === 'down') {
        feedbackStats.value.down++
        incCategory(feedbackStats.value, cat, 'down', 1)
      }
      const cfg = getActiveConfig()
      void logPreference({
        source: rating === 'up' ? 'thumbs_up' : 'thumbs_down',
        category: cat,
        context: buildPreferenceContext(activeTurns.value, turnIndex),
        chosen: rating === 'up' ? turn.answer : undefined,
        rejected: rating === 'down' ? turn.answer : undefined,
        model: cfg.model,
        provider: cfg.provider,
      })
    }
    persist()
  }

  /** 手动重试连通性 */
  async function retryConnection() {
    const ok = await probeConnectivity()
    if (!ok) return
    if (streaming.value) return
    const tail = activeTurns.value[activeTurns.value.length - 1]
    if (tail?.status === 'running' && !tail.answer && !tail.steps.length) void submitTurn(tail)
  }

  /** 未读内容预览：最新已完成 turn 的摘要（供 ChatLauncher） */
  const unreadPreview = computed(() => {
    if (!unread.value) return null
    const last = [...activeTurns.value].reverse().find((t) => t.answer || t.steps.length)
    if (!last) return null
    const prefix = last.steps.length ? `已执行 ${last.steps.length} 个动作` : ''
    const s = last.answer.replace(/\s+/g, ' ').trim()
    return prefix ? `${prefix} · ${s.slice(0, 24) || '有结果'}` : s.slice(0, 24) || '有新的回答'
  })

  return {
    open,
    unread,
    unreadPreview,
    streaming,
    turnPhase,
    error,
    configured,
    hasMessages,
    sessions,
    activeSession,
    activeSessionId,
    activeTurns,
    currentSessionTitle,
    pendingApprovals,
    feedbackStats,
    categoryLabel,
    toggle,
    show,
    close,
    openModelConfig,
    send,
    stop,
    resumeAfterStop,
    newSession,
    switchSession,
    deleteSession,
    renameSession,
    approveTool,
    rejectTool,
    approveAllPending,
    retryTool,
    regenerate,
    rate,
    retryConnection,
  }
})

// 保留旧导出兼容（既有外部调用不中断）
export { MAX_SESSIONS }
export { FEEDBACK_CATEGORIES }
export type { FeedbackStats }
