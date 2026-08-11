import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredConfig } from '@/features/model-config/types'

/**
 * env 默认值种子（src/features/model-config/env-seed.ts）行为测试。
 *
 * store.ts 在模块加载时调用 seedFromEnv(loadFromStorage())，所以要用
 * vi.resetModules() + 动态 import 来反复重新加载模块，模拟「每次进站」。
 * import.meta.env 在 vitest 下默认加载项目根 .env；测试通过临时修改
 * import.meta.env 的值来控制 seed 开关。
 */

const ENV_KEYS = ['VITE_LLM_PROVIDER', 'VITE_LLM_BASE_URL', 'VITE_LLM_API_KEY', 'VITE_LLM_MODEL'] as const

function setEnv(partial: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    if (partial[key] !== undefined) (import.meta.env as Record<string, string>)[key] = partial[key]
    else delete (import.meta.env as Record<string, string>)[key]
  }
}

function fullEnv() {
  return {
    VITE_LLM_PROVIDER: '智谱 Coding Plan',
    VITE_LLM_BASE_URL: 'https://api.z.ai/api/coding/paas/v4/',
    VITE_LLM_API_KEY: 'test-key-123',
    VITE_LLM_MODEL: 'glm-5.2',
  }
}

async function loadStore() {
  vi.resetModules()
  return await import('@/features/model-config/store')
}

beforeEach(() => {
  localStorage.clear()
  setEnv({})
})

afterEach(() => {
  setEnv({})
})

describe('env seed · 空配置时用 env 默认值', () => {
  it('localStorage 无线路时，用 env 四个变量 seed 一条默认线路', async () => {
    setEnv(fullEnv())
    const store = await loadStore()
    expect(store.providers.value.length).toBe(1)
    const provider = store.providers.value[0]
    expect(provider.name).toBe('智谱 Coding Plan')
    expect(provider.baseUrl).toBe('https://api.z.ai/api/coding/paas/v4')
    expect(provider.apiKey).toBe('test-key-123')
    expect(store.activeModel.value).toBe('glm-5.2')
    // seed 的模型直接可用、来源 manual，configured 直接成立
    const model = provider.models.find((m) => m.id === provider.activeModelId)
    expect(model?.available).toBe(true)
    expect(model?.source).toBe('manual')
    expect(store.configured.value).toBe(true)
    expect(store.hasUiConfig.value).toBe(true)
  })

  it('env 缺任一变量时不 seed，保持空配置', async () => {
    setEnv({ ...fullEnv(), VITE_LLM_API_KEY: '' })
    const store = await loadStore()
    expect(store.providers.value.length).toBe(0)
    expect(store.hasUiConfig.value).toBe(false)
  })

  it('env 值带首尾空格时会被 trim 后再 seed', async () => {
    setEnv({
      VITE_LLM_PROVIDER: '  智谱 Coding Plan  ',
      VITE_LLM_BASE_URL: 'https://api.z.ai/api/coding/paas/v4///',
      VITE_LLM_API_KEY: '  test-key-123  ',
      VITE_LLM_MODEL: '  glm-5.2  ',
    })
    const store = await loadStore()
    const provider = store.providers.value[0]
    expect(provider.name).toBe('智谱 Coding Plan')
    expect(provider.baseUrl).toBe('https://api.z.ai/api/coding/paas/v4')
    expect(provider.apiKey).toBe('test-key-123')
    expect(store.activeModel.value).toBe('glm-5.2')
  })

  it('seed 的线路不会主动落盘到 localStorage', async () => {
    setEnv(fullEnv())
    await loadStore()
    expect(localStorage.getItem('hao123-llm-config')).toBeNull()
  })
})

describe('env seed · 已有配置时优先', () => {
  it('localStorage 已有线路时，env 不覆盖（取保存的值）', async () => {
    setEnv(fullEnv())
    const saved: StoredConfig = {
      providers: [
        {
          id: 'p_saved',
          name: '我的 DeepSeek',
          apiKey: 'saved-key',
          baseUrl: 'https://api.deepseek.com',
          models: [{ id: 'm_saved', name: 'deepseek-chat', available: true, source: 'manual' }],
          activeModelId: 'm_saved',
          createdAt: Date.now(),
        },
      ],
      activeProviderId: 'p_saved',
    }
    localStorage.setItem('hao123-llm-config', JSON.stringify(saved))
    const store = await loadStore()
    expect(store.providers.value.length).toBe(1)
    expect(store.providers.value[0].name).toBe('我的 DeepSeek')
    expect(store.providers.value[0].apiKey).toBe('saved-key')
    expect(store.activeModel.value).toBe('deepseek-chat')
  })
})
