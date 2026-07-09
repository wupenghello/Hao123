/**
 * Chat 助手 · Few-shot 召回
 *
 * 用户发消息时，从偏好飞轮（preference-log）里捞 2-3 条词法相似的「问题 → 好回答」，
 * 拼成一段 # 参考示例 system 消息注入对话——让小吴的格式/深度向用户认可过的好答案收敛。
 *
 * 设计要点：
 *  - 好答案 = PreferenceRecord 里 chosen 非空（thumbs_up + regenerate）
 *  - 检索 = 词法 bigram 重叠（镜像 features/kb/search.ts 的 tokenize，不跨 feature 引 kb，避免耦合）
 *  - self-gating：好答案 <3 条或无匹配 → 返回 null → 不注入（零回归）
 *  - 检索后端可替换：日后换 embedding 仅改 retrieveFewShot，上层 getFewShotSystemMessage 不变
 *    （对齐 KB「检索后端可替换」约定）
 *  - 范例每条截断（question≤200 / answer≤400 字），整块 ~1500 字，控制 token 预算
 */
import { getAllPreferences } from './preference-log'
import type { ChatMessage } from './types'
import { ASSISTANT_NAME } from './config'

/** kill-switch：要彻底关掉改 false 即可（无需改 UI） */
const FEW_SHOT_ENABLED = true
/** 飞轮好答案少于此数时不激活（避免在稀疏数据上做噪声检索） */
const MIN_GOOD_PAIRS = 3
/** 默认注入范例数 */
const DEFAULT_K = 2
/** 单条文本截断长度 */
const MAX_QUESTION_CHARS = 200
const MAX_ANSWER_CHARS = 400

export interface FewShotExample {
  question: string
  answer: string
  score: number
}

/**
 * 把文本切成 token：英文/数字词 + 中文相邻双字（bigram）。
 * 镜像自 features/kb/search.ts:28-47（不跨 feature 引用 kb，避免反向耦合；日后可抽公共 util）。
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  const wordRe = /[a-z0-9]+/g
  let m: RegExpExecArray | null
  while ((m = wordRe.exec(lower))) tokens.push(m[0])
  const cjkRe = /[一-鿿]+/g
  while ((m = cjkRe.exec(lower))) {
    const s = m[0]
    if (s.length === 1) {
      tokens.push(s)
    } else {
      for (let i = 0; i < s.length - 1; i++) tokens.push(s.slice(i, i + 2))
    }
  }
  return tokens
}

function truncate(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : t.slice(0, max) + '…'
}

/**
 * 从偏好飞轮检索与 query 词法相似的好答案。
 * exclude = 当前会话已有的 assistant 回答（命中则跳过，避免范例与 live history 重复）。
 */
export async function retrieveFewShot(
  query: string,
  opts: { exclude?: string[]; k?: number } = {},
): Promise<FewShotExample[]> {
  if (!FEW_SHOT_ENABLED) return []
  const q = query.trim()
  if (!q) return []
  const k = opts.k ?? DEFAULT_K
  const exclude = (opts.exclude ?? []).filter(Boolean)

  const all = await getAllPreferences()
  const good = all.filter((r) => r.chosen && r.chosen.trim())
  if (good.length < MIN_GOOD_PAIRS) return []

  const qTokens = new Set(tokenize(q))
  if (qTokens.size === 0) return []
  const qLower = q.toLowerCase()

  const scored: FewShotExample[] = []
  for (const r of good) {
    const lastUser = [...r.context].reverse().find((m) => m.role === 'user')?.content || ''
    if (!lastUser.trim()) continue
    const answer = r.chosen as string
    // 排除：该 answer 已出现在当前会话 history（范例与 live 重复，无价值）
    const answerHead = answer.slice(0, 80)
    if (exclude.some((e) => e && e.includes(answerHead))) continue

    const docLower = lastUser.toLowerCase()
    const docTokens = tokenize(lastUser)
    let score = 0
    // 整串子串命中（鼓励完整短语）
    if (docLower.includes(qLower)) score += 5
    // token 交集
    let matched = 0
    for (const t of docTokens) if (qTokens.has(t)) matched++
    score += matched
    if (matched >= 2) score += 4 // bonus：≥2 个 token 命中说明真相关
    if (score <= 0) continue
    scored.push({
      question: truncate(lastUser, MAX_QUESTION_CHARS),
      answer: truncate(answer, MAX_ANSWER_CHARS),
      score,
    })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, k)
}

/**
 * 检索 + 格式化成 # 参考示例 system 消息。无匹配 / 数据不足返回 null（零回归）。
 * 由 store.runAgentLoop 在进 agent 循环前调用一次，结果作 fewShot 传进 buildApiMessages。
 */
export async function getFewShotSystemMessage(
  query: string,
  exclude: string[] = [],
): Promise<ChatMessage | null> {
  const examples = await retrieveFewShot(query, { exclude })
  if (!examples.length) return null
  if (import.meta.env.DEV) {
    console.debug(
      '[few-shot] 命中范例',
      examples.map((e) => ({ score: e.score, q: e.question.slice(0, 40) })),
    )
  }
  const blocks = examples
    .map((e, i) => `【示例${i + 1}】\n用户：${e.question}\n${ASSISTANT_NAME}：${e.answer}`)
    .join('\n\n')
  return {
    role: 'system',
    content:
      `# 参考示例\n以下是 ${examples.length} 个类似问题的高质量历史回答，仅供参考风格与深度——不要照抄、不要提及"示例"、以当前问题为准作答：\n\n${blocks}`,
  }
}
