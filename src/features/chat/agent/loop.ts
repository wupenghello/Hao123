/**
 * Chat 助手 · agent 循环引擎（纯逻辑，可单测）
 *
 * 跑一个 Turn 到终态：
 *   每轮 = 一次模型调用。有 tool_calls → 建 ToolStep → 审批（await requestApproval）→
 *   执行 → 回灌 → 下一轮；无 tool_calls → 流式累积 answer → status='done'。
 *
 * 相比旧 store 的简化：
 *  - 不再每轮 push 新 assistant 消息、不再扫描 _loopGroup 归组；
 *  - 审批从状态 hack 变回普通异步：requestApproval 的 Promise 悬置到用户决策，
 *    并发审批由 Promise.all 天然串行，无需 hasOtherPending / brokeForPending；
 *  - 停止 = signal abort → chatStream/callTool 抛 AbortError → 上层 catch 置 aborted，
 *    半成品 answer 原地保留。
 *
 * 本文件不 import 任何 Vue 组件；依赖全部由参数注入（store 侧 makeDeps 组装），可单测。
 */
import type { ChatMessage, StreamResult } from '../types'
import type { Turn, ToolStep } from '../turns'
import type { ChatUiBlock } from '../ui-types'
import { buildApiMessages, buildHiddenContextsForUser, buildToolOutcome } from './build-messages'
import { callTool, toolLabel, toolDetail, openAiTools } from '../tools'
import { approvalPolicy } from './policy'
import { getChatSettings } from '../settings'

/** 引擎对外暴露的阶段（store 同步到 turnPhase） */
export type AgentPhase = 'thinking' | 'working' | 'composing'

/** 引擎依赖（store 侧注入真实实现；测试侧注入 mock） */
export interface LoopDeps {
  signal: AbortSignal
  /** 审批阻塞点：返回的 Promise 悬置直到用户在 UI 批准/拒绝 */
  requestApproval(step: ToolStep): Promise<'approved' | 'rejected'>
  onPhase(p: AgentPhase): void
  /** few-shot 参考示例（每 loop 检索一次；null = 不注入） */
  fewShot: ChatMessage | null
}

interface StepOutcome {
  fedBack: string
  uiBlocks: ChatUiBlock[]
  raw: unknown
}function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}')
    return v && typeof v === 'object' ? v : { __parseError: true, raw: s }
  } catch {
    return { __parseError: true, raw: s }
  }
}

function isToolError(result: unknown): boolean {
  return !!result && typeof result === 'object' && !!(result as { error?: unknown }).error
}

/** 执行单步工具：审批 → 执行 → UI 卡 → 回灌内容。raw 供视觉上下文。 */
async function runStep(turn: Turn, step: ToolStep, deps: LoopDeps): Promise<StepOutcome> {
  const policy = approvalPolicy(step.tool, step.args)
  if (policy) {
    step.approval = { ...policy, args: step.args }
    turn.status = 'waiting_approval'
    const decision = await deps.requestApproval(step)
    turn.status = 'running'
    if (deps.signal.aborted) {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }
    if (decision === 'rejected') {
      step.status = 'error'
      step.endTime = Date.now()
      step.duration = (step.startTime ? step.endTime - step.startTime : undefined)
      const rejected = {
        approvalRejected: true,
        tool: step.tool,
        title: policy.title,
        note: '用户拒绝执行该动作；工具未执行。',
      }
      step.result = JSON.stringify(rejected)
      return { fedBack: step.result, uiBlocks: [], raw: rejected }
    }
  }

  step.status = 'running'
  try {
    const result = await callTool(step.tool, step.args, deps.signal)
    step.status = isToolError(result) ? 'error' : 'done'
    step.endTime = Date.now()
    step.duration = (step.startTime ? step.endTime - step.startTime : undefined)
    const outcome = buildToolOutcome(step.tool, result)
    step.result = outcome.fedBack
    step.uiBlocks = outcome.uiBlocks
    return outcome
  } catch (e) {
    if (deps.signal.aborted) throw e // 主动中止：向上抛，由 store 识别 AbortError
    const err = { error: (e as Error)?.message || '工具执行失败' }
    step.status = 'error'
    step.result = JSON.stringify(err)
    step.endTime = Date.now()
    step.duration = (step.startTime ? step.endTime - step.startTime : undefined)
    return { fedBack: step.result, uiBlocks: [], raw: err }
  }
}

