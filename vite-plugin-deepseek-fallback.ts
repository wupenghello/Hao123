/**
 * LLM · API 代理 Vite 插件
 *
 * 拦截 /deepseek/chat/completions 请求，从 body 中提取客户端 API Key
 * 并注入 Authorization 头后转发到上游。解决浏览器跨域限制。
 *
 * API Key 由用户在页面内模型配置面板填写，随请求 body 发送。
 * 本插件不依赖任何 .env 配置。
 */
import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

// ============ 工具函数 ============

async function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) throw new Error('请求体过大')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString()
}

const FORWARD_HEADERS = new Set([
  'content-type', 'accept', 'accept-encoding', 'accept-language', 'user-agent',
])

function filterHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (!FORWARD_HEADERS.has(k.toLowerCase())) continue
    out[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '')
  }
  if (!out['content-type']) out['content-type'] = 'application/json'
  return out
}

// ============ 模型列表端点候选生成（对齐 cc-switch build_models_url_candidates） ============

/**
 * 已知的「Anthropic 协议兼容子路径」后缀；按长度降序，最长前缀优先匹配。
 * baseURL 命中这些后缀时，候选列表会追加「剥离后缀再拼 /v1/models / /models」的版本。
 */
const KNOWN_COMPAT_SUFFIXES: readonly string[] = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
].sort((a, b) => b.length - a.length)

/** 404/405 响应体截断长度：避免把几十 KB HTML 404 页整页保留到错误串里。 */
const ERROR_BODY_MAX_CHARS = 512

function truncateBody(body: string): string {
  const trimmed = body.trim()
  if ([...trimmed].length <= ERROR_BODY_MAX_CHARS) return trimmed
  return [...trimmed].slice(0, ERROR_BODY_MAX_CHARS).join('') + '…'
}

/** 判断 baseURL 是否以 OpenAI 风格的版本段 `/v{N}` 结尾（`/v1`、`.../paas/v4`）。 */
function endsWithVersionSegment(url: string): boolean {
  const last = url.split('/').pop() ?? ''
  if (!last.startsWith('v')) return false
  const digits = last.slice(1)
  return digits.length > 0 && [...digits].every((c) => c >= '0' && c <= '9')
}

/** 若 baseURL 以任一已知兼容子路径结尾，返回剥离后的剩余部分；否则 null。 */
function stripCompatSuffix(baseUrl: string): string | null {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) {
      return baseUrl.slice(0, baseUrl.length - suffix.length)
    }
  }
  return null
}

/**
 * 构造「模型列表端点」的候选 URL 列表，按序探测（404/405 自动 fallback）。
 *
 * 候选顺序：
 * 1. `modelsUrlOverride` 非空 → 只返回它
 * 2. baseURL 以版本段 `/v{N}` 结尾 → 拼 `/models`；非 `/v1` 时再追加 `/v1/models` 兜底
 * 3. 其它 → 拼 `/v1/models`
 * 4. baseURL 命中兼容子路径 → 追加剥离后的根 `/v1/models`、`/models`
 */
