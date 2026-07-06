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
  '外部调研回答结构必须稳定：先给「结论」，再给「关键发现」（每条发现段首标注证据强度 [证据:强/中/弱]：强=多源一致且近 12 个月；中=单一来源或较旧；弱=仅凭推断），再给「对本项目的影响」，最后列「风险 / 下一步 / 来源」。',
  'GitHub 仓库引入评估必须给出：是否建议引入、适配点、集成成本、维护风险、替代方案或观望条件；若仓库已 archived 或近 6 个月无提交，必须在结论里点明“已停止维护”。',
  '引用编号与来源绑定：结论中引用来源必须使用与「外部搜索结果」卡片完全相同的编号 [n]，不得跳号、重排或自创编号；来源不足时明确说“证据不足”，不要用搜索摘要硬编。',
  '时效红线：优先引用最近 12 个月的来源；任何超过 24 个月的来源，必须在引用处标注“来源较旧(YYYY 年)，请核实最新状态”；引用时尽量附发布日期（月/年）。',
  '视频没有字幕时，只能基于标题/简介/元数据判断，并明确说明“未读取到完整字幕”。',
  '对比 / 选型类问题（“X 和 Y 哪个好”“选哪个库”）必须用 ui.render 的 data-table 卡片输出对比矩阵（维度 × 候选），文字只给最终推荐和取舍理由，不要用流水文字罗列。',
  '失败模式如实说：付费墙 / 404 / 连接被拒 → 说明“该来源无法读取”并跳过；搜索 0 结果 → 说明“未找到公开来源”并建议换关键词；多来源结论冲突 → 分别列出并指出分歧点，不要假装一致。',
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
