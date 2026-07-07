import type { ProviderPreset } from './types'

/**
 * 常见 OpenAI-compatible Provider 预设。
 *
 * 这里不做价格/上下文窗口等易过期承诺，只写稳定的接入口径与使用建议。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    accent: '#22d3ee',
    summary: '适合日常工作台问答、工具调用与代码解释，成本和能力比较均衡。',
    bestFor: ['工作台日常对话', '代码解释', '禅道 / Git 信息整理'],
    models: [
      { name: 'deepseek-chat', role: '日常', description: '默认对话模型，响应快，适合多数工作台任务。' },
      { name: 'deepseek-reasoner', role: '推理', description: '需要多步分析、排查原因或做决策时使用。' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    accent: '#a78bfa',
    summary: '适合需要图片输入、通用多模态或更强生态兼容性的任务。',
    bestFor: ['截图理解', '多模态问答', '通用 OpenAI 生态'],
    models: [
      { name: 'gpt-4o', role: '多模态', description: '适合截图、图片和复杂上下文。' },
      { name: 'gpt-4o-mini', role: '轻量', description: '适合低成本快速问答。' },
      { name: 'gpt-4.1', role: '代码', description: '适合较复杂的代码和文本任务。' },
    ],
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    accent: '#34d399',
    summary: '中文工作流友好，OpenAI 兼容模式接入简单。',
    bestFor: ['中文摘要', '企业内网任务', '长文本整理'],
    models: [
      { name: 'qwen-plus', role: '均衡', description: '中文日常任务的均衡选择。' },
      { name: 'qwen-max', role: '强能力', description: '更复杂的分析和生成任务。' },
      { name: 'qwen-turbo', role: '快速', description: '轻量快速任务。' },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    accent: '#f59e0b',
    summary: '适合长文档、长对话上下文的整理和追问。',
    bestFor: ['长文档阅读', '会议纪要', '知识库问答'],
    models: [
      { name: 'moonshot-v1-8k', role: '基础', description: '常规短上下文任务。' },
      { name: 'moonshot-v1-32k', role: '长文', description: '较长材料整理。' },
      { name: 'moonshot-v1-128k', role: '超长', description: '超长上下文任务。' },
    ],
  },
  {
    id: 'zhipu-coding',
    name: '智谱 Coding Plan',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    accent: '#fb7185',
    summary: 'GLM Coding Plan 专用 OpenAI 兼容入口，用于订阅套餐额度。普通智谱 API Key 请用智谱 GLM 线路。',
    bestFor: ['Coding Plan 套餐', '代码与 Agent 任务', 'GLM-5.2'],
    models: [
      { name: 'glm-5.2', role: '旗舰', description: 'Coding Plan 当前主力模型，适合复杂编码与 Agent 任务。' },
      { name: 'glm-5-turbo', role: '高速', description: '适合需要更快响应的日常编码任务。' },
      { name: 'glm-4.7', role: '稳定', description: '适合兼容性更稳的编码与中文任务。' },
    ],
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    accent: '#fb7185',
    summary: '智谱开放平台普通 API 入口，消耗账户余额或通用资源包，不使用 Coding Plan 套餐额度。',
    bestFor: ['中文生成', '普通 API 资源包', '备选 Provider'],
    models: [
      { name: 'glm-5.2', role: '旗舰', description: '强推理与 Agent 能力，需普通 API 余额或资源包。' },
      { name: 'glm-5-turbo', role: '高速', description: '速度优先的 GLM 5 系列模型。' },
      { name: 'glm-4.7', role: '稳定', description: '适合中文理解、生成与工具调用。' },
      { name: 'glm-4-flash', role: '快速', description: '轻量快速任务。' },
    ],
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    accent: '#60a5fa',
    summary: '多模型统一入口，适合管理不同开源或商业模型。',
    bestFor: ['多模型试验', '开源模型', '统一网关'],
    models: [
      { name: 'deepseek-ai/DeepSeek-V3', role: '日常', description: 'DeepSeek V3 兼容模型。' },
      { name: 'Qwen/Qwen3-235B-A22B', role: '推理', description: 'Qwen 系列大参数模型。' },
    ],
  },
  {
    id: 'doubao',
    name: '豆包（字节）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    accent: '#f472b6',
    summary: '火山方舟 OpenAI 兼容接入，适合作为备用线路。',
    bestFor: ['国内线路', '备选 Provider', '长上下文任务'],
    models: [
      { name: 'doubao-pro-256k', role: '长文', description: '长上下文任务。' },
      { name: 'doubao-lite-128k', role: '轻量', description: '轻量快速任务。' },
    ],
  },
]

/** 兼容旧代码：只需要 name/baseUrl/models 字符串列表时使用。 */
export const LEGACY_PROVIDER_PRESETS = PROVIDER_PRESETS.map((preset) => ({
  name: preset.name,
  baseUrl: preset.baseUrl,
  models: preset.models.map((model) => model.name),
}))

export function presetByBaseUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, '')
  return PROVIDER_PRESETS.find((preset) => preset.baseUrl === normalized) ?? null
}

export function modelPresetsForBaseUrl(baseUrl: string) {
  return presetByBaseUrl(baseUrl)?.models ?? []
}
