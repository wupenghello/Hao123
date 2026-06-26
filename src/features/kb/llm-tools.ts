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

/** 1. 检索知识库 */
const searchTool: LlmTool<{ query: string; top_k?: number }> = {
  name: 'kb.search',
  description:
    '检索项目内部知识库，返回最相关的文档片段。知识库含：开发/测试/预发/生产各环境域名、部署流程、个人笔记、常见问答等。' +
    '【适用】用户问项目内部信息——环境地址/域名、部署/发布流程、内部约定、笔记、FAQ 等。这些不是通用知识，必须先查知识库再回答。' +
    '【不适用】用户问天气、禅道任务/Bug、或通用常识——用对应工具或自身知识回答，不要调用本工具。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索关键词或问题，如「开发环境域名」「如何部署」「忘记密码」',
      },
      top_k: { type: 'integer', description: '返回片段数，默认 3', minimum: 1, maximum: 8 },
    },
    required: ['query'],
  },
  async execute({ query, top_k }) {
    // query 是 required 字段，但模型偶尔会漏传；给出可操作的错误而非抛 TypeError
    const q = typeof query === 'string' ? query.trim() : ''
    if (!q) return { query: '', count: 0, results: [], error: '缺少必填参数 query（检索关键词）' }

    const k = Number(top_k) > 0 ? Math.min(Number(top_k), 8) : 3
    const hits = await searchKb(q, k)
    return {
      query: q,
      count: hits.length,
      results: hits.map((h) => ({
        doc: h.doc,
        docTitle: h.docTitle,
        section: h.section || undefined,
        content: h.content,
      })),
    }
  },
}

/** 全部知识库工具 */
export const kbTools: LlmTool[] = [searchTool]

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
export async function callKbTool(name: string, params: unknown): Promise<unknown> {
  const tool = kbTools.find((t) => t.name === name)
  if (!tool) return { error: `未知知识库工具：${name}` }
  try {
    return await tool.execute((params ?? {}) as Record<string, unknown>)
  } catch (e) {
    return { error: (e as Error)?.message || '知识库查询失败' }
  }
}
