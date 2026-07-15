/**
 * Chat 助手 · 视觉模型识别
 *
 * 命令面板支持粘贴/拖入图片，但默认的 deepseek-chat 等纯文本模型不支持视觉输入，
 * 发图会收到模型错误。这里维护一份「已知支持图片的模型」关键词名单，在用户加图时
 * 前置提示（提示但不阻止--用户可能确知自己的网关支持视觉）。
 *
 * 名单按模型名 substring 匹配（不区分大小写），覆盖主流 OpenAI-compatible VL 模型。
 * 这只是「友善提示」，不是权威判定--新模型涌现时补充关键词即可。
 */
import { activeModel } from '@/features/model-config'

/** 支持视觉输入的模型名关键词（小写匹配） */
const VISION_KEYWORDS = [
  'vision',
  'vl', // qwen-vl / glm-4v... 的 -vl / -v 多含 vl
  '-v-', // 形如 xxx-v-yyy 的视觉版
  'gpt-4o',
  'gpt-4.5', // gpt-4.5 系列多模态
  'gemini', // gemini 全系多模态
  'claude-3', // claude 3+ 多模态（含 sonnet/opus/haiku）
  'claude-4',
  'claude-5',
  'qwen-vl',
  'qwen2-vl',
  'qwen3-vl',
  'glm-4v',
  'glm-4.6',
  'glm-4.5v',
  'step-1v',
  'step-1.5v',
  'yi-vision',
  'llava',
  'internvl',
  'minicpm-v',
  'omni', // qwen-omni 等
  'multi-modal',
  'multimodal',
]

/** 判断给定模型名是否疑似支持视觉输入 */
export function isVisionModel(modelName: string | undefined | null): boolean {
  if (!modelName) return false
  const name = modelName.toLowerCase()
  // 精确排除纯文本模型，避免 -vl 子串误判（如 'deepseek-vl' 命中 'vl' 是对的，但要排除 'chat'）
  return VISION_KEYWORDS.some((kw) => name.includes(kw))
}

/** 当前激活模型是否支持视觉（组件便利封装） */
export function currentModelSupportsVision(): boolean {
  return isVisionModel(activeModel.value)
}
