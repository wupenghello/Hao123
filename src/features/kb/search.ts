/**
 * 知识库 · 检索（无外部依赖，适配 <50 篇文档规模）
 *
 * 算法：关键词打分（非语义检索）。
 *   - 分词：英文/数字按词；中文拆成相邻双字（bigram），如「开发环境」→ 开发 / 发环 / 环境。
 *     双字比单字更精准，避免「环」这种单字到处误命中。
 *   - 打分：标题命中 ×3、正文命中 ×1、query 整体子串命中 ×5（鼓励完整短语）。
 *   - 取 top-K 返回。
 *
 * 数据来源由 loader.ts 异步加载（本地虚拟模块 / 远程 manifest），故检索为 async。
 * 局限：靠词面匹配，不理解同义词/语义。对「开发环境域名」「部署流程」这类
 * 精确术语够用；若日后需要语义检索，换底层实现即可，上层工具接口不变。
 */
import { getKbChunks } from './loader'
import type { KbChunk } from './types'

/** 检索命中的片段（含打分，供排序用；返回给上层时去掉 score） */
export interface KbHit extends KbChunk {
  score: number
}

/**
 * 把文本切成 token：英文/数字词 + 中文相邻双字。
 * 全小写，便于大小写无关匹配。
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []

  // 英文 / 数字词（如 deepseek、vite、5173）
  const wordRe = /[a-z0-9]+/g
  let m: RegExpExecArray | null
  while ((m = wordRe.exec(lower))) tokens.push(m[0])

  // 中文：相邻双字滑窗（bigram）；单字时退化为该单字，保证单字查询仍有评分
  const cjkRe = /[一-鿿]+/g
  while ((m = cjkRe.exec(lower))) {
    const s = m[0]
    if (s.length === 1) {
      tokens.push(s)
    } else {
      for (let i = 0; i < s.length - 1; i++) tokens.push(s.slice(i, i + 2))
    }
  }
  return tokens
}

/** 统计 needle 在 haystack 中出现的次数（大小写无关，调用方已 lower） */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + 1)
  }
  return count
}

/**
 * 按查询检索知识库，返回最相关的 top-K 片段（async：首次需加载文档）。
 * @param query  用户问题或关键词，如「开发环境域名」「怎么部署」
 * @param topK   返回片段数，默认 3
 * @param signal 外部中止信号，透传给远程 fetch（首次加载尚未完成时可中止）
 */
export async function searchKb(query: string, topK = 3, signal?: AbortSignal): Promise<KbHit[]> {
  const chunks = await getKbChunks(signal)

  const qTokens = tokenize(query)
  const qLower = query.toLowerCase().trim()
  if (!qTokens.length && !qLower) return []

  const scored = chunks.map((c) => {
    const titleText = `${c.docTitle} ${c.section}`.toLowerCase()
    const bodyText = c.content.toLowerCase()
    let score = 0

    // query 整体子串命中（鼓励完整短语）
    if (qLower && (titleText.includes(qLower) || bodyText.includes(qLower))) score += 5

    // 各 token 命中：标题加权 3，正文 1
    for (const t of qTokens) {
      if (titleText.includes(t)) score += 3
      score += countOccurrences(bodyText, t)
    }
    return { ...c, score }
  })

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
