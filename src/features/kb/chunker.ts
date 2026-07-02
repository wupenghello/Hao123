/**
 * 知识库 · 切片（纯函数，从文档原文切出检索片段）
 *
 * 与数据来源解耦：source.ts 加载原文，这里负责按 ## 二级标题切片。
 * 首个 # 一级标题作为文档标题（已由加载层解析传入），切片时跳过一级标题行。
 */
import type { KbChunk, KbDocMeta, KbSourceType } from './types'

/**
 * 把一篇文档按 ## 二级标题切成多个片段（每个片段 = 一个可被检索命中的最小单元）。
 * 一级标题（#）本身跳过（已作为 docTitle，不进正文）；若整篇无二级标题，
 * 则去掉一级标题后整篇作一片段。
 */
export function chunkDoc(
  raw: string,
  doc: string,
  title: string,
  sourceType: KbSourceType = 'markdown',
  metadata?: KbDocMeta,
): KbChunk[] {
  // 统一去掉 \r：CRLF（Windows 默认）下，行尾的 \r 会让 ^##\s+(.+)$ 这类
  // 行级正则失配（. 不匹配 \r），导致段落切分失效。归一为 LF 后再切。
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const chunks: KbChunk[] = []
  let section = ''
  let buf: string[] = []

  const flush = () => {
    const content = buf.join('\n').trim()
    if (content) {
      chunks.push({
        doc,
        docTitle: title,
        section,
        content,
        sourceType,
        titlePath: section ? [title, section] : [title],
        citation: {
          label: section ? `${title} > ${section}` : title,
          path: metadata?.path || doc,
        },
        metadata,
      })
    }
    buf = []
  }

  for (const line of lines) {
    // 二级标题：另起一段落
    const m = line.match(/^##\s+(.+)$/)
    if (m) {
      flush()
      section = m[1].trim()
      continue
    }
    // 一级标题：跳过（已作为 docTitle，不进正文）
    if (/^#\s+/.test(line)) continue
    buf.push(line)
  }
  flush()
  return chunks
}

/** 取 markdown 首个 # 一级标题作为文档标题；无则回退 fallback */
export function docTitle(raw: string, fallback: string): string {
  // 同样去 \r，避免标题尾带 \r
  const m = raw.replace(/\r/g, '\n').match(/^#\s+(.+)$/m)
  return m?.[1]?.trim() || fallback
}
