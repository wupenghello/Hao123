import type { LlmTool, LlmToolDef } from './llm/types'
import type { ChatUiBlock, ChatUiKind } from './types'
import { reachUiBlocksFromToolResult } from '@/features/reach'

type Rec = Record<string, unknown>

const UI_KINDS: ChatUiKind[] = [
  'summary',
  'metrics',
  'item-list',
  'data-table',
  'timeline',
  'weather-current',
  'weather-forecast',
  'status-grid',
  'source-list',
]

function isRecord(v: unknown): v is Rec {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function text(v: unknown, fallback = '', max = 160): string {
  if (v == null) return fallback
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max) || fallback
}

function longText(v: unknown, fallback = '', max = 800): string {
  if (v == null) return fallback
  return String(v).trim().slice(0, max) || fallback
}

function list(v: unknown): Rec[] {
  return Array.isArray(v) ? v.filter(isRecord) : []
}

function pickKind(v: unknown): ChatUiKind {
  const s = String(v || '')
  return UI_KINDS.includes(s as ChatUiKind) ? (s as ChatUiKind) : 'summary'
}

function toneFrom(v: unknown): string {
  const s = String(v || '')
  return ['ok', 'info', 'warn', 'danger', 'muted'].includes(s) ? s : 'info'
}

function safeJson(v: unknown, depth = 0): unknown {
  if (depth > 4) return undefined
  if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.slice(0, 20).map((item) => safeJson(item, depth + 1))
  if (!isRecord(v)) return String(v)
  const out: Rec = {}
  for (const [key, value] of Object.entries(v).slice(0, 60)) {
    const clean = safeJson(value, depth + 1)
    if (clean !== undefined) out[key] = clean
  }
  return out
}

function safeProps(v: unknown): Rec {
  const clean = safeJson(v)
  return isRecord(clean) ? clean : {}
}

