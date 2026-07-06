import type { ChatUiBlock, ChatUiKind } from '@/features/chat/types'

type Rec = Record<string, unknown>

function isRecord(v: unknown): v is Rec {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function list(v: unknown): Rec[] {
  return Array.isArray(v) ? v.filter(isRecord) : []
}

function text(v: unknown, fallback = '', max = 160): string {
  if (v == null) return fallback
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max) || fallback
}

function longText(v: unknown, fallback = '', max = 500): string {
  if (v == null) return fallback
  return String(v).trim().replace(/\s+/g, ' ').slice(0, max) || fallback
}

function block(kind: ChatUiKind, title: string, props: Rec, subtitle?: string): ChatUiBlock {
  return {
    id: `ui_reach_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title: text(title, '外部调研', 80),
    subtitle: subtitle ? text(subtitle, '', 120) : undefined,
    props,
  }
}

function metric(label: string, value: unknown, tone = 'info'): Rec {
  return { label, value: value ?? '-', tone }
}

function item(
  title: unknown,
  meta?: unknown,
  description?: unknown,
  badges?: unknown[],
  tone = 'info',
  url?: unknown,
): Rec {
  const base: Rec = {
    title: text(title, '未命名', 120),
    meta: text(meta, '', 120),
    description: longText(description, '', 320),
    badges: (badges ?? []).map((b) => text(b, '', 40)).filter(Boolean).slice(0, 4),
    tone,
  }
  // 原生携带 url：供 GenerativeUiBlock 把 item-list 标题渲染为可点击超链接。
  // 不再让调用方走 (it as any).url 旁路注入——那会绕过类型系统。
  if (url != null) base.url = text(url, '', 500)
  return base
}

/** 字符串值的真实长度（非字符串记 0）——摘要里报告「正文 N 字」用 */
function len(v: unknown): number {
  return typeof v === 'string' ? v.length : 0
}

function reachStatus(result: Rec): ChatUiBlock[] {
  if (!result.enabled) return []
  const tools = isRecord(result.tools) ? result.tools : {}
  const rows = Object.entries(tools).map(([key, ok]) => ({
    label: key,
    status: ok ? '可用' : '未就绪',
    tone: ok ? 'ok' : key === 'opencli' ? 'muted' : 'warn',
    detail: key === 'opencli' ? '登录态平台可选' : '',
  }))
  return [
    block('status-grid', '外部调研能力', { items: rows }, result.installed ? text(result.version, 'Agent Reach') : '未安装完整'),
  ]
}

function reachSearch(result: Rec): ChatUiBlock[] {
  const results = list(result.results)
  if (!results.length) return []
  // 搜索结果本身就是来源——标题渲染为可点击超链接（url 字段），不再另出 source-list 卡，
  // 也不再把 url 重复塞进 badges（之前会标题可点 + badge 又显示一遍同一 URL）。
  return [
    block('item-list', '外部搜索结果', {
      items: results.slice(0, 5).map((r, i) =>
        item(
          `[${i + 1}] ${r.title || r.url}`,
          [r.provider, r.publishedAt].filter(Boolean).join(' · '),
          r.snippet,
          [],
          'info',
          r.url,
        ),
      ),
    }, text(result.query, '', 100)),
  ]
}

function reachReadUrl(result: Rec): ChatUiBlock[] {
  if (!result.ok) return []
  // 不再单独出 source-list 卡——URL 已在副标题展示，底部附可点击的「打开原文」链接。
  return [
    block('summary', '网页读取结果', {
      body: longText(result.text, '已读取网页内容。', 520),
      metrics: [
        metric('标题', result.title || '未识别'),
        metric('裁剪', result.limited ? '已裁剪' : '完整'),
      ],
      sourceUrl: String(result.url || ''),
      sourceLabel: '打开原文',
    }, text(result.url, '', 120)),
  ]
}

function reachGithub(result: Rec): ChatUiBlock[] {
  if (!result.ok) return []
  const commits = list(result.recentCommits)
  const issues = list(result.recentIssues)
  const sources = list(result.sources)
  // 来源链接不再塞进 sections 的纯文本（那会丢掉 provider/发布日/摘要，且只显示 4 条）——
  // 改为单独一张 item-list 卡，标题可点击、保留完整元信息，与「外部搜索结果」同款渲染。
  const sections = [
    commits.length ? { title: '近期提交', items: commits.slice(0, 4).map((c) => `${text(c.sha, '', 12)} · ${text(c.message, '', 120)}`) } : null,
    issues.length ? { title: '近期 Issue', items: issues.slice(0, 4).map((i) => `#${i.number} · ${text(i.title, '', 120)}`) } : null,
  ].filter(Boolean)
  const blocks: ChatUiBlock[] = [
    block('summary', 'GitHub 仓库评估素材', {
      body: text(result.description, '已读取公开仓库元信息与 README。', 320),
      metrics: [
        metric('Stars', result.stars ?? 0, Number(result.stars) > 1000 ? 'ok' : 'info'),
        metric('Forks', result.forks ?? 0),
        metric('Open Issues', result.openIssues ?? 0, Number(result.openIssues) > 100 ? 'warn' : 'info'),
        metric('License', result.license || '-'),
        metric('Language', result.language || '-'),
        metric('Updated', result.pushedAt || result.updatedAt || '-'),
      ],
      sections,
      sourceUrl: String(result.url || ''),
      sourceLabel: '打开仓库',
    }, text(result.repo, '', 100)),
  ]
  if (sources.length) {
    blocks.push(
      block('item-list', '相关来源', {
        items: sources.slice(0, 6).map((s) =>
          item(
            s.title || s.url,
            [s.provider, s.publishedAt].filter(Boolean).join(' · '),
            s.snippet,
            [],
            'info',
            s.url,
          ),
        ),
      }),
    )
  }
  return blocks
}

