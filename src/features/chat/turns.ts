/**
 * Chat 助手 · 回合（Turn）数据模型
 *
 * 一次完整问答 = 一个 Turn。这是重构的核心：
 * 旧的 messages 数组（每条 assistant 消息带 _loopGroup 拼回一组）被 Turn 取代，
 * `_loopGroup` / `_loopFinal` / `truncateIncompleteTail` 等 hack 随之消失。
 *
 * 形态分离原则：
 *  - Turn / ToolStep     —— 产品概念，持久化 + 渲染的一等公民
 *  - ChatMessage         —— 传输格式，只在 agent/build-messages.ts 里由 Turn 压平
 *  - ChatUiBlock         —— UI 卡数据（ui-types.ts，对外契约）
 */
import type { ChatUiBlock } from './ui-types'
import type { ChatMessage, FeedbackCategory } from './types'
import type { ToolApproval } from './approval'

/** 一次完整问答的状态 */
export type TurnStatus = 'running' | 'waiting_approval' | 'done' | 'aborted' | 'failed'

/** 回合内的一次工具调用（UI 可实时呈现「查询中 → 已完成」的过程） */
export interface ToolStep {
  /** 模型在本轮工具调用前输出的意图正文（如「我来查一下天气」）；不进最终回答 */
  intent?: string
  /** 协议 tool_call id（assistant tool_calls 与 tool 消息共用；引擎生成，保证同轮唯一） */
  callId: string
  /** 线上名（含 __），如 reach__search */
  tool: string
  /** 人类可读标签，如「查询实时天气」 */
  label: string
  /** 参数摘要，如「北京 · 未来 7 天」（可空） */
  detail?: string
  /** 模型给出的参数对象 */
  args: Record<string, unknown>
  /** 执行状态 */
  status: 'running' | 'done' | 'error' | 'pending'
  /** 开始时间戳（ms） */
  startTime?: number
  /** 结束时间戳（ms） */
  endTime?: number
  /** 执行耗时（ms），结束时计算 */
  duration?: number
  /** 工具返回的结果 JSON 字符串（内存持有完整值；写盘前 slimTurn 裁剪） */
  result?: string
  /** 该工具自动生成的 UI 卡 */
  uiBlocks?: ChatUiBlock[]
  /** 高风险工具的审批信息；pending 时由 UI 渲染确认卡 */
  approval?: ToolApproval
}

/** 一次完整问答（持久化 + 渲染的第一等公民） */
export interface Turn {
  id: string
  /** 用户输入正文 */
  userContent: string
  /** 仅 user 输入：附带的图片 data URL（多模态）。不持久化（localStorage 装不下 base64），
   *  仅当前会话内存持有，供 agent 多轮与回显；刷新后丢失。 */
  images?: string[]
  /** 工具步骤（可为空 = 纯问答） */
  steps: ToolStep[]
  /** 最终回答（流式累积） */
  answer: string
  /** 回答级 UI 卡 */
  uiBlocks: ChatUiBlock[]
  status: TurnStatus
  /** 用户反馈（仅 done 后）；用于质量追踪与 prompt 迭代 */
  feedback?: 'up' | 'down'
  /** 反馈归因分类：用于判断小吴哪类能力最不稳定 */
  qualityCategory?: FeedbackCategory
  createdAt: number
  updatedAt: number
  /** 内存态：RAG 候选证据 / 视觉补充上下文（发给模型的 user 消息），写盘前剥离 */
  hiddenContexts?: ChatMessage[]
}

/** 生成唯一 id（turn / session） */
export function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 新建一个 running 状态的 turn（由 send() 提交到会话） */
export function newTurn(userContent: string, images?: string[]): Turn {
  return {
    id: genId('t'),
    userContent,
    images,
    steps: [],
    answer: '',
    uiBlocks: [],
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/** step.result 持久化时的预览长度上限（完整值在内存供活动卡解析） */
export const STEP_RESULT_STORAGE_MAX = 800

/** 写盘前瘦身：剥离内存态字段（images / hiddenContexts），裁剪 step.result，避免 localStorage 撑爆 */
export function slimTurn(t: Turn): Turn {
  const { images, hiddenContexts, ...rest } = t
  return {
    ...rest,
    steps: t.steps.map((s) =>
      s.result && s.result.length > STEP_RESULT_STORAGE_MAX
        ? { ...s, result: s.result.slice(0, STEP_RESULT_STORAGE_MAX) + '\n…（已截断，仅保留预览）' }
        : s,
    ),
  } as Turn
}

/** 从 turn 派生会话标题：首条 user 输入前 28 字 */
export function deriveSessionTitle(turns: Turn[]): string {
  const first = turns.find((t) => t.userContent.trim())
  const raw = first?.userContent.replace(/\s+/g, ' ').trim()
  if (!raw) return '新的协作会话'
  return raw.length > 28 ? raw.slice(0, 28) + '…' : raw
}
