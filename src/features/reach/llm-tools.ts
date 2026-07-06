import type { LlmTool, LlmToolDef } from '@/features/chat/llm/types'
import {
  fetchReachGithubRepo,
  fetchReachReadUrl,
  fetchReachSearch,
  fetchReachStatus,
  fetchReachVideoSummary,
} from './api'
import { buildMarkdownNote, normalizeMarkdownNote } from './report'

export const reachEnabled =
  import.meta.env.DEV &&
  /^(1|true|yes|on)$/i.test(import.meta.env.VITE_AGENT_REACH_ENABLED?.trim() || '')

function disabled() {
  return {
    enabled: false,
    error: '外部调研能力未启用。请在 .env 设置 VITE_AGENT_REACH_ENABLED=true，并安装 Agent Reach 后重启 dev server。',
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

const statusTool: LlmTool<Record<string, never>> = {
  name: 'reach.status',
  description:
    '检查小吴的外部调研能力是否可用：Agent Reach 是否安装、mcporter/yt-dlp/gh/bili/opencli 等上游工具是否存在，以及 doctor 体检结果。' +
    '【适用】用户问外部调研能力是否启用、为什么不能搜索/读视频、Agent Reach 是否安装。',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute(_, signal) {
    if (!reachEnabled) return disabled()
    return fetchReachStatus(signal)
  },
}

const searchTool: LlmTool<{ query: string; limit?: number }> = {
  name: 'reach.search',
  description:
    '搜索公开互联网资料，优先使用 Agent Reach 配置的 Exa/mcporter，失败时 dev server 会尝试公开搜索兜底。' +
    '【适用】用户明确要求“查一下/搜索/调研/最近/最新/网上怎么说/找资料”等外部世界信息。' +
    '返回标题、链接、摘要（含发布日期 publishedAt）和来源；回答必须基于来源，引用时使用与返回列表完全相同的 [n] 编号，不要编造。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词或问题。' },
      limit: { type: 'number', description: '结果数量，默认 5，上限 5。' },
    },
    required: ['query'],
  },
  async execute({ query, limit }, signal) {
    if (!reachEnabled) return disabled()
    const q = str(query)
    if (!q) return { enabled: true, ok: false, query: '', results: [], error: '缺少搜索关键词 query' }
    return fetchReachSearch(q, Math.min(Number(limit) || 5, 5), signal)
  },
}

const readUrlTool: LlmTool<{ url: string }> = {
  name: 'reach.read_url',
  description:
    '读取一个公开 http/https 网页链接，使用 Agent Reach 推荐的 Jina Reader 路径提取 Markdown/正文。' +
    '【适用】用户发链接让你“读一下/总结/分析/看看里面和我们项目相关的点”。不使用浏览器登录态。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '公开 http/https 网页 URL。' },
    },
    required: ['url'],
  },
  async execute({ url }, signal) {
    if (!reachEnabled) return disabled()
    const target = str(url)
    if (!/^https?:\/\//i.test(target)) {
      return { enabled: true, ok: false, url: target, error: '只支持 http/https 链接' }
    }
    return fetchReachReadUrl(target, signal)
  },
}

const githubRepoTool: LlmTool<{ repo: string }> = {
  name: 'reach.github_repo',
  description:
    '分析公开 GitHub 仓库：读取仓库元信息、README、最近提交、近期 issue，并返回来源。' +
    '【适用】用户发 GitHub 仓库链接，或问“这个仓库是干嘛的/靠不靠谱/适不适合引进我们项目”。' +
    '回答时从产品价值、技术成熟度、活跃度、风险和引入建议几个角度判断；若仓库已 archived 或近 6 个月无提交，必须在结论里点明“已停止维护”。',
  parameters: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'GitHub 仓库 URL 或 owner/repo，如 Panniantong/agent-reach。' },
    },
    required: ['repo'],
  },
  async execute({ repo }, signal) {
    if (!reachEnabled) return disabled()
    const target = str(repo)
    if (!target) return { enabled: true, ok: false, error: '缺少 GitHub 仓库地址或 owner/repo' }
    return fetchReachGithubRepo(target, signal)
  },
}

const videoSummaryTool: LlmTool<{ url: string }> = {
  name: 'reach.video_summary',
  description:
    '读取公开 YouTube/B站视频的字幕或视频元数据。YouTube 优先 yt-dlp 字幕；B站优先 opencli bilibili subtitle，缺字幕时返回 bili video 元数据。' +
    '【适用】用户发视频链接让你总结、提炼要点、判断是否值得看。若工具明确返回没有字幕，只能基于元数据说明限制，不要假装看过完整视频。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'YouTube/B站等公开视频 URL。' },
    },
    required: ['url'],
  },
  async execute({ url }, signal) {
    if (!reachEnabled) return disabled()
    const target = str(url)
    if (!/^https?:\/\//i.test(target)) {
      return { enabled: true, ok: false, url: target, error: '只支持 http/https 视频链接' }
    }
    return fetchReachVideoSummary(target, signal)
  },
}

const markdownNoteTool: LlmTool<Record<string, unknown>> = {
  name: 'reach.markdown_note',
  description:
    '把已经完成的外部调研、GitHub 仓库评估、网页阅读或视频摘要整理成 Markdown 记录，供用户复制到知识库、任务备注或周报。' +
    '【使用时机】用户说“沉淀一下/整理成文档/生成 Markdown/记到知识库/输出调研记录”时使用。' +
    '必须基于已获得的搜索、网页、GitHub 或视频证据；不要凭空添加来源。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Markdown 标题。' },
      verdict: { type: 'string', description: '一句结论或建议，如“建议二期试点接入”。' },
      summary: { type: 'string', description: '调研摘要。' },
      sections: {
        type: 'array',
        description: '分节内容，如关键发现、对项目影响、风险、下一步。',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            items: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'items'],
        },
      },
      sources: {
        type: 'array',
        description: '来源链接列表，来自 reach.search/read_url/github_repo/video_summary 的结果。',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' },
            snippet: { type: 'string' },
            provider: { type: 'string' },
            publishedAt: { type: 'string' },
          },
          required: ['url'],
        },
      },
    },
    required: ['title'],
  },
  async execute(params) {
    if (!reachEnabled) return disabled()
    const note = normalizeMarkdownNote(params)
    const markdown = buildMarkdownNote(note)
    return {
      enabled: reachEnabled,
      ok: true,
      title: note.title,
      markdown,
      sources: note.sources,
      note: '已生成 Markdown，可复制到知识库、任务备注或本地文档。',
    }
  },
}

export const reachTools: LlmTool[] = [
  statusTool,
  searchTool,
  readUrlTool,
  githubRepoTool,
  videoSummaryTool,
  markdownNoteTool,
]

export const reachToolDefs: LlmToolDef[] = reachTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

export async function callReachTool(name: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
  const tool = reachTools.find((t) => t.name === name)
  if (!tool) return { error: `未知外部调研工具：${name}` }
  try {
    return await tool.execute((params ?? {}) as Record<string, unknown>, signal)
  } catch (e) {
    return { enabled: reachEnabled, ok: false, error: (e as Error)?.message || '外部调研工具调用失败' }
  }
}
