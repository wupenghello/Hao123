/**
 * Chat 助手 · 合成器模式（问答 / 规划 / 写作 / 排查）
 *
 * 这些模式此前是「假按钮」--只改输入框 placeholder，不影响 LLM 行为。
 * 现在把每个模式映射为一段 system 提示，send 时透传给 runAgentLoop，
 * 以 hiddenContext 形式注入（不折进 STATIC_SYSTEM_PROMPT，保 DeepSeek prompt cache）。
 *
 * ask 为默认模式，不注入任何额外提示；其余模式给模型一个明确的「回答姿态」。
 */
import type { ChatMessage } from './types'

export type ComposerMode = 'ask' | 'plan' | 'write' | 'debug' | 'research'

export interface ComposerModeDef {
  key: ComposerMode
  label: string
  placeholder: string
}

/** 合成器模式定义（标签 + 占位符；与 ChatCommandPalette 的 tabs 同源） */
export const COMPOSER_MODES: ComposerModeDef[] = [
  { key: 'ask', label: '问答', placeholder: '直接跟我说就好…' },
  { key: 'plan', label: '规划', placeholder: '说目标，我来拆步骤和优先级…' },
  { key: 'write', label: '写作', placeholder: '给我材料，我来整理成可用文本…' },
  { key: 'debug', label: '排查', placeholder: '描述现象、报错或代码位置…' },
  { key: 'research', label: '研究', placeholder: '给我链接或主题，我查全文、摆观点、标来源…' },
]

/**
 * 各模式对应的 system 提示片段。ask 返回 null（不注入）。
 * 文案刻意简短、指令化，避免与 STATIC_SYSTEM_PROMPT 的风格节重复或冲突。
 */
const MODE_PROMPT: Record<Exclude<ComposerMode, 'ask'>, string> = {
  plan: '当前为「规划模式」。请先把用户的目标拆解为可执行步骤，再排定优先级与时间，最后明确给出「现在第一步该做什么」。步骤要具体、可落地，不要泛泛而谈。',
  write: '当前为「写作模式」。请基于用户给的材料整理成可直接使用的结构化文本，保留关键信息、去除冗余，不要额外发散或补充未提供的结论。输出即可用文本，而非元描述。',
  debug: '当前为「排查模式」。请先简要复述现象，再列出可能原因（按概率从高到低），针对最可能的原因给出定位步骤与验证方法，而非直接下结论。',
  research: '当前为「研究模式」。用户要的是过程与依据，不是结论摘要。请按「结论 -> 关键观点与依据（每个观点附原文要点或数据，可适度引用原文）-> 对本项目的影响 -> 来源」组织回答。查到的网页、仓库、视频内容要用自己的话复述关键信息，不要压缩成一句话；引用原文处标注来源编号。宁可信息密度高一点，也不要过度精简到丢失论据。如果已生成 UI 卡片，正文仍需独立讲清论据，让用户不点开卡片也能读懂。',
}

/**
 * 构造模式提示消息（注入 hiddenContexts）。
 * ask 模式返回 null，调用方据此跳过。
 */
export function modePromptMessage(mode: ComposerMode): ChatMessage | null {
  if (mode === 'ask') return null
  const content = MODE_PROMPT[mode]
  if (!content) return null
  return { role: 'system', content }
}
