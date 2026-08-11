import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatStore, MAX_SESSIONS } from '@/features/chat/store'
import { llm } from '@/features/chat/llm'
import type { ChatSession } from '@/features/chat/sessions'

/** 会话 / 重答等 store 行为测试（不触网：mock llm.chatStream） */

/** 真实 provider 会把流式增量通过 onText 回传；mock 需同样触发，否则 turn.answer 恒空 */
function mockChatStream() {
  return vi
    .spyOn(llm, 'chatStream')
    .mockImplementation(async ({ onText }) => {
      onText?.('好')
      return { content: '好', toolCalls: [] }
    })
}

function mockChatStreamWith(text: string) {
  return vi
    .spyOn(llm, 'chatStream')
    .mockImplementation(async ({ onText }) => {
      onText?.(text)
      return { content: text, toolCalls: [] }
    })
}

describe('useChatStore · 多会话', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useChatStore()
    store.sessions = []
    store.activeSessionId = null
    vi.restoreAllMocks()
  })

  it('新建会话会清空当前 turns 并切换', async () => {
    store.sessions = [
      { id: 's1', title: '会话', turns: [], createdAt: 0, updatedAt: 0 },
    ]
    store.activeSessionId = 's1'
    const id = await store.newSession()
    expect(store.activeSessionId).toBe(id)
    expect(store.activeTurns.length).toBe(0)
    expect(store.sessions.length).toBe(2)
  })

  it('会话数超过 MAX_SESSIONS 时自动裁掉最久未更新的', async () => {
    const many: ChatSession[] = []
    for (let i = 0; i < MAX_SESSIONS + 10; i++) {
      many.push({ id: `s_${i}`, title: `会话 ${i}`, turns: [], createdAt: 1000 + i, updatedAt: 1000 + i })
    }
    store.sessions = many
    store.activeSessionId = `s_${MAX_SESSIONS + 5}`
    await store.newSession()
    expect(store.sessions.length).toBe(MAX_SESSIONS)
    expect(store.sessions.some((s) => s.id === `s_${MAX_SESSIONS + 5}`)).toBe(true)
    expect(store.sessions.some((s) => s.id === 's_0')).toBe(false)
  })
})

describe('useChatStore · 生成中会话操作（切换/新建/删除不再静默失效）', () => {
  let store: ReturnType<typeof useChatStore>

  /** 模拟一个挂起的模型请求：只有 abort 才结束 */
  function mockHungChatStream() {
    return vi.spyOn(llm, 'chatStream').mockImplementation(({ signal }) =>
      new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          reject(err)
          return
        }
        signal?.addEventListener('abort', () => {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }),
    )
  }

  async function waitUntilStreamingReachesChatStream(spy: ReturnType<typeof vi.spyOn>) {
    for (let i = 0; i < 50; i++) {
      if (store.streaming && spy.mock.calls.length > 0) return
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useChatStore()
    store.sessions = []
    store.activeSessionId = null
    vi.restoreAllMocks()
  })

  it('生成中 switchSession 中止生成并完成切换', async () => {
    const spy = mockHungChatStream()
    await store.newSession() // 第一个会话
    const firstId = store.activeSessionId!
    await store.newSession() // 第二个会话（当前）
    void store.send('你好')
    await waitUntilStreamingReachesChatStream(spy)
    expect(store.streaming).toBe(true)

    await store.switchSession(firstId)
    expect(store.activeSessionId).toBe(firstId)
    expect(store.streaming).toBe(false)
    spy.mockRestore()
  })

  it('生成中 deleteSession 中止生成并完成删除', async () => {
    const spy = mockHungChatStream()
    await store.newSession() // 第一个会话
    const firstId = store.activeSessionId!
    await store.newSession() // 第二个会话（当前）
    void store.send('你好')
    await waitUntilStreamingReachesChatStream(spy)

    const currentId = store.activeSessionId!
    await store.deleteSession(currentId)
    expect(store.sessions.some((s) => s.id === currentId)).toBe(false)
    expect(store.activeSessionId).toBe(firstId)
    expect(store.streaming).toBe(false)
    spy.mockRestore()
  })

  it('生成中 newSession 中止生成并创建新会话', async () => {
    const spy = mockHungChatStream()
    void store.send('你好')
    await waitUntilStreamingReachesChatStream(spy)
    expect(store.streaming).toBe(true)

    const countBefore = store.sessions.length
    const id = await store.newSession()
    expect(store.activeSessionId).toBe(id)
    expect(store.sessions.length).toBe(countBefore + 1)
    expect(store.streaming).toBe(false)
    spy.mockRestore()
  })
})

describe('useChatStore · 发送与重答（Turn 化）', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useChatStore()
    store.sessions = []
    store.activeSessionId = null
    vi.restoreAllMocks()
  })

  it('send 创建 Turn，流式 answer 落入 turn.answer', async () => {
    const spy = mockChatStream()
    await store.send('今天天气如何')
    await new Promise((r) => setTimeout(r, 20))
    expect(store.activeTurns.length).toBe(1)
    const turn = store.activeTurns[0]
    expect(turn.userContent).toBe('今天天气如何')
    expect(turn.answer).toBe('好')
    expect(turn.status).toBe('done')
    spy.mockRestore()
  })

  it('regenerate 直接替换最后一条回答（不保留版本栈）', async () => {
    const spy = mockChatStream()
    await store.send('今天天气如何')
    await new Promise((r) => setTimeout(r, 20))
    expect(store.activeTurns.length).toBe(1)
    expect(store.activeTurns[0].answer).toBe('好')

    const spy2 = mockChatStreamWith('更好的回答')
    await store.regenerate()
    await new Promise((r) => setTimeout(r, 20))
    expect(store.activeTurns.length).toBe(1)
    expect(store.activeTurns[0].answer).toBe('更好的回答')
    spy2.mockRestore()
    spy.mockRestore()
  })
})
