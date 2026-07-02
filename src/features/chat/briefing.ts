/**
 * Chat 助手 · 每日晨报
 *
 * 与 welcome-guide（开场引导）同构——都是「采集工作台上下文 → llm.complete 加工」，
 * 但有两个关键差异：
 *  - welcome-guide 产出短 headline + 快捷问题（临时态，每次进页面都重新生成）；
 *  - 晨报产出一份完整的「今日简报」Markdown（今日要事 / 天气 / 节奏建议），并持久化到
 *    localStorage：同一天内只自动生成一次，跨页面刷新复用，第二天或手动点「刷新」才重新
 *    生成——避免每次进首页都跑一次 LLM（既有延迟又有成本）。
 *
 * 复用 buildDashboardContext 采集上下文（与 welcome-guide 共享，并发时只发一次禅道请求；
 * 手动刷新走 force 重新采集，取最新数据）。
 *
 * 状态层放模块级单例（不是 Pinia store）：晨报是全局唯一的「今日简报」，首页只有一个组件
 * 消费，无需多实例；状态用 useStorage 持久化，行为与项目其它 localStorage 键一致。
 */
import { ref, computed, watch } from 'vue'
import { useStorage } from '@/composables/useStorage'
import { useWeatherStore } from '@/features/weather'
import { llm } from './llm'
import { ASSISTANT_NAME } from './config'
import { buildDashboardContext } from './dashboard-context'

/** localStorage 键：持久化的晨报状态 */
const BRIEFING_KEY = 'hao123-morning-briefing'

interface BriefingState {
  /** Markdown 简报正文 */
  content: string
  /** 生成日期 yyyy-MM-dd（用于判断「是否还是今天」，跨天即视为过期要重新生成） */
  date: string
  /** 生成时间戳（UI 展示「X 分钟前」） */
  generatedAt: number
  /** 生成时使用的位置签名；城市/坐标变化时让今日缓存自动失效 */
  locationSignature?: string
}

const briefing = useStorage<BriefingState | null>(BRIEFING_KEY, null)
const generating = ref(false)
const error = ref<string | null>(null)

/** 本地日期 yyyy-MM-dd */
function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 缓存的简报是否已过期（没有 / 不是今天生成的） */
const stale = computed(() => {
  if (!briefing.value) return true
  if (briefing.value.date !== todayStr()) return true
  if (!briefing.value.locationSignature) return true
  return briefing.value.locationSignature !== currentLocationSignature()
})

function currentLocationSignature(): string {
  const weather = useWeatherStore()
  return [weather.locateMode, weather.cityCoord, weather.cityName].join('|')
}

/** 晨报系统提示词（与对话用的 STATIC_SYSTEM_PROMPT 独立：这是「一次性生成」场景，不走 agent 循环） */
const BRIEFING_SYSTEM_PROMPT = [
  `你在为「${ASSISTANT_NAME}」工作台生成一份「今日简报」——用户一打开工作台就能扫一眼，知道今天该重点干什么。`,
  '',
  '# 下方是用户的真实工作台快照',
  '包含天气 + 指派给我的禅道任务/Bug + 本地待办，所有工作项都已带中文状态与优先级，直接据此判断，绝不凭空编造数字或事项。',
  '',
  '# 你要写的简报',
  '基于快照，用简体中文 Markdown 写一份**精炼**的今日简报（总计 150~220 字），结构如下：',
  '- 开头一句话点出今天最该先抓的事：有紧急 / 逾期的优先点名；没有就给一句轻松的开场。',
  '- 接着用 2~4 个要点（用「- 」列表）列出今天的关键事项，点名具体任务 / Bug / 待办，并在该加重的项前用 **加粗** 标注「紧急」「逾期」「今天截止」等；实在没有重要事项，就挑两件推进中的说一下。',
  '- 最后一行给一句贴合天气或节奏的贴心提示（如下雨带伞、下午有雷阵雨别安排外出、天热多喝水）。',
  '',
  '# 风格',
  '- 口吻像靠谱的同事，简洁不啰嗦、不寒暄套话、不用感叹号轰炸。',
  '- 工作项名称用「」框起来，紧急 / 逾期用 **加粗**，让一眼能抓住重点。',
  '- 只输出简报正文 Markdown；不要写「# 今日简报」这类标题，不要解释，不要提及你是 AI 或用了什么工具。',
].join('\n')

/**
 * 生成今日简报。
 * - 非强制（ensure）：今天已生成则直接复用，省一次 LLM 调用；过期或没有才生成。
 * - 强制（refresh）：绕过上下文缓存重新采集 + 重新生成，取最新数据。
 * - 并发守卫：进行中则跳过，避免重复调用。
 */
async function generate(force = false): Promise<void> {
  if (generating.value) return
  const needsGenerate = force || stale.value
  if (!needsGenerate) return
  if (!force && stale.value) briefing.value = null
  if (!llm.configured) return

  generating.value = true
  error.value = null
  try {
    const context = await buildDashboardContext({ force })
    const raw = await llm.complete({
      messages: [
        { role: 'system', content: BRIEFING_SYSTEM_PROMPT },
        { role: 'user', content: context || '（暂无工作项与天气信息，给一句轻松的今日问候即可。）' },
      ],
      temperature: 0.6,
      maxTokens: 600,
    })
    const content = raw.trim()
    if (!content) throw new Error('简报内容为空')
    briefing.value = {
      content,
      date: todayStr(),
      generatedAt: Date.now(),
      locationSignature: currentLocationSignature(),
    }
  } catch (e) {
    error.value = (e as Error)?.message || '简报生成失败'
  } finally {
    generating.value = false
  }
}

/**
 * 首页晨报 composable。
 * 调用即按需触发：今日已生成则复用缓存，否则生成（与 useWelcomeGuide 的「调用即生成」一致）。
 */
export function useBriefing() {
  // 调用即确保今日简报存在（过期 / 首次才真正生成；有 generating / stale 守卫，重复调用安全）
  generate(false)
  ensureLocationWatcher()
  return {
    briefing,
    generating,
    error,
    stale,
    /** 手动重新生成（绕过缓存，取最新工作台数据） */
    refresh: () => generate(true),
  }
}

let watchingLocation = false

function ensureLocationWatcher() {
  if (watchingLocation) return
  watchingLocation = true
  const weather = useWeatherStore()
  watch(
    () => [weather.locateMode, weather.cityCoord, weather.cityName],
    () => {
      void generate(false)
    },
  )
}
