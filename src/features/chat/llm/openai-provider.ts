/**
 * Chat 助手 · OpenAI 兼容流式提供方
 *
 * 适配所有 OpenAI `chat/completions` 协议的服务（DeepSeek、OpenAI、各类兼容网关）。
 * 仅实现 SSE 流式解析：累积文本增量与 tool_calls 增量。
 *
 * 接入信息（apiKey/model/endpoint）由 config 注入，本文件不直接读 env，
 * 故同一实现可用不同配置实例化多个 provider。
 */
import type { ChatMessage, ToolCall } from '../types'
import type { LlmChatArgs, LlmCompleteArgs, LlmProvider } from './types'

/** OpenAI 兼容服务的接入配置 */
export interface OpenAiCompatConfig {
  /** 提供方标识（调试/日志用） */
  provider: string
  apiKey: string
  model: string
  /** chat/completions 端点（通常经 vite 代理转发） */
  endpoint: string
  /** 是否已配置（基于非敏感开关，非密钥本身；缺省 false） */
  configured?: boolean
}

/** 把发给模型的消息裁成 API 接受的字段（剔除 UI-only 的 activities/ts） */
function toApiMessage(m: ChatMessage) {
  const base: Record<string, unknown> = { role: m.role }
  // user 消息带图片 → 多模态 content（text + image_url，OpenAI/DeepSeek 视觉协议）；
  // 其余角色保持纯字符串 content。
  if (m.role === 'user' && m.images?.length) {
    base.content = [
      { type: 'text', text: m.content || '' },
      ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
    ]
  } else {
    base.content = m.content
  }
  if (m.tool_calls) base.tool_calls = m.tool_calls
  if (m.tool_call_id) base.tool_call_id = m.tool_call_id
  return base
}

/**
 * 解析一行 SSE `data:`，把文本/工具调用增量并入累积态。
 * @returns 文本增量（无则空串），供调用方触发 onText
 */
function applyDelta(line: string, state: { content: string; toolMap: Map<number, ToolCall> }): string {
  if (!line.startsWith('data:')) return ''
  const data = line.slice(5).trim()
  if (!data || data === '[DONE]') return ''
  let json: any
  try {
    json = JSON.parse(data)
  } catch {
    return ''
  }
  const delta = json.choices?.[0]?.delta
  if (!delta) return ''

  let textDelta = ''
  if (typeof delta.content === 'string' && delta.content) {
    textDelta = delta.content
    state.content += textDelta
  }

  if (Array.isArray(delta.tool_calls)) {
    // 按 index 拼接工具调用（流式分片到达，id/name 仅首片给出）
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0
      let cur = state.toolMap.get(idx)
      if (!cur) {
        cur = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } }
        state.toolMap.set(idx, cur)
      }
      if (tc.id) cur.id = tc.id
      if (tc.function?.name) cur.function.name = tc.function.name
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments
    }
  }
  return textDelta
}

/** 重试间隔（ms），用于 429/500/503 等瞬态错误 */
const RETRY_DELAYS = [1000, 2000, 4000]
/** 可重试的 HTTP 状态码 */
const RETRYABLE = new Set([429, 500, 502, 503, 504])

/**
 * 判断一个错误是否「可重试」。
 * - 主动中止：绝不重试，直接抛。
 * - 网络/连接级错误（fetch 抛出的 TypeError：Failed to fetch / NetworkError 等）：重试——
 *   这正是瞬态错误最该被重试兜住的场景。
 * - HTTP 状态码错误：仅 RETRYABLE 集合内的才重试。
 */
function shouldRetry(e: unknown, status: number | undefined): boolean {
  if ((e as Error)?.name === 'AbortError') return false
  if (status == null) {
    // fetch 本身抛错（没有 Response）——典型的网络瞬态错误，重试
    const msg = (e as Error)?.message || ''
    if (/Failed to fetch|NetworkError|fetch failed|ECONNRESET|ETIMEDOUT|ERR_NETWORK/i.test(msg)) return true
    return false
  }
  return RETRYABLE.has(status)
}

