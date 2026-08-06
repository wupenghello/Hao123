import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatStore } from '@/features/chat/store'
import { llm } from '@/features/chat/llm'
import type { ChatMessage, ToolActivity } from '@/features/chat/types'

/**
 * 并发审批场景：同一轮 agent 循环并行抛出的多个写工具（git push + wbscf launch 等）
 * 全部进入 pending。此前 approveTool/rejectTool 每个都会 truncateAfterToolResult +
 * 续跑 agent 循环——截断会删掉后续 pending 卡，用户无法再批准其余审批（卡死）。
 * 修复后：还有其它 pending 时不截断不续跑，最后一个处理完才收尾。
 */

/** 构造一条带 N 个 pending 活动（含对应 tool_calls）的 assistant 中间轮消息 */
function pendingMessage(n: number, startIdx = 0): ChatMessage {
  const calls = Array.from({ length: n }, () => ({
    id: `call_${startIdx}`,
    type: 'function' as const,
    function: { name: 'local__create', arguments: '{"title":"t"}' },
  }))
  const activities: ToolActivity[] = calls.map(() => ({
    name: 'local__create',
    label: '新建本地待办',
    status: 'pending',
    startTime: Date.now(),
    approval: {
      title: '新建本地待办',
      description: '将新建本地待办。',
      risk: '确认后会立即写入本地清单。',
      args: { title: 't' },
    },
  }))
  return {
    id: `msg_${startIdx}`,
    role: 'assistant' as const,
    content: '',
    ts: Date.now(),
    tool_calls: calls,
    activities,
    _loopGroup: 'loop_test',
    _loopFinal: false,
  }
}

function toolMessage(callId: string, content = '{"approvalRequired":true}'): ChatMessage {
  return { role: 'tool', content, tool_call_id: callId, ts: Date.now() }
}

describe('并发审批（approveTool / rejectTool）', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useChatStore()
    store.messages = []
  })

  /** 观测「是否续跑 agent 循环」：续跑最终必然调用 llm.chatStream */
  function mockChatStream() {
    return vi
      .spyOn(llm, 'chatStream')
      .mockImplementation(async () => ({ content: '已完成', toolCalls: [] }))
  }

  it('批准其中一个 pending 时，若还有其它 pending 则不截断、不续跑', async () => {
    const asst = pendingMessage(2)
    store.messages = [
      { role: 'user', content: '帮我推代码并起服务', id: 'u1', ts: Date.now() },
      asst,
      toolMessage('call_0'),
      toolMessage('call_1'),
    ]

    const chatStreamSpy = mockChatStream()

    await store.approveTool(1, 0)

    // 只处理了第一个：状态已离开 pending
    expect(store.messages[1].activities?.[0].status).not.toBe('pending')
    // 其它 pending 仍在，未截断
    expect(store.messages[1].activities?.[1].status).toBe('pending')
    expect(store.messages.length).toBe(4)
    expect(store.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'call_1')).toBe(true)
    // 没有续跑 agent 循环
    expect(chatStreamSpy).not.toHaveBeenCalled()
    chatStreamSpy.mockRestore()
  })

  it('处理最后一个 pending 时截断其后的 tool 消息并续跑 agent 循环', async () => {
    const asst = pendingMessage(2)
    store.messages = [
      { role: 'user', content: '帮我推代码并起服务', id: 'u1', ts: Date.now() },
      asst,
      toolMessage('call_0'),
      toolMessage('call_1'),
    ]

    const chatStreamSpy = mockChatStream()

    await store.approveTool(1, 0)
    expect(chatStreamSpy).not.toHaveBeenCalled()

    await store.approveTool(1, 1)
    // 最后一个处理完：续跑 agent 循环（chatStream 至少被调用一次）
    expect(chatStreamSpy).toHaveBeenCalled()
    expect(store.pendingApprovals.length).toBe(0)
    chatStreamSpy.mockRestore()
  })

  it('拒绝其中一个 pending 时同样保留其它 pending，最后处理完才续跑', async () => {
    const asst = pendingMessage(2)
    store.messages = [
      { role: 'user', content: '帮我推代码并起服务', id: 'u1', ts: Date.now() },
      asst,
      toolMessage('call_0'),
      toolMessage('call_1'),
    ]

    const chatStreamSpy = mockChatStream()

    await store.rejectTool(1, 0)
    expect(store.messages[1].activities?.[1].status).toBe('pending')
    expect(store.messages.length).toBe(4)
    expect(chatStreamSpy).not.toHaveBeenCalled()

    await store.rejectTool(1, 1)
    expect(store.pendingApprovals.length).toBe(0)
    expect(chatStreamSpy).toHaveBeenCalled()
    chatStreamSpy.mockRestore()
  })

  it('单个 pending 批准后立即续跑（无并发时的原有行为）', async () => {
    const asst = pendingMessage(1)
    store.messages = [
      { role: 'user', content: '记一条待办', id: 'u1', ts: Date.now() },
      asst,
      toolMessage('call_0'),
    ]

    const chatStreamSpy = mockChatStream()
    await store.approveTool(1, 0)
    expect(chatStreamSpy).toHaveBeenCalledTimes(1)
    chatStreamSpy.mockRestore()
  })
})
