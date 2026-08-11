import { describe, it, expect } from 'vitest'
import { daypart } from '@/features/chat/utils'
import {
  estimateTokens,
  estimateMessageTokens,
  truncateHistory,
} from '@/features/chat/agent/build-messages'
import type { ChatMessage } from '@/features/chat/types'

describe('daypart', () => {
  it('按小时映射中文时段', () => {
    expect(daypart(3)).toBe('深夜')
    expect(daypart(7)).toBe('清晨')
    expect(daypart(10)).toBe('上午')
    expect(daypart(13)).toBe('中午')
    expect(daypart(16)).toBe('下午')
    expect(daypart(20)).toBe('晚上')
    expect(daypart(23)).toBe('深夜')
  })
})

describe('estimateTokens', () => {
  it('空文本为 0', () => {
    expect(estimateTokens('')).toBe(0)
  })
  it('CJK 按 ~1.5 token/字估算', () => {
    const t = estimateTokens('你好世界')
    expect(t).toBeGreaterThan(0)
  })
})

describe('truncateHistory', () => {
  function msg(role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    return { role, content, ...extra }
  }

  it('预算充足时原样返回', () => {
    const h = [msg('user', '你好'), msg('assistant', '你好！')]
    expect(truncateHistory(h, 1_000_000)).toBe(h)
  })

  it('超预算时从早期截断，且首条补 user（API 序列合法）', () => {
    const h: ChatMessage[] = []
    for (let i = 0; i < 40; i++) {
      h.push(msg('user', `问题 ${i}：` + '今天天气怎么样，请详细说明。'.repeat(5)))
      h.push(msg('assistant', `回答 ${i}：` + '北京晴，温度适宜，注意防晒。'.repeat(10)))
    }
    const cut = truncateHistory(h, 2000)
    expect(cut.length).toBeLessThan(h.length)
    expect(cut[0].role).toBe('user')
  })

  it('孤立 tool 消息（无对应 assistant.tool_calls）被剔除', () => {
    const h: ChatMessage[] = []
    for (let i = 0; i < 10; i++) {
      h.push(msg('user', `问题 ${i}：` + '今天天气怎么样，请详细说明。'.repeat(5)))
      h.push(msg('assistant', `回答 ${i}：` + '北京晴，温度适宜，注意防晒。'.repeat(10)))
    }
    h.push(msg('user', '最后一个问题'))
    h.push(msg('tool', '{"temp":2}', { tool_call_id: 'call_old' }))
    const cut = truncateHistory(h, 3000)
    expect(cut.some((m) => m.role === 'tool' && m.tool_call_id === 'call_old')).toBe(false)
  })
})

describe('estimateMessageTokens', () => {
  it('图片按 ~1500 token/张计入', () => {
    const plain = estimateMessageTokens({ role: 'user', content: '看图' })
    const withImg = estimateMessageTokens({ role: 'user', content: '看图', images: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'] })
    expect(withImg).toBeGreaterThanOrEqual(plain + 3000)
  })
})
