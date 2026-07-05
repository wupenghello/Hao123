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

function item(title: unknown, meta?: unknown, description?: unknown, badges?: unknown[], tone = 'info'): Rec {
  return {
    title: text(title, '未命名', 120),
    meta: text(meta, '', 120),
    description: longText(description, '', 320),
    badges: (badges ?? []).map((b) => text(b, '', 40)).filter(Boolean).slice(0, 4),
    tone,
  }
}

function sourceCards(sources: Rec[], title = '外部来源'): ChatUiBlock[] {
  if (!sources.length) return []
  return [
    block('source-list', title, {
      sources: sources.slice(0, 6).map((source, i) => ({
        title: `[${i + 1}] ${text(source.title || source.url, '来源', 100)}`,
        subtitle: [source.provider, source.publishedAt].filter(Boolean).join(' · '),
        excerpt: longText(source.snippet, '', 260),
        url: source.url,
        confidence: source.provider ? 'source' : undefined,
      })),
    }),
  ]
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
  return [
    block('item-list', '外部搜索结果', {
      items: results.slice(0, 5).map((r, i) => item(
        `[${i + 1}] ${r.title || r.url}`,
        [r.provider, r.publishedAt].filter(Boolean).join(' · '),
        r.snippet,
        [r.url],
      )),
    }, text(result.query, '', 100)),
    ...sourceCards(results, '搜索来源'),
  ]
}

function reachReadUrl(result: Rec): ChatUiBlock[] {
  if (!result.ok) return []
  const source = isRecord(result.source) ? result.source : { url: result.url, title: result.title, provider: 'jina-reader' }
  return [
    block('summary', '网页读取结果', {
      body: longText(result.text, '已读取网页内容。', 520),
      metrics: [
        metric('标题', result.title || '未识别'),
        metric('裁剪', result.limited ? '已裁剪' : '完整'),
      ],
    }, text(result.url, '', 120)),
    ...sourceCards([source], '网页来源'),
  ]
}

function reachGithub(result: Rec): ChatUiBlock[] {
  if (!result.ok) return []
  const commits = list(result.recentCommits)
  const issues = list(result.recentIssues)
  const sources = list(result.sources)
  return [
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
      sections: [
        commits.length ? { title: '近期提交', items: commits.slice(0, 4).map((c) => `${text(c.sha, '', 12)} · ${text(c.message, '', 120)}`) } : null,
        issues.length ? { title: '近期 Issue', items: issues.slice(0, 4).map((i) => `#${i.number} · ${text(i.title, '', 120)}`) } : null,
      ].filter(Boolean),
    }, text(result.repo, '', 100)),
    ...sourceCards(sources, '仓库来源'),
  ]
}

function reachVideo(result: Rec): ChatUiBlock[] {
  if (!result.ok) return []
  const sources = list(result.sources)
  const hasTranscript = !!text(result.transcript, '', 20)
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
    }, text(result.title || result.url, '', 120)),
    ...sourceCards(sources, '视频来源'),
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
