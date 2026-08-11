import { describe, it, expect } from 'vitest'
import { decideTurnMode } from '@/features/chat/decide-turn-mode'
import type { Turn } from '@/features/chat/turns'

function mkTurn(over: Partial<Turn>): Turn {
  return {
    id: 't1',
    userContent: 'hi',
    steps: [],
    answer: '',
    uiBlocks: [],
    status: 'done',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function step(tool: string, status: Turn['steps'][number]['status'] = 'done', extra: Partial<Turn['steps'][number]> = {}) {
  return { callId: `c_${tool}`, tool, label: tool, args: {}, status, ...extra }
}

describe('decideTurnMode · 分型判定', () => {
  it('纯问答（无工具）→ answer-first', () => {
    expect(decideTurnMode(mkTurn({ answer: '今天天气不错' }))).toBe('answer-first')
  })

  it('写操作（git/local）→ taskflow', () => {
    expect(decideTurnMode(mkTurn({ steps: [step('git__push')], answer: '已推送' }))).toBe('taskflow')
    expect(decideTurnMode(mkTurn({ steps: [step('local__create')], answer: '已创建' }))).toBe('taskflow')
  })

  it('有待审批 → taskflow', () => {
    expect(decideTurnMode(mkTurn({ steps: [step('git__push', 'pending', { approval: { title: 'x', description: '', risk: '' } })] }))).toBe('taskflow')
  })

  it('外部调研 + 长回答 → report', () => {
    const long = '详细结论'.repeat(500)
    expect(decideTurnMode(mkTurn({ steps: [step('reach__search')], answer: long }))).toBe('report')
  })

  it('外部调研 + 短回答 → answer-first（克制，不强行 report）', () => {
    expect(decideTurnMode(mkTurn({ steps: [step('reach__search')], answer: '结论：可以用' }))).toBe('answer-first')
  })

  it('多工具 + 长回答 → report', () => {
    const long = '长回答'.repeat(700)
    expect(decideTurnMode(mkTurn({ steps: [step('weather__current'), step('zentao__my_tasks'), step('local__list')], answer: long }))).toBe('report')
  })

  it('单工具查询（天气）→ answer-first', () => {
    expect(decideTurnMode(mkTurn({ steps: [step('weather__current')], answer: '北京 26°' }))).toBe('answer-first')
  })
})
