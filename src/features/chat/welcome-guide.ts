/**
 * 首页引导 —— 由 LLM 站在「前端开发」视角，根据真实工作项给出行动建议
 *
 * 关键不在「让模型生成」，而在喂给模型足够的前提：
 *   - 用户是前端开发；禅道任务 = 我要做的开发工作；Bug = 测试指派给我、需要我修的；
 *   - 把任务/Bug 的状态、优先级、严重程度、截止日翻成中文一起给（编码模型用不上）。
 * 于是模型不再是套模板填数字，而是判断「现在最该干什么」：
 *   - headline：一句话行动推荐，顶在「快捷开始」前（如「先修测试提的严重 Bug，有 2 个还没解决」）；
 *   - suggestions：3~4 条点名具体工作项的快捷问题。
 *
 * 模型未配置 / 失败 / 解析不出 → 回退静态兜底，首屏始终有内容。
 * 一次 LLM 调用同时拿 headline + suggestions；结果模块级缓存，多个组件只生成一次。
 */
import { ref, computed, type ComputedRef } from 'vue'
import { useWeatherStore } from '@/features/weather'
import { useZentaoSession, callZentaoTool } from '@/features/zentao'
import { useLocalTaskStore } from '@/features/local-tasks'
import { ASSISTANT_NAME } from './config'
import { llm } from './llm'
import { daypart } from './utils'

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

const headline = ref('')
const headlines = ref<string[]>([])
const suggestions = ref<Suggestion[]>(FALLBACK)
/** 已尝试次数（含失败）；失败时允许重试，最多 MAX_ATTEMPTS 次 */
let attempts = 0
const MAX_ATTEMPTS = 3
/** 并发守卫：防止多组件同时挂载触发重复 API 调用 */
let generating = false
/** 成功后锁定：避免组件重复挂载时反复调用 LLM / 禅道（与文档承诺「只生成一次」一致） */
let done = false

// ============ 编码 → 中文（模型只认人话）============
const TASK_STATUS: Record<string, string> = {
  wait: '未开始', doing: '进行中', done: '已完成', pause: '已暂停', cancel: '已取消', closed: '已关闭',
}
const BUG_STATUS: Record<string, string> = { active: '待解决', resolved: '已解决', closed: '已关闭' }
const SEVERITY: Record<string, string> = { '1': '严重', '2': '主要', '3': '次要', '4': '轻微' }
const PRI: Record<string, string> = { '1': '紧急', '2': '高', '3': '中', '4': '低' }
const label = (map: Record<string, string>, v: unknown) => map[String(v)] || ''

interface TaskItem { name?: string; status?: string; pri?: string | number; deadline?: string }
interface BugItem { title?: string; status?: string; severity?: string | number; pri?: string | number }

/** 取「指派给我」的工作项（带状态/优先级，已翻成中文行）；失败返回空数组 */
async function assignedLines(tool: string, kind: 'task' | 'bug'): Promise<string[]> {
  try {
    const r = (await callZentaoTool(tool, { type: 'assignedTo' })) as { tasks?: TaskItem[]; bugs?: BugItem[] }
    if (kind === 'task') {
      return (r.tasks ?? [])
        .filter((t) => t.name)
        .slice(0, 8)
        .map((t) => {
          const meta = [label(TASK_STATUS, t.status), label(PRI, t.pri) && `优先级${label(PRI, t.pri)}`, t.deadline && `截止${t.deadline}`]
            .filter(Boolean)
            .join('，')
          return `「${t.name}」${meta ? `（${meta}）` : ''}`
        })
    }
    return (r.bugs ?? [])
      .filter((b) => b.title)
      .slice(0, 8)
      .map((b) => {
        const meta = [label(BUG_STATUS, b.status), label(SEVERITY, b.severity) && `${label(SEVERITY, b.severity)}级`]
          .filter(Boolean)
          .join('，')
        return `「${b.title}」${meta ? `（${meta}）` : ''}`
      })
  } catch {
    return []
  }
}