function buildModelsUrlCandidates(baseUrl: string, modelsUrlOverride?: string | null): string[] {
  if (modelsUrlOverride) {
    const trimmed = modelsUrlOverride.trim()
    if (trimmed) return [trimmed]
  }

  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return []

  const candidates: string[] = []

  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`)
    if (!trimmed.endsWith('/v1')) {
      candidates.push(`${trimmed}/v1/models`)
    }
  } else {
    candidates.push(`${trimmed}/v1/models`)
  }

  const stripped = stripCompatSuffix(trimmed)
  if (stripped) {
    const root = stripped.replace(/\/+$/, '')
    if (root && /^[a-z]+:\/\//i.test(root)) {
      candidates.push(`${root}/v1/models`)
      candidates.push(`${root}/models`)
    }
  }

  // 线性去重，保持首次出现顺序
  return candidates.filter((url, idx, arr) => arr.indexOf(url) === idx)
}

// ============ 插件 ============

export function deepseekFallbackPlugin(): Plugin {
  return {
    name: 'llm-api-proxy',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        '/deepseek/chat/completions',
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== 'POST') return next()
          handleChatRequest(req, res)
        },
      )

      server.middlewares.use(
        '/deepseek/models',
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== 'POST') return next()
          handleModelsRequest(req, res)
        },
      )

      async function readClientAuth(req: IncomingMessage, res: ServerResponse) {
        let body: string
        try {
          body = await readBody(req)
        } catch {
          res.statusCode = 413
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: '请求体过大' }))
          return
        }

        // 从 body 中提取客户端配置的 api_key 和 base_url
        let apiKey: string | null = null
        let baseUrl = 'https://api.deepseek.com'
        let modelsUrl: string | null = null
        try {
          const parsed = JSON.parse(body)
          if (parsed.api_key && typeof parsed.api_key === 'string') {
            apiKey = parsed.api_key
            delete parsed.api_key
          }
          if (parsed.base_url && typeof parsed.base_url === 'string') {
            baseUrl = parsed.base_url.replace(/\/+$/, '')
            delete parsed.base_url
          }
          // 可选：精确指定模型列表端点（用户自定义完整 URL）
          if (parsed.models_url && typeof parsed.models_url === 'string') {
            modelsUrl = parsed.models_url.trim()
            delete parsed.models_url
          }
          body = JSON.stringify(parsed)
        } catch {
          // JSON 解析失败，按原样处理
        }

        if (!apiKey) {
          res.statusCode = 401
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            error: '未提供 API Key，请在模型配置面板中填写 Key',
          }))
          return
        }

        return { apiKey, baseUrl, body, modelsUrl }
      }

      async function handleChatRequest(req: IncomingMessage, res: ServerResponse) {
        const auth = await readClientAuth(req, res)
        if (!auth) return

        const forwardHeaders = filterHeaders(
          req.headers as Record<string, string | string[] | undefined>,
        )

        const chatUrl = `${auth.baseUrl}/chat/completions`

        try {
          const upstreamRes = await fetch(chatUrl, {
            method: 'POST',
            headers: { ...forwardHeaders, authorization: `Bearer ${auth.apiKey}` },
            body: auth.body,
          })

          if (!upstreamRes.ok) {
            const errBody = await upstreamRes.text().catch(() => '')
            res.statusCode = upstreamRes.status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({
              error: upstreamRes.status === 401 || upstreamRes.status === 403
                ? 'API Key 无效或已过期，请在模型配置面板中更新 Key'
                : `上游返回 ${upstreamRes.status}：${errBody.slice(0, 200)}`,
            }))
            return
          }

          res.statusCode = upstreamRes.status
          upstreamRes.headers.forEach((value, name) => {
            const lower = name.toLowerCase()
            if (['transfer-encoding', 'connection', 'keep-alive'].includes(lower)) return
            res.setHeader(name, value)
          })

          if (upstreamRes.body) {
            Readable.fromWeb(upstreamRes.body as any).pipe(res)
          } else {
            res.end()
          }
        } catch (e) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            error: `请求上游失败：${(e as Error).message || '未知错误'}`,
          }))
        }
      }

      async function handleModelsRequest(req: IncomingMessage, res: ServerResponse) {
        const auth = await readClientAuth(req, res)
        if (!auth) return

        // 生成候选模型列表端点，按序探测：404/405 自动 fallback 到下一个。
        // 对齐 cc-switch：/v1·/v4 版本段结尾改拼 /models；/anthropic·/claudecode 等
        // 兼容子路径追加剥离后的根候选。
        const candidates = buildModelsUrlCandidates(auth.baseUrl, auth.modelsUrl)
        let lastErr: string | null = null

        for (const url of candidates) {
          try {
            const upstreamRes = await fetch(url, {
              method: 'GET',
              headers: {
                accept: 'application/json',
                authorization: `Bearer ${auth.apiKey}`,
              },
            })

            const raw = await upstreamRes.text().catch(() => '')

            if (upstreamRes.ok) {
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(raw || JSON.stringify({ data: [] }))
              return
            }

            // 404/405：该端点不存在模型接口，尝试下一个候选
            if (upstreamRes.status === 404 || upstreamRes.status === 405) {
              lastErr = `HTTP ${upstreamRes.status}（${url}）：${truncateBody(raw)}`
              continue
            }

            // 401/403 或其它错误：立即返回，不再尝试候选
            res.statusCode = upstreamRes.status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({
              error: upstreamRes.status === 401 || upstreamRes.status === 403
                ? 'API Key 无效或无权限读取模型列表'
                : `上游返回 ${upstreamRes.status}：${truncateBody(raw)}`,
            }))
            return
          } catch (e) {
            lastErr = `请求 ${url} 失败：${(e as Error).message || '未知错误'}`
            continue
          }
        }

        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({
          error: `所有候选端点均失败：${lastErr ?? '无可用候选'}`,
        }))
      }
    },
  }
}
