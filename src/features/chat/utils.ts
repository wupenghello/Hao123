/**
 * Chat 助手 · 共享工具函数
 *
 * 抽取 store / welcome-guide 等处复用的纯函数，避免重复定义与不一致。
 */
import type { ChatMessage } from './types'

// ============ 时间工具 ============

/** 根据本地小时数返回中文时段（统一口径，避免多处定义不一致） */
export function daypart(hour: number): string {
  if (hour < 6) return '深夜'
  if (hour < 9) return '清晨'
  if (hour < 12) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  if (hour < 23) return '晚上'
  return '深夜'
}

/** 本地日期中文格式化（如"2024年6月25日星期三"） */
export function formatDate(now: Date): string {
  return now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
}

/** 本地时间 HH:MM 格式化（如"14:30"） */
export function formatTime(now: Date): string {
  return now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// ============ Token 与历史管理 ============

/**
 * 对话历史 token 预算上限（粗略估算）。
 * 超过此值时截断早期消息，防止超出模型 context window 导致 API 报错。
 * 预留给 system prompt + 当前轮回复的空间。
 */
export const MAX_HISTORY_TOKENS = 12000

/**
 * 粗略估算文本 token 数。
 * DeepSeek 使用自己的 tokenizer，此处为近似估算：
 * - CJK 字符约 1.5 token/字
 * - ASCII 字符约 0.25 token/字符（4 字符 ≈ 1 token）
 * - JSON 结构开销（key、括号、引号）额外 +10%
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++
    } else {
      other++
    }
  }
  const base = Math.ceil(cjk * 1.5 + other * 0.25)
  // JSON 结构开销估算（若含大量括号/引号）
  const jsonOverhead = (text.match(/[{}\[\]":,]/g) || []).length * 0.5
  return Math.ceil(base + jsonOverhead)
}

/**
 * 估算单条消息的 token 数（含 role/content/tool_calls 等所有字段）。
 */
export function estimateMessageTokens(msg: ChatMessage): number {
  let tokens = estimateTokens(msg.content || '') + 4 // role overhead
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      tokens += estimateTokens(tc.function.name + tc.function.arguments) + 10
    }
  }
  // 图片：视觉模型按分辨率计费，每张粗略 ~1500 token（保守中位值），
  // 让 truncateHistory 能正确预算含图消息，避免历史超 context window。
  if (msg.images?.length) tokens += msg.images.length * 1500
  return tokens
}

/**
 * 当对话历史超过 token 预算时，截断早期消息。
 * 保留最近的对话，从最早的消息开始丢弃；不会拆散 assistant+tool 关联。
 */
export function truncateHistory(history: ChatMessage[], budget: number): ChatMessage[] {
  if (!history.length) return history

  let total = 0
  for (let i = history.length - 1; i >= 0; i--) {
    total += estimateMessageTokens(history[i])
    if (total > budget) {
      // 找到断点：从 i+1 开始保留；跳到下一个 user 消息以避免半截对话
      let start = i + 1
      while (start < history.length && history[start].role !== 'user') start++
      // 断点之后没有 user 消息：保留尾部 2 条作为最小上下文。
      // 注意：这 2 条可能是 [tool, assistant] 之类不含 user 的序列，仍需走下面的孤儿清理，
      // 否则把「没有前置 assistant(tool_calls) 的 tool 消息」喂给模型会被 400 拒绝。
      const result = start >= history.length ? history.slice(-2) : history.slice(start)
      // 清理孤立的 tool 消息：若引用的 tool_call_id 不在保留区间内的 assistant 里，则丢弃
      const validIds = new Set<string>()
      for (const msg of result) {
        if (msg.role === 'assistant' && msg.tool_calls) {
          for (const tc of msg.tool_calls) validIds.add(tc.id)
        }
      }
      const cleaned = result.filter((msg) => {
        if (msg.role === 'tool' && msg.tool_call_id && !validIds.has(msg.tool_call_id)) {
          return false
        }
        return true
      })
      // 清理后若首条不是 user（API 要求首条非 system 消息应为 user，否则可能 400），
      // 兜底补一条占位 user，让序列合法。
      if (cleaned.length && cleaned[0].role !== 'user') {
        cleaned.unshift({ role: 'user', content: '（继续）' })
      }
      return cleaned
    }
  }
  return history
}

/**
 * 从消息数组末尾向前查找并移除空的 assistant 占位消息。
 * agent loop 报错时，当前轮可能留下了未填充内容的 assistant 占位，需清理避免残留空气泡。
 */
export function cleanupEmptyAssistant(messages: ChatMessage[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') break
    if (m.role === 'assistant' && !m.content && !m.tool_calls?.length) {
      messages.splice(i, 1)
      break
    }
  }
}

// ============ JSON 截断（语义感知）============

/**
 * 在 JSON 边界处截断字符串，保证截断后的内容仍是合法的 JSON。
 * 避免硬截断导致模型收到残缺 JSON 无法解析。
 *
 * 调用方传入的是 JSON.stringify 的产物（本就是合法 JSON），故这里**不再**尝试
 * 完整解析后原样返回——那会让截断逻辑永不执行、MAX_TOOL_RESULT 形同虚设。
 *
 * 策略：从 maxLen 向前找最近的「完整元素边界」（对象/数组闭合括号后跟逗号），
 * 截到该处后去掉尾逗号，并按需补回外层数组/对象的闭合括号，使结果仍是合法 JSON。
 */
export function truncateAtJsonBoundary(json: string, maxLen: number): string {
  if (json.length <= maxLen) return json

  // 从 maxLen 向前找最近的完整 JSON 元素边界（'}' 或 ']' 后跟 ',' / ']' / '}'）
  let cutPos = -1
  for (let i = Math.min(maxLen, json.length) - 1; i >= maxLen * 0.7; i--) {
    const ch = json[i]
    if ((ch === '}' || ch === ']') && i + 1 < json.length) {
      let j = i + 1
      while (j < json.length && /\s/.test(json[j])) j++
      if (j < json.length && (json[j] === ',' || json[j] === ']' || json[j] === '}')) {
        cutPos = i + 1
        break
      }
    }
  }

  if (cutPos > 0) {
    let head = json.slice(0, cutPos)
    // 去掉末尾尾逗号（截断点可能正好落在元素边界后的逗号上）
    head = head.replace(/,\s*$/, '')
    // 补齐被截断的外层闭合括号，使结果仍是合法 JSON（用栈匹配未闭合的开括号）
    const stack: string[] = []
    for (let k = 0; k < head.length; k++) {
      const c = head[k]
      if (c === '[' || c === '{') stack.push(c === '[' ? ']' : '}')
      else if (c === ']' || c === '}') stack.pop()
    }
    if (stack.length) head += stack.reverse().join('')
    return head + '\n…[结果过长已截断，请据此已有数据回答]'
  }

  // 兜底：硬截断 + 提示（找不到边界时退而求其次，已无法保证合法 JSON）
  return json.slice(0, maxLen) + '\n…[结果过长已截断，请据此回答]'
}
