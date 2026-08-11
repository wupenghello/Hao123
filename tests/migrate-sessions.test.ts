import { describe, it, expect } from 'vitest'
import { migrateLegacySessions } from '@/features/chat/sessions'

/** 旧格式（messages 数组，靠 _loopGroup 拼回合）→ 新格式（turns）一次性迁移 */
describe('migrateLegacySessions · 旧格式迁移', () => {
  it('已是新格式（turns）则原样通过', () => {
    const raw = [{ id: 's1', title: 't', turns: [], createdAt: 0, updatedAt: 0 }]
    const out = migrateLegacySessions(raw)
    expect(out).toEqual(raw)
  })

  it('旧 messages 按 user 起点 + 同 _loopGroup 归组成 turn', () => {
    const raw = [
      {
        id: 's1',
        title: '旧会话',
        createdAt: 100,
        updatedAt: 200,
        messages: [
          { role: 'user', content: '查下天气', ts: 100, id: 'u1' },
          {
            role: 'assistant',
            content: '我来查',
            ts: 110,
            _loopGroup: 'loop_1',
            _loopFinal: false,
            tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'weather__current', arguments: '{"city":"北京"}' } }],
            activities: [{ name: 'weather__current', label: '查询实时天气', detail: '北京', status: 'done', startTime: 110, endTime: 150, duration: 40, result: '{"temp":26}' }],
          },
          { role: 'tool', content: '{"temp":26}', tool_call_id: 'call_a', ts: 150 },
          {
            role: 'assistant',
            content: '北京 26° 晴',
            ts: 160,
            _loopGroup: 'loop_1',
            _loopFinal: true,
          },
          { role: 'user', content: '谢谢', ts: 200, id: 'u2' },
          { role: 'assistant', content: '不客气', ts: 210 },
        ],
      },
    ]
    const out = migrateLegacySessions(raw)
    expect(out).not.toBeNull()
    const s = out![0]
    expect(s.title).toBe('旧会话')
    // 两个 turn：第一个含工具步骤 + 最终回答
    expect(s.turns.length).toBe(2)
    const t1 = s.turns[0]
    expect(t1.userContent).toBe('查下天气')
    expect(t1.answer).toBe('北京 26° 晴')
    expect(t1.steps.length).toBe(1)
    expect(t1.steps[0].tool).toBe('weather__current')
    expect(t1.steps[0].label).toBe('查询实时天气')
    expect(t1.status).toBe('done')
    // 第二个 turn：纯问答
    expect(s.turns[1].userContent).toBe('谢谢')
    expect(s.turns[1].answer).toBe('不客气')
    expect(s.turns[1].steps.length).toBe(0)
  })

  it('含 pending 审批的旧消息迁移为 waiting_approval', () => {
    const raw = [
      {
        id: 's1',
        title: 't',
        createdAt: 0,
        updatedAt: 0,
        messages: [
          { role: 'user', content: '推代码', ts: 0, id: 'u1' },
          {
            role: 'assistant',
            content: '',
            ts: 0,
            _loopGroup: 'loop_1',
            tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'git__push', arguments: '{}' } }],
            activities: [{ name: 'git__push', label: 'Push 到远端', status: 'pending', approval: { title: 'Push 到远端', description: '', risk: '' } }],
          },
          { role: 'tool', content: '{"approvalRequired":true}', tool_call_id: 'call_a', ts: 0 },
        ],
      },
    ]
    const out = migrateLegacySessions(raw)
    expect(out![0].turns[0].status).toBe('waiting_approval')
    expect(out![0].turns[0].steps[0].approval).toBeTruthy()
  })
})
