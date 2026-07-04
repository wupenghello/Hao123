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

        return { apiKey, baseUrl, body }
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

        try {
          const upstreamRes = await fetch(`${auth.baseUrl}/models`, {
            method: 'GET',
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${auth.apiKey}`,
            },
          })

          const raw = await upstreamRes.text().catch(() => '')
          res.statusCode = upstreamRes.status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (!upstreamRes.ok) {
            res.end(JSON.stringify({
              error: upstreamRes.status === 401 || upstreamRes.status === 403
                ? 'API Key 无效或无权限读取模型列表'
                : `上游返回 ${upstreamRes.status}：${raw.slice(0, 200)}`,
            }))
            return
          }

          res.end(raw || JSON.stringify({ data: [] }))
        } catch (e) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            error: `请求模型列表失败：${(e as Error).message || '未知错误'}`,
          }))
        }
      }
    },
  }
}
