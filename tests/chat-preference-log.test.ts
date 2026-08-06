import { describe, it, expect } from 'vitest'
import {
  logPreference,
  getAllPreferences,
  MAX_PREFERENCE_RECORDS,
} from '@/features/chat/preference-log'
import type { PreferenceInput } from '@/features/chat/preference-log'

function input(overrides: Partial<PreferenceInput> = {}): PreferenceInput {
  return {
    source: 'thumbs_up',
    context: [{ role: 'user', content: '今天天气' }],
    chosen: '北京晴',
    ...overrides,
  }
}

describe('偏好数据飞轮（preference-log）', () => {
  it('写入后可读回（chosen/rejected 随记录落库）', async () => {
    await logPreference(input({ source: 'thumbs_down', rejected: '旧回答' }))
    const all = await getAllPreferences()
    const rec = all.find((r) => r.rejected === '旧回答')
    expect(rec).toBeTruthy()
    expect(rec!.source).toBe('thumbs_down')
  })

  it('超过 MAX_PREFERENCE_RECORDS 时自动裁掉最老的记录', async () => {
    // 灌满到上限 + 10 条（前序用例的少量记录 ts 更老，会先被裁掉，不影响断言）
    for (let i = 0; i < MAX_PREFERENCE_RECORDS + 10; i++) {
      await logPreference(input({ context: [{ role: 'user', content: `q${i}` }] }))
    }
    const all = await getAllPreferences()
    expect(all.length).toBe(MAX_PREFERENCE_RECORDS)
    // 断言：最老的 10 条（q0..q9）已被裁掉（按 ts 排序后首条应为 q10 及之后的记录）
    const firstQ = all[0].context.find((c) => c.role === 'user')?.content
    expect(firstQ).toMatch(/^q(1[0-9]|[2-9][0-9]|[1-4][0-9]{2}|5\d{2})$/u)
  })
})
