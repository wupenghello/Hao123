// eval/check-config.mjs
//
// 校验 eval/llm-config.local.json 在位，打印评测将使用的 provider / model / baseUrl（脱敏 key）。
// 不发任何网络请求。跑法：npm run eval:config
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, 'llm-config.local.json')

let raw
try {
  raw = readFileSync(CONFIG_PATH, 'utf8')
} catch {
  console.error(`✗ 找不到 ${CONFIG_PATH}`)
  console.error('  请在「模型线路控制台」点导出，把内容存为 eval/llm-config.local.json')
  console.error('  （形状见 eval/llm-config.local.json.example）')
  process.exit(1)
}

let data
try {
  data = JSON.parse(raw)
} catch (e) {
  console.error('✗ JSON 解析失败：', e?.message || e)
  process.exit(1)
}

const providers = Array.isArray(data.providers) ? data.providers : []
const provider = providers.find((p) => p.id === data.activeProviderId) || providers[0]
if (!provider) {
  console.error('✗ 没有任何 provider')
  process.exit(1)
}
const model =
  provider.models?.find((m) => m.id === provider.activeModelId)?.name ||
  provider.models?.[0]?.name ||
  'deepseek-chat'
const key = String(provider.apiKey || '')
const masked = key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '(空!)'
const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '')

console.log('✓ 评测将使用：')
console.log(`    provider : ${provider.name}`)
console.log(`    model    : ${model}`)
console.log(`    baseUrl  : ${provider.baseUrl}`)
console.log(`    apiKey   : ${masked}`)
console.log(`    端点      : ${baseUrl}/chat/completions`)
console.log('')
console.log(`  共 ${providers.length} 个 provider 可用。如需多模型横向对比，扩展 provider.mjs 导出数组即可。`)