function reachVideo(result: Rec): ChatUiBlock[] {
  if (!result.ok) return []
  const hasTranscript = !!text(result.transcript, '', 20)
  // 不再单独出 source-list 卡——视频链接以底部「打开原视频」呈现。
  return [
    block('summary', '视频读取结果', {
      body: hasTranscript
        ? longText(result.transcript, '已读取字幕。', 520)
        : longText(result.metadata, '未读取到完整字幕，仅可基于视频元数据判断。', 520),
      metrics: [
        metric('平台', result.platform),
        metric('来源', result.transcriptSource || '-'),
        metric('字幕', hasTranscript ? '可用' : '未获取', hasTranscript ? 'ok' : 'warn'),
        metric('字幕状态', result.subtitleAvailable === true ? '有字幕状态' : result.subtitleAvailable === false ? '无公开字幕' : '-'),
        metric('时长', result.duration ? `${result.duration}s` : '-'),
      ],
      sections: Array.isArray(result.fallbackActions) && result.fallbackActions.length
        ? [{ title: '兜底建议', items: result.fallbackActions.slice(0, 4).map((v) => text(v, '', 160)) }]
        : [],
      sourceUrl: String(result.url || ''),
      sourceLabel: '打开原视频',
    }, text(result.title || result.url, '', 120)),
  ]
}

function reachMarkdown(result: Rec): ChatUiBlock[] {
  if (!result.ok) return []
  return [
    block('summary', '调研记录 Markdown', {
      body: longText(result.markdown, '已生成 Markdown 调研记录。', 700),
      metrics: [
        metric('标题', result.title || '调研记录'),
        metric('字数', String(result.markdown || '').length),
      ],
    }, '可复制到知识库或任务备注'),
  ]
}

