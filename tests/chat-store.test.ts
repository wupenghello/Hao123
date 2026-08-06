import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatStore, MAX_SESSIONS } from '@/features/chat/store'
import { llm } from '@/features/chat/llm'
import type { ChatMessage, ChatSession } from '@/features/chat/types'

/** 会话/重答等 store 行为测试（不触网：mock llm.chatStream） */

/** 真实 provider 会把流式增量通过 onText 回传；mock 需同样触发，否则 assistant.content 恒空 */
function mockChatStream() {
  return vi
    .spyOn(llm, 'chatStream')
    .mockImplementation(async ({ onText }) => {
      onText?.('好')
      return { content: '好', toolCalls: [] }
    })
}

/** 第二个 mock 工厂：重答时换内容 */
function mockChatStreamWith(text: string) {
  return vi
    .spyOn(llm, 'chatStream')
    .mockImplementation(async ({ onText }) => {
      onText?.(text)
      return { content: text, toolCalls: [] }
    })
}

function asst(id: string, content: string, loopGroup?: string, loopFinal = false): ChatMessage {
  return { id, role: 'assistant', content, ts: Date.now(), _loopGroup: loopGroup, _loopFinal: loopFinal }
}

describe('useChatStore · 多会话', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useChatStore()
    store.messages = []
    vi.restoreAllMocks()
  })

  it('新建会话会清空当前消息并切换', async () => {
    store.messages = [
      { role: 'user', content: 'hi', id: 'u1', ts: Date.now() },
      asst('a1', '你好'),
    ]
    const id = await store.newSession()
    expect(store.activeSessionId).toBe(id)
    expect(store.messages.length).toBe(0)
    expect(store.sessions.length).toBe(2)
  })

  it('会话数超过 MAX_SESSIONS 时自动裁掉最久未更新的', async () => {
    // 直接塞满 sessions（绕过 newSession 的逐次 cap）
    const many: ChatSession[] = []
    for (let i = 0; i < MAX_SESSIONS + 10; i++) {
      many.push({
        id: `s_${i}`,
        title: `会话 ${i}`,
        messages: [],
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      })
    }
    store.sessions = many
    store.activeSessionId = `s_${MAX_SESSIONS + 5}` // 中间的一个是当前会话
    // 触发 cap：换到一个新会话
    await store.newSession()
    expect(store.sessions.length).toBe(MAX_SESSIONS)
    // 当前会话必须保留
    expect(store.sessions.some((s) => s.id === `s_${MAX_SESSIONS + 5}`)).toBe(true)
    // 最老的（s_0 等）应被裁掉
    expect(store.sessions.some((s) => s.id === 's_0')).toBe(false)
  })
})

describe('useChatStore · 生成中会话操作（切换/新建/删除不再静默失效）', () => {
  let store: ReturnType<typeof useChatStore>

  /** 模拟一个挂起的模型请求：只有 abort 才结束（还原线上「请求卡住 streaming 恒 true」） */
  function mockHungChatStream() {
    return vi.spyOn(llm, 'chatStream').mockImplementation(({ signal }) =>
      new Promise((_resolve, reject) => {
        // 真实 fetch 在调用时即挂上 abort 监听（早于 await 响应），这里同构还原：
        // 监听器在 chatStream 被调用时立即 attach，stop() 触发 abort 即可让本 Promise 拒绝。
        // 同时复现「信号已提前 abort」的情形（abort 在 fetch 之前发生 → 立即拒绝）。
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

  /** 等 agent 循环真正进入 chatStream（挂起点）——此时 abort 监听器已就位，stop() 才能生效 */
  async function waitUntilStreamingReachesChatStream(spy: ReturnType<typeof vi.spyOn>) {
    for (let i = 0; i < 50; i++) {
      if (store.streaming && spy.mock.calls.length > 0) return
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useChatStore()
    store.messages = []
    vi.restoreAllMocks()
  })

  it('生成中 switchSession 中止生成并完成切换', async () => {
    const spy = mockHungChatStream()
    const firstId = store.activeSessionId!
    await store.newSession()
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
    const firstId = store.activeSessionId!
    await store.newSession()
    void store.send('你好')
    await waitUntilStreamingReachesChatStream(spy)
    expect(store.streaming).toBe(true)

    // 删掉当前（第二个）会话 → 应回落到第一个会话
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

describe('useChatStore · 重答（直接替换，不保留版本栈）', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useChatStore()
    store.messages = []
    vi.restoreAllMocks()
  })

  it('regenerate 丢弃旧回答并生成新回答，用户消息只保留一条', async () => {
    const spy = mockChatStream()
    await store.send('今天天气如何')
    expect(store.messages.filter((m) => m.role === 'user').length).toBe(1)
    expect(store.messages[store.messages.length - 1].content).toBe('好')

    // 重答：旧回答被截断丢弃，新回答直接替换
    const spy2 = mockChatStreamWith('更好的回答')
    await store.regenerate()
    expect(store.messages.filter((m) => m.role === 'user').length).toBe(1)
    const tail = store.messages[store.messages.length - 1]
    expect(tail.role).toBe('assistant')
    expect(tail.content).toBe('更好的回答')
    spy2.mockRestore()
    spy.mockRestore()
  })
})

describe('useChatStore · 本地意图直答不调 LLM', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useChatStore()
    store.messages = []
    vi.restoreAllMocks()
  })

  it('「现在几点了」本地直答，不调 chatStream', async () => {
    const spy = mockChatStream()
    await store.send('现在几点了')
    expect(spy).not.toHaveBeenCalled()
    expect(store.messages.some((m) => m.role === 'assistant')).toBe(true)
    spy.mockRestore()
  })
})