/**
 * 带重试的 fetch：把瞬态错误（网络抖动 + 429/5xx）按指数退避重试若干次。
 * 成功返回 Response（已确保 ok），失败抛出带状态码与响应片段的 Error。
 */
async function fetchWithRetry(
  provider: string,
  endpoint: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  let lastErr: unknown
  let lastStatus: number | undefined
  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined
    try {
      res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal })
      if (res.ok) return res
      lastStatus = res.status
      lastErr = new Error(`${res.status}`)
    } catch (e) {
      lastErr = e
      lastStatus = undefined // fetch 抛错时没有 Response
    }
    // 决定是否重试：基于「本次抛错」而非上一次残留的 lastStatus，避免用过期状态误判
    const canRetry = attempt < RETRY_DELAYS.length && shouldRetry(lastErr, lastStatus)
    if (!canRetry) {
      // 主动中止：原样抛出原始错误，保留 .name === 'AbortError'，供上层识别后静默处理
      if ((lastErr as Error)?.name === 'AbortError') throw lastErr
      if (lastStatus != null) {
        const text = await (res?.text().catch(() => '') ?? Promise.resolve(''))
        throw new Error(`${provider} 请求失败（${lastStatus}）${text ? '：' + text.slice(0, 200) : ''}`)
      }
      // fetch 本身抛错：透传原始错误信息（如 'Failed to fetch'），便于上层诊断
      const msg = (lastErr as Error)?.message || '网络请求失败'
      throw new Error(`${provider} ${msg}`)
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]))
  }
}

/**
 * 构造一个 OpenAI 兼容的流式 LLM provider。
 * @param cfg 接入配置（来自 config 层，便于切换提供方/多实例）
 */
export function createOpenAiProvider(cfg: OpenAiCompatConfig): LlmProvider {
  /** 不含 Authorization 的请求头（API Key 由 vite 代理注入，见 vite.config.ts） */
  const headers = { 'Content-Type': 'application/json' }

  return {
    name: cfg.provider,
    configured: cfg.configured ?? false,

    async chatStream({ messages, signal, onText, tools, temperature, maxTokens, topP, frequencyPenalty, toolChoice }: LlmChatArgs) {
      const res = await fetchWithRetry(
        cfg.provider,
        cfg.endpoint,
        {
          model: cfg.model,
          messages: messages.map(toApiMessage),
          ...(tools?.length ? { tools } : {}),
          ...(temperature != null ? { temperature } : {}),
          ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
          ...(topP != null ? { top_p: topP } : {}),
          ...(frequencyPenalty != null ? { frequency_penalty: frequencyPenalty } : {}),
          ...(toolChoice != null ? { tool_choice: toolChoice } : {}),
          stream: true,
        },
        headers,
        signal,
      )

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const state = { content: '', toolMap: new Map<number, ToolCall>() }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE 以换行分隔；末行可能不完整，留到下次（非 data: 行如 event/id 按规范忽略）
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const raw of lines) {
          const textDelta = applyDelta(raw.trim(), state)
          if (textDelta) onText?.(textDelta)
        }
      }
      // 处理缓冲区残余（最后一行可能未以换行结尾）
      if (buffer.trim()) {
        const textDelta = applyDelta(buffer.trim(), state)
        if (textDelta) onText?.(textDelta)
      }

      const toolCalls = [...state.toolMap.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
      return { content: state.content, toolCalls }
    },

    async complete({ messages, signal, temperature, maxTokens, topP, responseFormat }: LlmCompleteArgs) {
      const res = await fetchWithRetry(
        cfg.provider,
        cfg.endpoint,
        {
          model: cfg.model,
          messages: messages.map(toApiMessage),
          stream: false,
          ...(temperature != null ? { temperature } : {}),
          ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
          ...(topP != null ? { top_p: topP } : {}),
          ...(responseFormat != null ? { response_format: responseFormat } : {}),
        },
        headers,
        signal,
      )

      const json: any = await res.json()
      const content = json.choices?.[0]?.message?.content
      if (content == null) {
        const reason = json.choices?.[0]?.finish_reason || 'empty response'
        throw new Error(`${cfg.provider} 返回异常：${reason}`)
      }
      return content
    },
  }
}
