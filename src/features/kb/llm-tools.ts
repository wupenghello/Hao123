/**
 * 知识库 · LLM 工具层（function-calling / tool-use）
 *
 * 与天气 / 禅道工具层同构（复用 LlmToolDef 接口），把「检索项目内部文档」
 * 以工具形式暴露给大模型：
 *   - kbToolDefs       喂给 LLM 的工具声明（name + description + 参数 JSON Schema）
 *   - callKbTool(name, params)  执行 LLM 选中的工具，返回结构化片段
 *
 * 设计原则：
 *   - 数据来源可配置（本地文件夹 / 远程 manifest，见 config.ts），无固定后端依赖；
 *   - 片段正文原样返回（不截断），保证信息完整；如需省 token，应在切片层控制片段大小，
 *     而非在工具层丢尾巴——否则长段落后半段（如凭据表里的 WiFi 项）会永远取不到；
 *   - 检索后端可替换（关键词 → 向量 / 外部 RAG 服务），工具接口不变。
 */
import type { LlmToolDef, LlmTool } from '@/features/chat/llm/types'
import { searchKb } from './search'
import { fetchRagHealth } from './api'
import { getKbChunks } from './loader'
import { kbConfig } from './config'

/** 1. 检索知识库 */
const searchTool: LlmTool<{ query: string; top_k?: number }> = {
  name: 'kb.search',
  description:
    '检索项目内部与个人笔记 RAG 知识库，返回最相关的文档片段、来源引用、置信度、命中词；图片命中会带 assetUrl，聊天层会自动交给视觉模型查看。知识库含：开发/测试/预发/生产各环境域名、部署流程、个人笔记、人名事实、常见问答、PDF/图片/Office sidecar 摘要等。' +
    '【适用】用户问项目内部信息或个人知识库事实——环境地址/域名、部署/发布流程、内部约定、笔记、FAQ、人名/人物相关记录、某个文件里写了什么等。这些不是通用知识，必须先查知识库再回答。' +
    '【不适用】用户问天气、禅道任务/Bug、或通用常识——用对应工具或自身知识回答，不要调用本工具。' +
    '回答时优先引用 high/medium 置信度结果；低置信或 0 命中时说明知识库未覆盖，不要编造。若命中图片且随后收到图片上下文，请直接看图回答，不要要求用户重新上传。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索关键词或问题，如「开发环境域名」「如何部署」「忘记密码」',
      },
      top_k: { type: 'integer', description: '返回片段数，默认 5', minimum: 1, maximum: 8 },
    },
    required: ['query'],
  },
  async execute({ query, top_k }, signal) {
    // query 是 required 字段，但模型偶尔会漏传；给出可操作的错误而非抛 TypeError
    const q = typeof query === 'string' ? query.trim() : ''
    if (!q) return { query: '', count: 0, results: [], error: '缺少必填参数 query（检索关键词）' }

    const k = Number(top_k) > 0 ? Math.min(Number(top_k), 8) : 5
    const hits = await searchKb(q, k, signal)
    return {
      query: q,
      count: hits.length,
      results: hits.map((h) => ({
        doc: h.doc,
        docTitle: h.docTitle,
        section: h.section || undefined,
        sourceType: h.sourceType,
        score: h.score,
        confidence: h.confidence,
        matchedTerms: h.matchedTerms,
        citation: h.citation,
        highlights: h.highlights,
        assetUrl: h.assetUrl,
        mimeType: h.mimeType,
        metadata: h.metadata ? {
          path: h.metadata.path,
          mimeType: h.metadata.mimeType,
          tags: h.metadata.tags,
          aliases: h.metadata.aliases,
          owner: h.metadata.owner,
          lastReviewedAt: h.metadata.lastReviewedAt,
          redacted: h.metadata.redacted,
          warnings: h.metadata.warnings,
        } : undefined,
        content: h.content,
      })),
    }
  },
}

/** 2. 查询知识库健康状态 */
const healthTool: LlmTool<Record<string, never>> = {
  name: 'kb.health',
  description:
    '查看 RAG 知识库健康状态：是否启用、来源、文档数、片段数、各类型文件覆盖、解析警告/错误。' +
    '【适用】用户问知识库有没有配置、收了哪些类型文件、PDF/图片是否已解析、为什么搜不到资料等。',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_, signal) {
    try {
      // 远程 manifest 不由 dev RAG 服务接管；直接走静态加载层才能得到真实文档数。
      if (!kbConfig.isRemote) return await fetchRagHealth(signal)
    } catch {
      // ignore and use static fallback
    }

    const chunks = await getKbChunks(signal)
    const coverage: Record<string, number> = {}
    for (const c of chunks) {
      const key = c.sourceType || 'markdown'
      coverage[key] = (coverage[key] || 0) + 1
    }
    return {
      enabled: kbConfig.hasSource,
      source: kbConfig.source,
      mode: kbConfig.isRemote ? 'remote' : kbConfig.hasSource ? 'static' : 'disabled',
      backend: kbConfig.isRemote ? 'remote' : kbConfig.hasSource ? 'static' : 'disabled',
      docCount: new Set(chunks.map((c) => c.doc)).size,
      chunkCount: chunks.length,
      parserCoverage: coverage,
      warnings: [],
      errors: [],
    }
  },
}

/** 全部知识库工具 */
export const kbTools: LlmTool[] = [searchTool, healthTool]

/** 喂给 LLM 的工具声明（剥离 execute，可直接序列化） */
export const kbToolDefs: LlmToolDef[] = kbTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

/**
 * 按名执行知识库工具（LLM 返回 tool_call 后由此分发）。
 * 与 callZentaoTool 一致：执行出错时返回 { error } 文本而非抛出，
 * 既避免中断整轮对话，也让上层（store）据 result.error 标记工具活动为错误。
 */
export async function callKbTool(name: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
  const tool = kbTools.find((t) => t.name === name)
  if (!tool) return { error: `未知知识库工具：${name}` }
  try {
    return await tool.execute((params ?? {}) as Record<string, unknown>, signal)
  } catch (e) {
    return { error: (e as Error)?.message || '知识库查询失败' }
  }
}
