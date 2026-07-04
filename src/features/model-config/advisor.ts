import { presetByBaseUrl } from './presets'
import type { ProviderConfig, ProviderPreset } from './types'

export interface ProviderReadiness {
  level: 'empty' | 'needs-key' | 'needs-test' | 'failed' | 'ready'
  title: string
  detail: string
  action: string
  score: number
}

export function presetForProvider(provider: ProviderConfig | null): ProviderPreset | null {
  if (!provider) return null
  return presetByBaseUrl(provider.baseUrl)
}

export function providerReadiness(provider: ProviderConfig | null): ProviderReadiness {
  if (!provider) {
    return {
      level: 'empty',
      title: '还没有可用线路',
      detail: '先选一个 Provider 预设带出 Base URL，再填写 Key 获取真实可用模型。',
      action: '选择预设',
      score: 0,
    }
  }
  if (!provider.apiKey.trim()) {
    return {
      level: 'needs-key',
      title: '缺少 API Key',
      detail: '线路已保存，但小吴还不能获取模型列表或请求模型服务。',
      action: '填写 Key',
      score: 35,
    }
  }
  const confirmedCount = provider.models.filter((model) => model.available).length
  if (provider.lastTestOk === false) {
    return {
      level: 'failed',
      title: '最近一次验证失败',
      detail: provider.lastTestMessage || '请检查 Key、Base URL、模型名或账号权限。',
      action: '修正后重测',
      score: 55,
    }
  }
  if (provider.lastTestOk === true) {
    return {
      level: 'ready',
      title: '线路已验证',
      detail: confirmedCount
        ? `${provider.lastTestMessage || '当前线路可用'}，已确认 ${confirmedCount} 个模型。`
        : provider.lastTestMessage || '当前线路会用于小吴的下一次回复。',
      action: '可直接使用',
      score: 100,
    }
  }
  if (confirmedCount > 0) {
    return {
      level: 'ready',
      title: '已有可用模型',
      detail: `已从服务端确认 ${confirmedCount} 个模型，可在状态栏 hover 快速切换。`,
      action: '可直接使用',
      score: 92,
    }
  }
  return {
    level: 'needs-test',
    title: '缺少已确认模型',
    detail: '请获取服务端模型列表；若服务商未开放列表接口，可手动添加并测试当前模型。',
    action: '获取模型',
    score: 70,
  }
}