function block(kind: ChatUiKind, title: string, props: Rec, subtitle?: string): ChatUiBlock {
  return {
    id: `ui_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title: text(title, '信息卡片', 80),
    subtitle: subtitle ? text(subtitle, '', 120) : undefined,
    props,
  }
}

function normalizeUiBlock(raw: unknown): ChatUiBlock | null {
  if (!isRecord(raw)) return null
  const kind = pickKind(raw.kind)
  return block(
    kind,
    text(raw.title, defaultTitle(kind), 80),
    safeProps(raw.props),
    text(raw.subtitle, '', 120) || undefined,
  )
}

function defaultTitle(kind: ChatUiKind): string {
  const map: Record<ChatUiKind, string> = {
    summary: '概要',
    metrics: '指标',
    'item-list': '清单',
    'data-table': '数据表',
    timeline: '处理步骤',
    'weather-current': '实时天气',
    'weather-forecast': '天气预报',
    'status-grid': '状态',
    'source-list': '来源',
  }
  return map[kind]
}

function renderResult(blocks: ChatUiBlock[]) {
  return {
    rendered: blocks.length > 0,
    uiBlocks: blocks,
    note: blocks.length
      ? '已把结构化界面块渲染到聊天窗口。请用一句话解释卡片里的关键结论，不要重复整张卡片。'
      : '没有可渲染的界面块。',
  }
}

const uiRenderTool: LlmTool<{ blocks?: unknown[] }> = {
  name: 'ui.render',
  description:
    '在聊天窗口渲染生成式 UI 卡片。适用于天气、任务清单、Bug 列表、Git 状态、服务状态、对比表、处理步骤等结构化答案。' +
    '只能选择白名单 kind 并传 props；不要输出 Vue/JSX/HTML 代码。若数据需要实时或内部信息，必须先调用对应查询工具拿到真实数据，再用本工具组织界面。',
  parameters: {
    type: 'object',
    properties: {
      blocks: {
        type: 'array',
        description: '要渲染的卡片，最多 3 个。',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: UI_KINDS,
              description:
                'summary/metrics/item-list/data-table/timeline/weather-current/weather-forecast/status-grid/source-list',
            },
            title: { type: 'string', description: '卡片标题，简短明确。' },
            subtitle: { type: 'string', description: '可选副标题。' },
            props: {
              type: 'object',
              description:
                '组件数据。item-list 用 {items:[{title,meta,description,badges,tone}]}；data-table 用 {columns:[{key,label}],rows:[...]}；timeline 用 {steps:[{title,detail,status}]}；summary/metrics 用 {body,metrics,sections}。',
            },
          },
          required: ['kind', 'title', 'props'],
        },
      },
    },
    required: ['blocks'],
  },
  async execute({ blocks }) {
    const normalized = (Array.isArray(blocks) ? blocks : [])
      .slice(0, 3)
      .map(normalizeUiBlock)
      .filter((b): b is ChatUiBlock => !!b)
    return renderResult(normalized)
  },
}

export const uiToolDefs: LlmToolDef[] = [
  {
    name: uiRenderTool.name,
    description: uiRenderTool.description,
    parameters: uiRenderTool.parameters,
  },
]

export async function callUiTool(name: string, params: unknown): Promise<unknown> {
  if (name !== uiRenderTool.name) return { error: `未知 UI 工具：${name}` }
  return uiRenderTool.execute((params ?? {}) as { blocks?: unknown[] })
}

export function uiBlocksFromRenderResult(result: unknown): ChatUiBlock[] {
  if (!isRecord(result) || !Array.isArray(result.uiBlocks)) return []
  return result.uiBlocks.map(normalizeUiBlock).filter((b): b is ChatUiBlock => !!b)
}

export function summarizeUiRenderResult(result: unknown): unknown {
  const blocks = uiBlocksFromRenderResult(result)
  if (!blocks.length) return result
  return {
    rendered: true,
    blocks: blocks.map((b) => ({ kind: b.kind, title: b.title })),
    note: '界面卡片已渲染给用户。',
  }
}

function item(
  title: unknown,
  meta?: unknown,
  description?: unknown,
  badges?: unknown[],
  tone?: unknown,
): Rec {
  return {
    title: text(title, '未命名', 120),
    meta: text(meta, '', 120),
    description: longText(description, '', 320),
    badges: (badges ?? []).map((b) => text(b, '', 40)).filter(Boolean).slice(0, 4),
    tone: toneFrom(tone),
  }
}

function metric(label: string, value: unknown, tone = 'info'): Rec {
  return { label, value: value ?? '-', tone }
}

function weatherCurrent(result: Rec): ChatUiBlock[] {
  if (result.error) return []
  return [
    block('weather-current', `${text(result.city, '当前城市')}天气`, {
      temp: result.temp,
      text: result.text,
      feelsLike: result.feelsLike,
      observedAt: result.observedAt,
      humidity: result.humidity,
      precip: result.precip,
      visibility: result.visibility,
      wind: result.wind,
      metrics: [
        metric('体感', result.feelsLike != null ? `${result.feelsLike}°` : '-'),
        metric('湿度', result.humidity != null ? `${result.humidity}%` : '-'),
        metric('降水', result.precip != null ? `${result.precip}mm` : '-'),
      ],
    }),
  ]
}

function weatherForecast(result: Rec, mode: 'daily' | 'hourly'): ChatUiBlock[] {
  const forecast = list(result.forecast)
  if (!forecast.length) return []
  const rows = forecast.slice(0, mode === 'daily' ? 7 : 12).map((d) => ({
    label: text(mode === 'daily' ? d.date : d.time, ''),
    primary: mode === 'daily'
      ? `${d.tempMin ?? '-'}° / ${d.tempMax ?? '-'}°`
      : `${d.temp ?? '-'}°`,
    secondary: text(d.textDay || d.text || d.textNight, '', 80),
    detail: mode === 'daily'
      ? text(d.windDay && isRecord(d.windDay) ? d.windDay.dir : '', '', 60)
      : d.pop != null ? `降水 ${d.pop}%` : '',
  }))
  return [
    block('weather-forecast', `${text(result.city, '城市')}天气预报`, {
      mode,
      rows,
    }, mode === 'daily' ? `${result.days ?? forecast.length} 天` : `${result.hours ?? ''} 小时`),
  ]
}

function weatherIndices(result: Rec): ChatUiBlock[] {
  const indices = list(result.indices)
  if (!indices.length) return []
  return [
    block('item-list', `${text(result.city, '城市')}生活指数`, {
      items: indices.slice(0, 8).map((ix) => item(ix.name, ix.category, ix.text, [ix.level], 'info')),
      emptyText: '暂无生活指数',
    }),
  ]
}

function zentaoTasks(result: Rec): ChatUiBlock[] {
  const tasks = list(result.tasks)
  if (!tasks.length) return []
  return [
    block('item-list', '禅道任务', {
      items: tasks.slice(0, 10).map((t) => item(
        t.name,
        [t.project, t.deadline ? `截止 ${t.deadline}` : undefined].filter(Boolean).join(' · '),
        `状态：${text(t.status, '-', 40)}`,
        [`#${t.id}`, `P${t.pri ?? '-'}`],
        Number(t.pri) <= 2 ? 'warn' : 'info',
      )),
    }, `${result.count ?? tasks.length} 条`),
  ]
}

function zentaoBugs(result: Rec): ChatUiBlock[] {
  const bugs = list(result.bugs)
  if (!bugs.length) return []
  return [
    block('item-list', '禅道 Bug', {
      items: bugs.slice(0, 10).map((b) => item(
        b.title,
        [b.product, b.status].filter(Boolean).join(' · '),
        b.assignedTo ? `指派给：${b.assignedTo}` : '',
        [`#${b.id}`, `S${b.severity ?? '-'}`, `P${b.pri ?? '-'}`],
        Number(b.severity) <= 2 || Number(b.pri) <= 2 ? 'danger' : 'warn',
      )),
    }, `${result.count ?? bugs.length} 条`),
  ]
}