/** 跑一个 Turn 到终态。中止/异常向上抛（AbortError / Error），由上层 catch 处置。 */
export async function runTurn(turn: Turn, deps: LoopDeps): Promise<void> {
  const chatSettings = getChatSettings()
  // 防御：maxRounds 至少为 1（用户在弹窗中直接键入 0 或 localStorage 残缺时兜底）
  const maxRounds = Math.max(1, chatSettings.maxRounds || 5)

  for (let round = 0; round < maxRounds; round++) {
    deps.onPhase('thinking')
    // 本轮请求体：当前 turn 已完成的 steps + 已产出的 answer（buildApiMessages 内部压平）
    const messages = await buildApiMessages(turn, { fewShotSystem: deps.fewShot })

    let roundText = ''
    const stream: StreamResult = await chatStream({
      messages,
      signal: deps.signal,
      onText: (delta) => {
        if (deps.signal.aborted) return
        roundText += delta
        // 乐观累积到 answer（最终轮即流式正文；工具轮结束时若多余会移回 intent）
        turn.answer += delta
        deps.onPhase('composing')
      },
    })

    // 无工具调用 → 本轮即最终回答
    if (!stream.toolCalls.length) {
      turn.status = 'done'
      return
    }

    // 有工具调用：建步骤（callId 用模型生成的 tool_call id，保证 tool 消息回灌同 id）
    deps.onPhase('working')
    const steps: ToolStep[] = stream.toolCalls.map((tc) => ({
      callId: tc.id,
      tool: tc.function.name,
      label: toolLabel(tc.function.name),
      detail: toolDetail(tc.function.name, safeParse(tc.function.arguments)),
      args: safeParse(tc.function.arguments),
      status: 'running',
      startTime: Date.now(),
    }))
    turn.steps.push(...steps)

    // 并行执行所有工具（审批的悬置 Promise 天然串行在 Promise.all 内）
    const outcomes = await Promise.all(steps.map((s) => runStep(turn, s, deps)))
    if (deps.signal.aborted) return

    // 工具轮若模型写了前置正文，移到首步的 intent（不回灌进 answer）
    if (roundText) {
      const target = steps.find((s) => s.status !== 'pending')
      if (target) target.intent = roundText
      turn.answer = turn.answer.slice(0, Math.max(0, turn.answer.length - roundText.length))
    }
    // 工具卡统一挂到 turn 的回答级卡片栈
    for (const o of outcomes) {
      if (o.uiBlocks.length) turn.uiBlocks.push(...o.uiBlocks)
    }
    // 视觉上下文（kb/modao 截图）补进下一轮请求
    turn.hiddenContexts = await buildHiddenContextsForUser(
      turn.userContent,
      outcomes.map((o, i) => ({ tool: steps[i].tool, raw: o.raw })),
      deps.signal,
    )
    // 进入下一轮
  }

  // 用尽 maxRounds：模型仍想调工具但已无轮次，没有最终正文。兜底提示让用户知道本轮做了什么。
  const reachDone = turn.steps.filter((s) => s.tool.startsWith('reach__') && s.status === 'done')
  const tried = reachDone.map((s) => `${s.label}${s.detail ? `（${s.detail}）` : ''}`)
  turn.answer = reachDone.length
    ? `已达到工具调用轮数上限。本轮已执行 ${reachDone.length} 次外部查询：${tried.join('、')}，但仍未能形成最终结论。建议缩小到某个具体方面，或换个角度追问。`
    : '（已达到工具调用轮数上限，未能给出最终答复，请缩小问题范围或继续追问。）'
  turn.status = 'done'
}

/** 流式对话（deps 内联：引擎与 llm 解耦，测试可 mock） */
import { llm } from '../llm'

async function chatStream(req: {
  messages: ChatMessage[]
  signal: AbortSignal
  onText: (delta: string) => void
}): Promise<StreamResult> {
  return llm.chatStream({
    messages: req.messages,
    signal: req.signal,
    // 全量工具下发给模型，由模型自行选择调用（对齐旧 store：不做关键词意图筛选；
    // 有 tool_calls 时用模型生成的 id 回灌，无工具时模型只出正文）
    tools: openAiTools,
    temperature: 0.3,
    maxTokens: getChatSettings().maxOutputTokens,
    onText: req.onText,
  })
}

export type { StreamResult }
