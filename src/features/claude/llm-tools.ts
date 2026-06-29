/**
 * Claude Code 本地启动 · LLM 工具层
 *
 * 以工具形式暴露给小吴：查询可用性、启动 Claude Code CLI。
 * 与wbscf/天气/禅道等工具层同构。
 *
 * 生产构建无dev server，端点404时降级为{enabled:false}，让模型说明当前不可用。
 */
import type { LlmToolDef, LlmTool } from '@/features/chat/llm/types'
import { fetchClaudeStatus, triggerClaudeLaunch } from './api'

/** 安全获取状态，失败时降级为不可用 */
async function safeFetchStatus(): Promise<{ enabled: boolean }> {
  try {
    return await fetchClaudeStatus()
  } catch {
    return { enabled: false }
  }
}

/** 1. 查询 Claude Code 启动功能是否可用 */
const statusTool: LlmTool<Record<string, never>, unknown> = {
  name: 'claude.status',
  description:
    '查询 Claude Code CLI 启动功能是否可用（需要在dev模式且配置了VITE_WBSCF_WEB_ROOT环境变量指向wbscf-web代码库根目录）。' +
    '【适用】用户问Claude相关功能是否可用、能不能启动Claude等场景。只读查询，不改变状态。' +
    '生产环境或未配置时返回enabled=false。',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute() {
    return await safeFetchStatus()
  },
}

/** 2. 启动 Claude Code CLI */
const launchTool: LlmTool<{ signal?: AbortSignal }, unknown> = {
  name: 'claude.launch',
  description:
    '在wbscf-web代码库根目录下新开独立终端窗口启动 Claude Code CLI，与用户点击状态栏Claude按钮效果完全一致。' +
    '启动成功后会打开新的终端窗口运行claude命令，不影响当前Hao123页面。' +
    '【适用】用户说「打开Claude」「启动Claude Code」「帮我开个Claude窗口」「在wbscf目录启动Claude」等场景。' +
    '【不适用】生产环境或未配置VITE_WBSCF_WEB_ROOT时无法使用，会返回enabled=false。' +
    '注意：启动后终端窗口由用户自行管理，Hao123退出不会自动关闭Claude窗口。',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute({ signal }) {
    if (signal?.aborted) return { aborted: true }
    const status = await safeFetchStatus()
    if (!status.enabled) {
      return {
        enabled: false,
        note: 'Claude启动功能不可用：需要在dev模式下配置VITE_WBSCF_WEB_ROOT环境变量指向wbscf-web代码库根目录。',
      }
    }

    try {
      const result = await triggerClaudeLaunch(signal)
      if (result.ok) {
        return {
          enabled: true,
          action: 'launched',
          note: '已成功新开终端窗口启动Claude Code，工作目录为wbscf-web根目录。',
        }
      }
      return {
        enabled: true,
        action: 'failed',
        error: result.error || '未知错误',
        note: '启动失败，请确认已全局安装Claude Code CLI：npm i -g @anthropic-ai/claude-code',
      }
    } catch (e) {
      return {
        enabled: true,
        action: 'error',
        error: (e as Error)?.message || String(e),
        note: '启动请求失败，请检查dev server是否正常运行。',
      }
    }
  },
}

/** 全部 Claude 工具 */
export const claudeTools: LlmTool[] = [statusTool, launchTool]

/** 喂给LLM的工具声明（剥离execute，可直接序列化） */
export const claudeToolDefs: LlmToolDef[] = claudeTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

/**
 * 按名执行Claude工具（LLM返回tool_call后由此分发）。
 * 出错返回{error}文本而非抛出，避免中断整轮对话。
 * signal 由 chat store 的 AbortController 透传，让 claude.launch 的 in-flight 请求
 * 可被用户「停止生成」中断（对齐 callWbscfTool 约定）。
 */
export async function callClaudeTool(
  name: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const tool = claudeTools.find((t) => t.name === name)
  if (!tool) return { error: `未知 Claude 工具：${name}` }
  try {
    // 把 signal 挂进 params（模型不会发该字段，工具按需读取），与 callWbscfTool 口径一致
    const args = { ...(params as Record<string, unknown> | null), signal } as Record<string, unknown>
    return await tool.execute(args)
  } catch (e) {
    return { error: (e as Error)?.message || 'Claude 工具执行失败' }
  }
}