function localTasks(result: Rec): ChatUiBlock[] {
  const open = list(result.open)
  const done = list(result.done)
  const tasks = [...open, ...done]
  if (!tasks.length) return []
  return [
    block('item-list', '本地待办', {
      items: tasks.slice(0, 10).map((t) => item(
        t.title,
        [t.deadline ? `截止 ${t.deadline}` : undefined, t.done ? '已完成' : '未完成'].filter(Boolean).join(' · '),
        t.note,
        [`P${t.pri ?? '-'}`, ...(Array.isArray(t.attachments) && t.attachments.length ? [`附件 ${t.attachments.length}`] : [])],
        t.done ? 'muted' : Number(t.pri) <= 2 ? 'warn' : 'info',
      )),
    }, `${open.length} 未完成${done.length ? ` · ${done.length} 已完成` : ''}`),
  ]
}

function services(result: Rec): ChatUiBlock[] {
  const servicesList = list(result.services)
  const single = result.app || result.label ? [result] : []
  const rows = servicesList.length ? servicesList : single
  if (!rows.length) return []
  return [
    block('status-grid', '本地服务状态', {
      items: rows.map((s) => ({
        label: text(s.label || s.app, '服务', 40),
        status: s.running ? '运行中' : s.booting ? '启动中' : s.available === false ? '不可用' : '未启动',
        detail: s.port ? `:${s.port}` : '',
        url: text(s.url, '', 180),
        tone: s.running ? 'ok' : s.booting ? 'warn' : s.available === false ? 'danger' : 'muted',
      })),
    }),
  ]
}

function gitStatus(result: Rec): ChatUiBlock[] {
  if (!result.enabled) return []
  const status = isRecord(result.status) ? result.status : {}
  const sync = isRecord(result.sync) ? result.sync : {}
  const files = list(status.files)
  return [
    block('summary', 'Git 仓库状态', {
      body: status.clean ? '工作区干净，可以安心切换或拉取。' : '工作区有未提交变更，操作前先确认文件范围。',
      metrics: [
        metric('分支', result.branch),
        metric('变更', status.totalChanges ?? 0, Number(status.totalChanges) > 0 ? 'warn' : 'ok'),
        metric('领先', sync.ahead ?? 0),
        metric('落后', sync.behind ?? 0, Number(sync.behind) > 0 ? 'warn' : 'info'),
      ],
      sections: files.length
        ? [{
            title: '变更文件',
            items: files.slice(0, 8).map((f) => `${text(f.category, '', 30)} · ${text(f.path, '', 120)}`),
          }]
        : [],
    }),
  ]
}

function sourceList(result: Rec): ChatUiBlock[] {
  const hits = list(result.results)
  if (!hits.length) return []
  return [
    block('source-list', '知识库检索结果', {
      sources: hits.slice(0, 6).map((h) => {
        const citation = isRecord(h.citation) ? h.citation : {}
        return {
          title: text(h.docTitle || h.doc || h.section, '知识库片段', 80),
          subtitle: text(h.section || citation.label, '', 120),
          excerpt: longText(Array.isArray(h.highlights) ? h.highlights.join(' / ') : h.content, '', 260),
          confidence: h.confidence,
          score: h.score,
        }
      }),
    }),
  ]
}

function commitList(result: Rec): ChatUiBlock[] {
  const commits = list(result.commits)
  if (!commits.length) return []
  return [
    block('item-list', '提交记录', {
      items: commits.slice(0, 10).map((c) => item(
        c.message || c.subject || c.hash,
        [c.author, c.date].filter(Boolean).join(' · '),
        c.hash ? String(c.hash).slice(0, 10) : '',
        [],
        'info',
      )),
    }, text(result.branch || result.query, '', 80)),
  ]
}

function contributors(result: Rec): ChatUiBlock[] {
  const people = list(result.contributors)
  if (!people.length) return []
  return [
    block('metrics', '贡献者统计', {
      metrics: people.slice(0, 8).map((p) => metric(text(p.name || p.email, '贡献者', 60), p.commits ?? p.count ?? 0)),
    }, `${result.total ?? people.length} 人`),
  ]
}

export function uiBlocksFromToolResult(wireName: string, result: unknown): ChatUiBlock[] {
  if (!isRecord(result) || result.error || result.approvalRequired) return []
  if (wireName.startsWith('reach__')) return reachUiBlocksFromToolResult(wireName, result)
  switch (wireName) {
    case 'weather__current':
      return weatherCurrent(result)
    case 'weather__forecast_daily':
      return weatherForecast(result, 'daily')
    case 'weather__forecast_hourly':
      return weatherForecast(result, 'hourly')
    case 'weather__life_indices':
      return weatherIndices(result)
    case 'zentao__my_tasks':
      return zentaoTasks(result)
    case 'zentao__my_bugs':
      return zentaoBugs(result)
    case 'local__list':
      return localTasks(result)
    case 'wbscf__services':
    case 'wbscf__launch':
      return services(result)
    case 'git__status':
      return gitStatus(result)
    case 'git__log':
    case 'git__search':
      return commitList(result)
    case 'git__contributors':
      return contributors(result)
    case 'kb__search':
      return sourceList(result)
    default:
      return []
  }
}
