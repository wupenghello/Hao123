/**
 * 首页引导 —— 由 LLM 站在「前端开发」视角，根据真实工作项生成命令面板的快捷提问
 *
 * 关键不在「让模型生成」，而在喂给模型足够的前提：
 *   - 用户是前端开发；禅道任务 = 我要做的开发工作；Bug = 测试指派给我、需要我修的；
 *   - 把任务/Bug 的状态、优先级、严重程度、截止日翻成中文一起给（编码模型用不上）。
 * 于是模型不再是套模板填数字，而是点名具体工作项，给出自然、可直接发给助手的快捷提问。
 *
 * 仅产出 suggestions（命令面板空态的快捷提问）。
 * 首页的「今天先抓什么」行动建议已合并进每日晨报（briefing.ts）——同源同意图，
 * 不再在首页单列一条，故本模块不再产 headline。
 *
 * 模型未配置 / 失败 / 解析不出 → 回退静态兜底，首屏始终有内容。
 * 结果模块级缓存，多个组件只生成一次。
 *
 * 上下文采集（天气 + 禅道 + 本地待办）已抽到 dashboard-context.ts，与每日晨报共享，
 * 并发时只发一次禅道请求。
 */
import { ref, computed, type ComputedRef } from 'vue'
import { ASSISTANT_NAME } from './config'
import { llm } from './llm'
import { buildDashboardContext } from './dashboard-context'

export interface Suggestion {
  icon: 'weather' | 'task' | 'bug' | 'local'
  text: string
}

/** 静态兜底：LLM 不可用时仍给出合理引导 */
const FALLBACK: Suggestion[] = [
  { icon: 'weather', text: '今天天气怎么样？' },
  { icon: 'task', text: '我现在有哪些开发任务？' },
  { icon: 'bug', text: '测试给我提了哪些 Bug？' },
  { icon: 'local', text: '记一下明天要交周报' },
]

const suggestions = ref<Suggestion[]>(FALLBACK)
/** 已尝试次数（含失败）；失败时允许重试，最多 MAX_ATTEMPTS 次 */
let attempts = 0
const MAX_ATTEMPTS = 3
/** 并发守卫：防止多组件同时挂载触发重复 API 调用 */
let generating = false
/** 成功后锁定：避免组件重复挂载时反复调用 LLM / 禅道（与文档承诺「只生成一次」一致） */
let done = false

/** 解析模型输出的 suggestions 数组；异常返回 null */
function parseSuggestions(raw: string): Suggestion[] | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[0])
    const list = Array.isArray(obj.suggestions) ? obj.suggestions : []
    const valid = list
      .filter((x: unknown): x is Suggestion => {
        const s = x as Suggestion
        return !!s && typeof s.text === 'string' && ['weather', 'task', 'bug', 'local'].includes(s.icon)
      })
      .map((x: Suggestion) => ({ icon: x.icon, text: String(x.text).trim() }))
      .filter((x: Suggestion) => x.text)
      .slice(0, 4)
    if (!valid.length) return null
    return valid
  } catch {
    return null
  }
}

/** 生成一次首页引导（模块级单例，成功即锁定；失败允许重试至 MAX_ATTEMPTS） */
async function generate() {
  // 成功后锁定；并发中或已用尽重试次数也直接返回，避免重复 LLM / 禅道调用
  if (done || generating || attempts >= MAX_ATTEMPTS) return
  generating = true
  attempts++
  if (!llm.configured) {
    generating = false
    return
  }

  try {
    const context = await buildDashboardContext()
    const sys = {
      role: 'system' as const,
      content: [
        `你在为「${ASSISTANT_NAME}」工作台首页生成给用户的快捷提问。`,
        '',
        '# 工作项说明',
        '- 「我的开发任务」来自禅道，是用户需要亲自完成的工作项。',
        '- 「测试提给我的 Bug」是其他同事指派给用户、需要用户修复的缺陷；严重级别越高越该优先处理。',
        '- 「我的本地待办」是用户手动创建的待办（与禅道无关，纯本地）；助手可查看 / 新建 / 完成 / 修改 / 删除它们。',
        '- 助手（你）能查询：天气、以及这些任务/Bug 的列表与详情（只读），并能管理本地待办（可增删改查）。',
        '',
        '# 你的任务',
        '基于下面的真实上下文，输出 3~4 条用户口吻的快捷提问（suggestions），尽量点名具体的任务/Bug/本地待办，',
        '自然可直接发给助手，每条不超过 20 字；没有的类别就不出现。',
        '',
        '# 输出格式',
        '只输出 JSON：{"suggestions":[{"icon":"weather|task|bug|local","text":"..."}]}，不要任何额外文字或解释。',
      ].join('\n'),
    }
    const user = { role: 'user' as const, content: context || '（暂无更多上下文，给出通用的天气与工作类引导）' }
    const raw = await llm.complete({
      messages: [sys, user],
      temperature: 0.7,
      responseFormat: { type: 'json_object' },
    })
    const parsed = parseSuggestions(raw)
    if (parsed) {
      suggestions.value = parsed
      // 成功即锁定，后续组件挂载不再重复调用
      done = true
    }
    // 解析失败不置 done，允许下次重试
  } catch {
    // 网络/API 失败，保留静态兜底，允许下次重试
  } finally {
    generating = false
  }
}

export function useWelcomeGuide(): { suggestions: ComputedRef<Suggestion[]> } {
  generate()
  return {
    suggestions: computed(() => suggestions.value),
  }
}
