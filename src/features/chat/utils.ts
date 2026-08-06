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
 * 图片添加策略校验（纯函数，供 Composer 与测试共用）。
 * @returns error 非 null 时整批不添加（accepted 为空）；ignoredNonImages 供 UI 提示
 */
export interface ValidateImageAdd {
  error: string | null
  /** 被忽略的非图片文件数（不阻塞图片添加，仅提示） */
  ignoredNonImages: number
  accepted: File[]
}

export function validateImageAdd(
  files: File[],
  opts: { maxImages: number; maxImageSizeMB: number; currentCount: number },
): ValidateImageAdd {
  const list = Array.from(files)
  const nonImages = list.filter((f) => !f.type.startsWith('image/'))
  const imgs = list.filter((f) => f.type.startsWith('image/'))

  if (!imgs.length) {
    return { error: '仅支持图片文件（截图 / 照片）', ignoredNonImages: nonImages.length, accepted: [] }
  }
  const maxBytes = opts.maxImageSizeMB * 1024 * 1024
  const oversized = imgs.filter((f) => f.size > maxBytes)
  if (oversized.length) {
    return {
      error: `${oversized.map((f) => f.name).join('、')} 超过单张 ${opts.maxImageSizeMB}MB 限制`,
      ignoredNonImages: nonImages.length,
      accepted: [],
    }
  }
  if (opts.currentCount + imgs.length > opts.maxImages) {
    return {
      error: `最多同时上传 ${opts.maxImages} 张图片`,
      ignoredNonImages: nonImages.length,
      accepted: [],
    }
  }
  return { error: null, ignoredNonImages: nonImages.length, accepted: imgs }
}

// ============ JSON 泄漏检测（模型把工具原始数据贴进回答的兜底）============

/**
 * 文本是否以 JSON 形态开头（流式抑制用，宁可多抑制不可漏）：
 * `{` / `[` 开头，或整体被 JSON 代码块包裹。
 * 命中后进入抑制模式：后续增量只攒不显示，循环结束时再统一回填（由渲染层负责隐藏）。
 */
export function startsWithJson(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t.startsWith('{') || t.startsWith('[')) return true
  return /^```(?:json)?\s*[\[{]/.test(t)
}

/**
 * 整段文本是否就是工具原始 JSON（渲染兜底用，保守：必须整体可解析才算泄漏）。
 * 覆盖两种形态：整体被 ```json 代码块包裹；或正文就是一条 JSON（如 {"dimension":...}）。
 * 正常回答里夹一段 JSON 不命中——只处理「整条回答就是 JSON」的极端情况。
 */
export function isRawJsonLeak(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i)
  if (fence) {
    const inner = fence[1].trim()
    return inner.startsWith('{') || inner.startsWith('[')
  }
  if (t.startsWith('{') || t.startsWith('[')) {
    try { JSON.parse(t); return true } catch { return false }
  }
  return false
}