/** 收集当前上下文，拼成喂给模型的描述 */
async function buildContext(): Promise<string> {
  const weather = useWeatherStore()
  const session = useZentaoSession()
  const now = new Date()
  // 本地时间（非 UTC）：完整日期 + 星期 + 时段，让生成的建议贴合「今天周几、此刻」
  const dateStr = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
  const lines: string[] = [`现在是${dateStr} ${daypart(now.getHours())}。`]

  // autoLocate 失败兜底已改为 nearestCity().name（不再写 '当前位置' 占位），故直接取城市名即可。
  const city = weather.cityName || null
  if (city) {
    const wn = weather.now
    const today = weather.daily[0]
    let w = `所在城市：${city}。`
    if (wn) w += `当前${wn.text} ${wn.temp}°C。`
    if (today) w += `今日 ${today.tempMin}~${today.tempMax}°C，白天${today.textDay}。`
    lines.push(w)
  }

  if (session.configured) {
    const [tasks, bugs] = await Promise.all([
      assignedLines('zentao.my_tasks', 'task'),
      assignedLines('zentao.my_bugs', 'bug'),
    ])
    lines.push(tasks.length ? `我的开发任务（${tasks.length} 个）：\n${tasks.join('\n')}` : '当前没有指派给我的开发任务。')
    lines.push(bugs.length ? `测试提给我的 Bug（${bugs.length} 个）：\n${bugs.join('\n')}` : '当前没有测试提给我的 Bug。')
  }

  // 本地待办（手动创建、与禅道无关，始终可用）
  const localStore = useLocalTaskStore()
  const localTasks = localStore.open
    .slice(0, 8)
    .map((t) => `「${t.title}」（${label(PRI, t.pri) ? `优先级${label(PRI, t.pri)}` : ''}${t.deadline ? `，截止${t.deadline}` : ''}）`)
  lines.push(
    localTasks.length
      ? `我的本地待办（${localStore.openCount} 个）：\n${localTasks.join('\n')}`
      : '当前没有本地待办。',
  )

  return lines.join('\n')
}

interface Guide { headlines?: string[]; headline?: string; suggestions?: Suggestion[] }

/** 解析模型输出的 JSON 对象 {headline, suggestions}；异常返回 null */
function parseGuide(raw: string): Guide | null {
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
    const headArr = Array.isArray(obj.headlines)
      ? obj.headlines.map((h: unknown) => typeof h === 'string' ? h.trim() : '').filter(Boolean)
      : []
    const head = typeof obj.headline === 'string' ? obj.headline.trim() : ''
    const headlines = headArr.length > 0 ? headArr : (head ? [head] : [])
    if (!headlines.length && !valid.length) return null
    return { headlines, suggestions: valid }
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
    const context = await buildContext()
    const sys = {
      role: 'system' as const,
      content: [
        `你在为「${ASSISTANT_NAME}」工作台首页生成给用户的开场引导。`,
        '',
        '# 工作项说明',
        '- 「我的开发任务」来自禅道，是用户需要亲自完成的工作项。',
        '- 「测试提给我的 Bug」是其他同事指派给用户、需要用户修复的缺陷；严重级别越高越该优先处理。',
        '- 「我的本地待办」是用户手动创建的待办（与禅道无关，纯本地）；助手可查看 / 新建 / 完成 / 修改 / 删除它们。',
        '- 助手（你）能查询：天气、以及这些任务/Bug 的列表与详情（只读），并能管理本地待办（可增删改查）。',
        '',
        '# 你的任务',
        '基于下面的真实上下文，站在「帮用户安排接下来该干什么」的角度，输出：',
        '1. headlines：2~3 条不同角度的行动建议（工作优先 / 天气关怀 / 轻松问候），每条不超过 30 字，口吻像贴心的同事。',
        '   例：「先解决 2 个严重 Bug，再推进进行中的任务」「今天有雨，出门记得带伞 ☂️」。',
        '2. suggestions：3~4 条用户口吻的快捷提问，尽量点名具体的任务/Bug/本地待办，自然可直接发给助手，每条不超过 20 字；没有的类别就不出现。',
        '',
        '# 输出格式',
        '只输出 JSON：{"headlines":["...","..."],"suggestions":[{"icon":"weather|task|bug|local","text":"..."}]}，不要任何额外文字或解释。',
      ].join('\n'),
    }
    const user = { role: 'user' as const, content: context || '（暂无更多上下文，给出通用的天气与工作类引导）' }
    const raw = await llm.complete({
      messages: [sys, user],
      temperature: 0.7,
      responseFormat: { type: 'json_object' },
    })
    const parsed = parseGuide(raw)
    if (parsed) {
      if (parsed.headlines?.length) {
        headlines.value = parsed.headlines
        headline.value = parsed.headlines[0]
      }
      if (parsed.suggestions?.length) suggestions.value = parsed.suggestions
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

export function useWelcomeGuide(): {
  headline: ComputedRef<string>
  headlines: ComputedRef<string[]>
  suggestions: ComputedRef<Suggestion[]>
} {
  generate()
  return {
    headline: computed(() => headline.value),
    headlines: computed(() => headlines.value),
    suggestions: computed(() => suggestions.value),
  }
}
