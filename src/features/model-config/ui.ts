import type { ProviderConfig } from './types'

export function maskApiKey(key: string): string {
  if (!key) return '未设置'
  if (key.length <= 8) return `${key.slice(0, 4)}••••`
  return `${key.slice(0, 6)}••••${key.slice(-4)}`
}

export function activeModelName(provider: ProviderConfig | null): string {
  if (!provider) return ''
  const model = provider.models.find((item) => item.id === provider.activeModelId)
  return model?.name ?? provider.models[0]?.name ?? ''
}

export function formatLastTest(provider: ProviderConfig): string {
  if (!provider.lastTestedAt) return '尚未测试'
  const diff = Date.now() - provider.lastTestedAt
  if (diff < 60_000) return '刚刚测试'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

export function formatLastModelSync(provider: ProviderConfig): string {
  if (!provider.lastModelsSyncedAt) return '模型未同步'
  const diff = Date.now() - provider.lastModelsSyncedAt
  if (diff < 60_000) return '刚刚同步模型'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前同步模型`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前同步模型`
  return `${Math.floor(diff / 86_400_000)} 天前同步模型`
}

export function providerHealthLabel(provider: ProviderConfig | null): string {
  if (!provider) return '未配置'
  if (!provider.apiKey.trim()) return '缺少 Key'
  if (provider.lastTestOk === true) return '已验证'
  if (provider.lastTestOk === false) return '验证失败'
  return '待验证'
}
