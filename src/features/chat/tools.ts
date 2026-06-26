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

/** 喂给 DeepSeek 的全部工具（天气 + 禅道只读查看 + 知识库检索） */
export const openAiTools: OpenAiTool[] = [
  ...toOpenAi(weatherToolDefs),
  ...toOpenAi(zentaoToolDefs),
  ...(kbEnabled ? toOpenAi(kbToolDefs) : []),
]

/**
 * 基于用户意图动态选择工具子集，减少模型选择困难和 token 开销。
 * 策略：关键词匹配 → 只传相关工具；匹配不到 → 传全部（兜底）。
 */
export function selectToolsForIntent(userMessage: string): OpenAiTool[] {
  const text = userMessage.toLowerCase()

  // 天气意图关键词
  const weatherKeywords = [
    '天气', '温度', '下雨', '下雪', '降水', '风', '湿度', '紫外线',
    '穿', '冷', '热', '暖', '凉', '预报', '带伞', '日出', '日落',
    '空气', '能见度', '气压',
  ]
  // 禅道意图关键词
  const zentaoKeywords = [
    '任务', 'bug', '缺陷', '禅道', '工时', '进度', '指派', '待办',
    '需求', '故事', '测试', '修复', '解决', '优先级',
  ]
  // 知识库意图关键词（项目内部信息：环境/域名/部署等）
  // 注意「测试」同时是禅道关键词——「测试环境域名」会同时命中禅道+知识库，
  // 下面用「命中类别的并集」处理，把两类都给模型，避免误判。
  const kbKeywords = [
    '环境', '域名', '部署', '发布', '上线', '笔记', 'faq', '常见问题',
    '知识库', '地址', '文档',
  ]

  const hasWeather = weatherKeywords.some((kw) => text.includes(kw))
  const hasZentao = zentaoKeywords.some((kw) => text.includes(kw))
  // 知识库关键词命中后，仍需 kbEnabled（已配置来源）才纳入，避免未配置时塞空工具
  const hasKb = kbEnabled && kbKeywords.some((kw) => text.includes(kw))

  // 命中任意一类 → 返回命中类别的并集（多类同时命中时都给模型，由它自行选择）
  if (hasWeather || hasZentao || hasKb) {
    const defs: LlmToolDef[] = []
    if (hasWeather) defs.push(...weatherToolDefs)
    if (hasZentao) defs.push(...zentaoToolDefs)
    if (hasKb) defs.push(...kbToolDefs)
    return toOpenAi(defs)
  }

  // 都没匹配到 → 传全部（兜底，最可能是项目知识类问题或通用闲聊）
  return openAiTools
}

/**
 * 按名执行工具：依前缀路由到对应模块的分发器。
 * 入参 name 为模型返回的「线上名」（含 __），先还原为原始名再分发。
 * @returns 结构化结果（由调用方序列化成 tool 消息内容）
 */
export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const realName = fromWireName(name)
  if (realName.startsWith('weather.')) return callWeatherTool(realName, args)
  if (realName.startsWith('zentao.')) return callZentaoTool(realName, args)
  if (realName.startsWith('kb.')) return callKbTool(realName, args)
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
}

/** 取工具的人类可读标签；未知工具回退为还原后的原始名 */
export function toolLabel(wireName: string): string {
  return TOOL_LABELS[wireName] || fromWireName(wireName)
}

/**
 * 从工具参数提炼一句简短摘要，用于 UI 副标题（如「北京 · 7 天」）。
 * 仅取最具辨识度的字段，缺省返回空串。
 */
export function toolDetail(_wireName: string, args: Record<string, unknown>): string {
  const parts: string[] = []
  const loc =
    (args.city as string) || (args.coord as string) || (args.keyword as string) || (args.query as string)
  if (loc) parts.push(String(loc))
  if (args.days) parts.push(`${args.days} 天`)
  if (args.hours) parts.push(`${args.hours} 小时`)
  if (args.id != null) parts.push(`#${args.id}`)
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