/**
 * 把 reach 工具的活动卡结果（JSON 字符串）渲染成人类可读摘要。
 * 与 reachUiBlocksFromToolResult 复用同一套 text/longText/list 字段读取，避免两处字段映射漂移。
 * 返回 null 表示不是 reach 工具、或结果不可解析——调用方回退 pretty JSON 预览。
 */
export function summarizeReachResult(wireName: string, resultJson: string): string | null {
  if (!wireName.startsWith('reach__')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(resultJson)
  } catch {
    return null
  }
  const result = isRecord(parsed) ? parsed : {}
  if (result.error) return `出错：${text(result.error, '', 200)}`
  switch (wireName) {
    case 'reach__search': {
      const results = list(result.results)
      const lines = [`共 ${results.length} 条结果`]
      results.forEach((r, i) => {
        lines.push(`[${i + 1}] ${text(r.title || r.url, '', 80)}`)
        if (r.url) lines.push(`    ${text(r.url, '', 200)}`)
        const meta = [r.provider, r.publishedAt].filter(Boolean).map((v) => text(v, '', 60)).join(' · ')
        if (meta) lines.push(`    ${meta}`)
        if (r.snippet) lines.push(`    ${longText(r.snippet, '', 140)}`)
      })
      return lines.join('\n')
    }
    case 'reach__read_url': {
      const lines = [
        `标题：${text(result.title, '-', 120)}`,
        result.url ? `URL：${text(result.url, '', 200)}` : '',
        `裁剪：${result.limited ? '已裁剪' : '完整'}`,
        `正文（${len(result.text)} 字）：`,
        longText(result.text, '', 600),
      ].filter(Boolean)
      return lines.join('\n')
    }
    case 'reach__github_repo': {
      const lines = [`仓库：${text(result.repo, '-', 120)}`]
      const metrics = [
        `Stars ${result.stars ?? '-'}`,
        `Forks ${result.forks ?? '-'}`,
        `Issues ${result.openIssues ?? '-'}`,
        result.license ? `License ${text(result.license, '', 40)}` : '',
        result.language ? `Language ${text(result.language, '', 40)}` : '',
        result.pushedAt || result.updatedAt ? `Updated ${text(result.pushedAt || result.updatedAt, '', 30)}` : '',
      ].filter(Boolean)
      lines.push(metrics.join(' · '))
      const desc = longText(result.description, '', 200)
      if (desc) lines.push(`描述：${desc}`)
      const commits = list(result.recentCommits)
      if (commits.length) {
        lines.push('近期提交：')
        commits.slice(0, 4).forEach((c) => lines.push(`  ${text(c.sha, '', 8)} ${text(c.message, '', 100)}`))
      }
      return lines.join('\n')
    }
    case 'reach__video_summary': {
      const lines = [
        `标题：${text(result.title, '-', 120)}`,
        `平台：${text(result.platform, '-', 40)}`,
        `字幕：${result.subtitleAvailable === true ? '有' : result.subtitleAvailable === false ? '无' : '-'}`,
        result.duration ? `时长：${result.duration}s` : '',
      ].filter(Boolean)
      const body = longText(result.transcript || result.metadata, '', 600)
      if (body) lines.push(`内容（${len(result.transcript || result.metadata)} 字）：`, body)
      return lines.join('\n')
    }
    case 'reach__markdown_note': {
      return `字数：${len(result.markdown)}\n${longText(result.markdown, '', 800)}`
    }
    default:
      return null
  }
}

export function reachUiBlocksFromToolResult(wireName: string, result: unknown): ChatUiBlock[] {
  if (!isRecord(result) || result.error) return []
  switch (wireName) {
    case 'reach__status':
      return reachStatus(result)
    case 'reach__search':
      return reachSearch(result)
    case 'reach__read_url':
      return reachReadUrl(result)
    case 'reach__github_repo':
      return reachGithub(result)
    case 'reach__video_summary':
      return reachVideo(result)
    case 'reach__markdown_note':
      return reachMarkdown(result)
    default:
      return []
  }
}
