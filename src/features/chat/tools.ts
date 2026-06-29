/**
 * Chat 助手 · 工具聚合与分发层
 *
 * 把各特性模块的「中立工具声明」聚合并适配为 OpenAI 兼容格式（{type:'function',function:{...}}），
 * 并按工具名前缀把执行分发到各模块的 callXxxTool。
 *
 * 接新工具只需：在此引入对应模块的 ToolDefs + callTool，加进下面两处聚合即可。
 */
import { weatherToolDefs, callWeatherTool } from '@/features/weather'
import { zentaoToolDefs, callZentaoTool } from '@/features/zentao'
import { kbToolDefs, callKbTool } from '@/features/kb'
import { kbConfig } from '@/features/kb/config'
import { localTaskToolDefs, callLocalTaskTool } from '@/features/local-tasks'
import { wbscfToolDefs, callWbscfTool } from '@/features/wbscf'
import type { LlmToolDef } from './llm/types'

/** OpenAI 兼容的工具声明形态 */
export interface OpenAiTool {
  type: 'function'
  function: LlmToolDef
}

/**
 * 工具名适配：原始名带点号（如 weather.current），但 DeepSeek/OpenAI 要求函数名匹配
 * ^[a-zA-Z0-9_-]+$（不允许点号），故对外用 `__` 替代点号，分发时再还原。
 */
const toWireName = (name: string) => name.replace(/\./g, '__')
const fromWireName = (name: string) => name.replace(/__/g, '.')

/** 中立声明 → OpenAI {type:'function', function:{...}}（函数名做合法化） */
function toOpenAi(defs: LlmToolDef[]): OpenAiTool[] {
  return defs.map((d) => ({ type: 'function', function: { ...d, name: toWireName(d.name) } }))
}

/** 知识库是否已配置（有本地路径或远程 URL）；未配置时不把 kb 工具暴露给模型 */
export const kbEnabled = kbConfig.hasSource
/** wbscf-web 本地 dev 服务是否启用：dev 模式且配置了仓库根目录（VITE_WBSCF_WEB_ROOT）。
 *  生产构建无 dev server（/wbscf/* 必然 404），未配置根目录也无从拉起——两种情况都不暴露工具，
 *  避免 system prompt 宣称「能启动本地服务」却一调就报错（对齐 kbEnabled 门控约定）。 */
export const wbscfEnabled =
  import.meta.env.DEV && !!import.meta.env.VITE_WBSCF_WEB_ROOT?.trim()

/** 喂给 DeepSeek 的全部工具（天气 + 禅道只读查看 + 知识库检索 + 本地待办增删改查 + wbscf 本地服务状态） */
export const openAiTools: OpenAiTool[] = [
  ...toOpenAi(weatherToolDefs),
  ...toOpenAi(zentaoToolDefs),
  ...(kbEnabled ? toOpenAi(kbToolDefs) : []),
  ...toOpenAi(localTaskToolDefs),
  ...(wbscfEnabled ? toOpenAi(wbscfToolDefs) : []),
]

/**
 * 按名执行工具：依前缀路由到对应模块的分发器。
 * 入参 name 为模型返回的「线上名」（含 __），先还原为原始名再分发。
 * signal 透传给支持中断的工具（如 wbscf.launch 的长轮询），其它工具忽略。
 * @returns 结构化结果（由调用方序列化成 tool 消息内容）
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const realName = fromWireName(name)
  if (realName.startsWith('weather.')) return callWeatherTool(realName, args)
  if (realName.startsWith('zentao.')) return callZentaoTool(realName, args)
  if (realName.startsWith('kb.')) return callKbTool(realName, args)
  if (realName.startsWith('local.')) return callLocalTaskTool(realName, args)
  if (realName.startsWith('wbscf.')) return callWbscfTool(realName, args, signal)
  throw new Error(`未知工具：${realName}`)
}

/** 工具线上名 → 人类可读标签（用于 UI 展示「正在查询…」） */
const TOOL_LABELS: Record<string, string> = {
  'weather__current': '查询实时天气',
  'weather__forecast_daily': '查询每日预报',
  'weather__forecast_hourly': '查询逐小时预报',
  'weather__precipitation': '查询降水预报',
  'weather__life_indices': '查询生活指数',
  'weather__search_city': '搜索城市',
  'zentao__my_tasks': '查询我的任务',
  'zentao__task_detail': '查询任务详情',
  'zentao__my_bugs': '查询我的 Bug',
  'zentao__bug_detail': '查询 Bug 详情',
  'kb__search': '检索知识库',
  'local__list': '查看本地待办',
  'local__create': '新建本地待办',
  'local__update': '修改本地待办',
  'local__complete': '完成本地待办',
  'local__delete': '删除本地待办',
  'wbscf__services': '查询本地服务状态',
  'wbscf__launch': '启动本地服务',
}

/** 取工具的人类可读标签；未知工具回退为还原后的原始名 */
export function toolLabel(wireName: string): string {
  return TOOL_LABELS[wireName] || fromWireName(wireName)
}

/**
 * 从工具参数提炼一句简短摘要，用于 UI 副标题（如「北京 · 7 天」）。
 * 仅取最具辨识度的字段，缺省返回空串。
 */
export function toolDetail(wireName: string, args: Record<string, unknown>): string {
  const parts: string[] = []
  const loc =
    (args.city as string) || (args.coord as string) || (args.keyword as string) || (args.query as string)
  if (loc) parts.push(String(loc))
  // wbscf.services 的 app 参数（account/buyer/…）作为副标题更直观
  const isWbscf = wireName.startsWith('wbscf__')
  if (isWbscf && args.app) parts.push(String(args.app))
  if (args.days) parts.push(`${args.days} 天`)
  if (args.hours) parts.push(`${args.hours} 小时`)
  // 本地待办 create/update 的标题、其它工具的 title 字段，作为副标题更直观
  if (args.title) parts.push(String(args.title))
  // 本地待办的 id 是 uuid，太长不直观，跳过；其余工具（如禅道数字 id）照常显示
  const isLocal = wireName.startsWith('local__')
  if (!isLocal && args.id != null) parts.push(`#${args.id}`)
  if (args.type) {
    const map: Record<string, string> = {
      finishedBy: '由我完成',
      resolvedBy: '由我解决',
      assignedTo: '指派给我',
      openedBy: '由我创建',
    }
    parts.push(map[String(args.type)] || String(args.type))
  }
  return parts.join(' · ')
}
