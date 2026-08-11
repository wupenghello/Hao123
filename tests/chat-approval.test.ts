import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatStore } from '@/features/chat/store'
import { llm } from '@/features/chat/llm'

/**
 * 并发审批场景（Turn + 审批队列）：
 * 引擎在跑审批工具时 `await requestApproval`，Promise 悬置到 UI 决策。
 * 多个 pending 各持一个悬置 Promise（Promise.all 内天然串行）——
 * 批准其中一个，其它 pending 仍在；最后一个决策后才进入 answer 阶段。
 */

describe('审批队列（驱动真实 agent 引擎）', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useChatStore()
    store.sessions = [{ id: 's1', title: '会话', turns: [], createdAt: 0, updatedAt: 0 }]
    store.activeSessionId = 's1'
    vi.restoreAllMocks()
  })

  /** 首轮返回两个 local__create tool_calls（需审批），后续返回最终正文 */
  function mockChatStream() {
    let calls = 0
    return vi.spyOn(llm, 'chatStream').mockImplementation(async ({ onText }) => {
      calls++
      if (calls === 1) {
        return {
          content: '',
          toolCalls: [
            { id: 'call_0', type: 'function', function: { name: 'local__create', arguments: '{"title":"t1"}' } },
            { id: 'call_1', type: 'function', function: { name: 'local__create', arguments: '{"title":"t2"}' } },
          ],
        }
      }
      onText?.('两条待办已创建')
      return { content: '两条待办已创建', toolCalls: [] }
    })
  }

  async function waitFor(cond: () => boolean, timeout = 3000) {
    const start = Date.now()
    while (!cond()) {
      if (Date.now() - start > timeout) throw new Error('waitFor 超时')
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  it('同轮两个审批：逐个决策，最后一个处理完才续跑 agent 循环', async () => {
    const chatStreamSpy = mockChatStream()

    void store.send('帮我记两条待办')
    await waitFor(() => store.pendingApprovals.length === 2)
    const turnId = store.activeTurns[0].id

    // 批准第一个：另一个仍在队列，agent 循环不续跑（chatStream 只被首轮调用过）
    await store.approveTool(turnId, 0)
    await new Promise((r) => setTimeout(r, 50))
    expect(store.pendingApprovals.length).toBe(1)
    expect(chatStreamSpy).toHaveBeenCalledTimes(1)

    // 批准最后一个：队列清空，进入 answer 阶段（chatStream 二次调用）
    await store.approveTool(turnId, 1)
    await waitFor(() => !store.streaming)
    expect(store.pendingApprovals.length).toBe(0)
    expect(chatStreamSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(store.activeTurns[0].answer).toContain('两条待办已创建')

    chatStreamSpy.mockRestore()
  })

  it('拒绝后审批队列清空，agent 循环继续（注入 approvalRejected）', async () => {
    const chatStreamSpy = mockChatStream()

    void store.send('帮我记两条待办')
    await waitFor(() => store.pendingApprovals.length === 2)
    const turnId = store.activeTurns[0].id

    await store.rejectTool(turnId, 0)
    await store.rejectTool(turnId, 1)
    await waitFor(() => !store.streaming)
    expect(store.pendingApprovals.length).toBe(0)
    expect(chatStreamSpy.mock.calls.length).toBeGreaterThanOrEqual(2)

    chatStreamSpy.mockRestore()
  })
})
