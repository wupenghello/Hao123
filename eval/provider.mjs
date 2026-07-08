// eval/provider.mjs
//
// promptfoo 自定义 provider：读取「模型线路控制台」导出的 JSON（eval/llm-config.local.json），
// 按与 src/features/chat/briefing.ts 完全一致的方式调用 OpenAI 兼容端点：
//   - 两条消息：system（promptfoo 轮换 v1/v2）+ user（当条 case 的 vars.context）
//   - temperature 0.6 / max_tokens 1200 / 非流式（同 briefing.ts:178-185）
//   - GLM 思考型模型关思考 + 非流式空 content 回退流式（同 openai-provider.ts 的 nonThinkingFields
//     与流式回退，否则 GLM-5.x 这类思考模型会把输出放进思考链、非流式返回空）
//
// 之所以直连 provider 而不走 dev 代理：vite-plugin-deepseek-fallback.ts 只为解决浏览器 CORS，
// 且仅 dev 生效、不存任何密钥（key 每次随 body 走）；Node 侧无 CORS，直连 base_url + Bearer
// 即与代理转发后的真实上游一致（见 vite-plugin-deepseek-fallback.ts 的 handleChatRequest）。
//
// 注意：promptfoo 的 file:// loader 用 `new (importModule(path))(...)` 实例化 provider，
// 所以默认导出必须是**类**（构造函数），不是普通对象。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, 'llm-config.local.json')

function loadActive() {
  let raw
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8')
  } catch {
    throw new Error(
      `读不到 ${CONFIG_PATH}\n` +
        '请先在「模型线路控制台」点导出，把内容存为 eval/llm-config.local.json（形状见 llm-config.local.json.example）',
    )
  }
  const data = JSON.parse(raw)
  const providers = Array.isArray(data.providers) ? data.providers : []
  const provider =
    providers.find((p) => p.id === data.activeProviderId) || providers[0]
  if (!provider) throw new Error('llm-config.local.json 里没有任何 provider')
  const model =
    provider.models?.find((m) => m.id === provider.activeModelId)?.name ||
    provider.models?.[0]?.name ||
    'deepseek-chat'
  return {
    name: provider.name,
    model,
    baseUrl: String(provider.baseUrl || '').replace(/\/+$/, ''),
    apiKey: String(provider.apiKey || '').trim(),
  }
}

export default class BriefingProvider {
  // promptfoo 实例化时传入 (options, id)；配置文件在构造时读一次
  constructor(options, fallbackId) {
    const active = loadActive()
    this.options = options || {}
    // 不用 options.id（它会是 'file://...' 路径）；用 provider:model 作可读标签
    this._id = `${active.name}:${active.model}`
    this.active = active
    if (!active.apiKey) {
      console.warn(`[eval/provider] 警告：${active.name} 的 apiKey 为空，所有调用都会失败`)
    }
  }

  // promptfoo 以方法形式调用 provider.id()（接口约定，不是属性）
  id() {
    return this._id
  }

  // promptfoo 轮换 v1/v2 系统提示词作为 systemPrompt；当条 case 的快照从 ctx.vars.context 取
  async callApi(systemPrompt, ctx) {
    const { model, baseUrl, apiKey, name } = this.active
    const sys = systemPrompt || ctx?.prompt || ''
    const userContent =
      ctx?.vars?.context ||
      '（暂无工作项与天气信息，给一句轻松的今日问候即可。）'
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: userContent },
    ]
    // 与 openai-provider.ts 的 nonThinkingFields 对齐：GLM 思考型模型非流式常返回空 content，
    // 显式关掉思考可避免（生产代码就是这么做的）。
    const extra = /^glm[-_.]/i.test(model.trim())
      ? { thinking: { type: 'disabled' }, reasoning_effort: 'none' }
      : {}
    const baseBody = { model, messages, temperature: 0.6, max_tokens: 1200, ...extra }
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
    const url = `${baseUrl}/chat/completions`

    // 1) 非流式（与 briefing.ts:178-185 一致）
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...baseBody, stream: false }),
      })
    } catch (e) {
      return { error: `网络错误：${e?.message || e}（${url}）` }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { error: `${name} 返回 ${res.status}：${text.slice(0, 300)}` }
    }
    const json = await res.json().catch(() => null)
    const content = json?.choices?.[0]?.message?.content
    if (typeof content === 'string' && content.trim()) return { output: content }

    // 2) 非流式拿到空 content → 回退流式并按 SSE 拼回（镜像 openai-provider.ts:273-296）
    let streamRes
    try {
      streamRes = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...baseBody, stream: true }),
      })
    } catch (e) {
      return { error: `网络错误(流式回退)：${e?.message || e}（${url}）` }
    }
    if (!streamRes.ok) {
      const text = await streamRes.text().catch(() => '')
      return { error: `${name} 流式回退返回 ${streamRes.status}：${text.slice(0, 300)}` }
    }
    const reader = streamRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let assembled = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const d = JSON.parse(data)
          const delta = d.choices?.[0]?.delta
          if (typeof delta?.content === 'string') assembled += delta.content
        } catch {
          /* 半截 JSON，忽略等下一片 */
        }
      }
    }
    if (assembled.trim()) return { output: assembled }
    const reason = json?.choices?.[0]?.finish_reason || 'empty response'
    return { error: `${name} 返回空内容（finish_reason: ${reason}）` }
  }
}
