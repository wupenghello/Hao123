import type { ReachSource } from './types'

export interface ReachReportSection {
  title: string
  items: string[]
}

export interface ReachMarkdownNoteInput {
  title: string
  summary?: string
  verdict?: string
  sections?: ReachReportSection[]
  sources?: ReachSource[]
}

function clean(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function lines(items: unknown): string[] {
  return Array.isArray(items)
    ? items.map((item) => clean(item, 600)).filter(Boolean).slice(0, 12)
    : []
}

export const REACH_REPORT_GUIDE = [
  '外部调研回答结构必须稳定：先给「结论」，再给「关键发现」，再给「对本项目的影响」，最后列「风险 / 下一步 / 来源」。',
  'GitHub 仓库引入评估必须给出：是否建议引入、适配点、集成成本、维护风险、替代方案或观望条件。',
  '每条关键结论尽量带来源编号，如 [1] [2]；来源不足时明确说证据不足，不要用搜索摘要硬编。',
  '视频没有字幕时，只能基于标题/简介/元数据判断，并明确说明“未读取到完整字幕”。',
].join('\n')

export function normalizeMarkdownNote(input: unknown): ReachMarkdownNoteInput {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return {
    title: clean(data.title, 120) || '外部调研记录',
    summary: clean(data.summary, 1600),
    verdict: clean(data.verdict, 600),
    sections: Array.isArray(data.sections)
      ? data.sections.slice(0, 8).map((section) => {
          const s = (section && typeof section === 'object' ? section : {}) as Record<string, unknown>
          return { title: clean(s.title, 80) || '要点', items: lines(s.items) }
        }).filter((section) => section.items.length)
      : [],
    sources: Array.isArray(data.sources)
      ? data.sources.slice(0, 12).map((source) => {
          const s = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>
          return {
            title: clean(s.title, 120),
            url: clean(s.url, 500),
            snippet: clean(s.snippet, 400),
            provider: clean(s.provider, 60),
            publishedAt: clean(s.publishedAt, 80),
          }
        }).filter((source) => /^https?:\/\//i.test(source.url))
      : [],
  }
}

export function buildMarkdownNote(input: ReachMarkdownNoteInput): string {
  const parts: string[] = [`# ${input.title}`, '']
  if (input.verdict) parts.push(`> ${input.verdict}`, '')
  if (input.summary) parts.push('## 摘要', '', input.summary, '')
  for (const section of input.sections || []) {
    parts.push(`## ${section.title}`, '')
    for (const item of section.items) parts.push(`- ${item}`)
    parts.push('')
  }
  if (input.sources?.length) {
    parts.push('## 来源', '')
    input.sources.forEach((source, i) => {
      const meta = [source.provider, source.publishedAt].filter(Boolean).join(' · ')
      parts.push(`${i + 1}. [${source.title || source.url}](${source.url})${meta ? ` - ${meta}` : ''}`)
      if (source.snippet) parts.push(`   - ${source.snippet}`)
    })
    parts.push('')
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
