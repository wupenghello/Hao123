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
import { useTaskStore, useBugStore } from '@/features/zentao'
import { useLocalTaskStore } from '@/features/local-tasks'
import { llm } from './llm'
import { ASSISTANT_NAME } from './config'
import { buildDashboardContext } from './dashboard-context'
import { classifyError, clearConnectivityIssue, markUnreachable, onRecover } from './connectivity'

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
  /**
   * 生成时所用的工作项数据签名。
   * 由三类「指派给我」的工作项（禅道任务 / Bug / 本地待办）各自按 `${id}:${status}` 排序拼接而成，
   * 任意一环里出现新增项、移除项、状态变更都会改变签名 → stale 自动失效重新生成。
   */
  dataSignature?: string
}

const briefing = useStorage<BriefingState | null>(BRIEFING_KEY, null)
const generating = ref(false)
const error = ref<string | null>(null)

/** 本地日期 yyyy-MM-dd */
function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 计算工作台工作项的「数据签名」：三类「指派给我」来源各自按 `${id}:${status}` 排序后拼接。
 * 任意一环里出现新增项、移除项、状态变更都会改变返回值，从而让简报缓存失效。
 *
 * 只做轻量判断（id + status），不引入 hash；列表通常 < 30 条，排序 + 拼接开销可忽略，
 * 且能让 LLM 看到的「当日工作全貌」与缓存简报一致。
 */
function currentDataSignature(): string {
  const taskStore = useTaskStore()
  const bugStore = useBugStore()
  const localStore = useLocalTaskStore()
  const weather = useWeatherStore()
  return JSON.stringify({
    weather: {
      city: weather.cityName,
      coord: weather.cityCoord,
      mode: weather.locateMode,
      now: weather.now ? {
        text: weather.now.text,
        temp: weather.now.temp,
        feelsLike: weather.now.feelsLike,
        windDir: weather.now.windDir,
        windScale: weather.now.windScale,
      } : null,
      today: weather.daily[0] ? {
        textDay: weather.daily[0].textDay,
        textNight: weather.daily[0].textNight,
        tempMin: weather.daily[0].tempMin,
        tempMax: weather.daily[0].tempMax,
      } : null,
    },
    tasks: taskStore.assigned
      .map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        pri: t.pri,
        deadline: t.deadline,
        projectName: t.projectName,
        storyTitle: t.storyTitle,
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    bugs: bugStore.assigned
      .map((b) => ({
        id: b.id,
        title: b.title,
        status: b.status,
        pri: b.pri,
        severity: b.severity,
        deadline: b.deadline,
        projectName: b.projectName,
        storyTitle: b.storyTitle,
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    local: localStore.tasks
      .map((t) => ({
        id: t.id,
        title: t.title,
        note: t.note,
        done: t.done,
        pri: t.pri,
        deadline: t.deadline,
        attachments: (t.attachments ?? []).length,
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  })
}

/** 缓存的简报是否已过期（没有 / 不是今天生成的 / 位置变了 / 工作项数据变了） */
const stale = computed(() => {
  if (!briefing.value) return true
  if (!briefing.value.content?.trim()) return true
  if (briefing.value.date !== todayStr()) return true
  if (!briefing.value.locationSignature || !briefing.value.dataSignature) return true
  if (briefing.value.locationSignature !== currentLocationSignature()) return true
  return briefing.value.dataSignature !== currentDataSignature()
})

function currentLocationSignature(): string {
  const weather = useWeatherStore()
  return [weather.locateMode, weather.cityCoord, weather.cityName].join('|')
}

/** 晨报系统提示词（与对话用的 STATIC_SYSTEM_PROMPT 独立：这是「一次性生成」场景，不走 agent 循环） */
const BRIEFING_SYSTEM_PROMPT = [
  `你在为「${ASSISTANT_NAME}」工作台生成一份「今日简报」——用户一打开工作台扫一眼就知道今天先干什么。`,
  '',
  '# 下方是用户的真实工作台快照',
  '包含天气 + 指派给我的禅道任务/Bug + 本地待办，工作项已带中文状态与优先级。只能依据快照里出现的内容判断，禁止编造任何任务名、数字或天气。',
  '',
  '# 你要写的简报（硬性要求）',
  '用简体中文 Markdown，总计 120~200 字，结构：',
  '1. 第一句直接点今天最该先抓的事。点名顺序：**逾期** > **今天截止** > **紧急**；都没有就一句轻松开场，不许硬造紧迫感。',
  '2. 用 2~4 个「- 」要点列出关键事项，逐条点名快照里真实存在的任务 / Bug / 待办名（用「」框起），该加重的项前 **加粗** 标注「逾期 / 今天截止 / 紧急」。',
  '3. 末尾一句贴心提示：仅当天气确有影响（下雨 / 极端高温 / 雷阵雨）时才给对应建议（带伞 / 多喝水 / 别外出）；天气平稳时给一句贴合工作节奏的鼓励即可，不要生硬套天气。',
  '',
  '# 风格',
  '- 像靠谱同事，简洁、不寒暄、不用感叹号。',
  '- 只输出简报正文 Markdown；不写「# 今日简报」标题、不解释、不提及 AI 或所用工具。',
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
  const generationLocationSignature = currentLocationSignature()
  const generationDataSignature = currentDataSignature()
  let generated = false
  try {
    const context = await buildDashboardContext({ force })
    const raw = await llm.complete({
      messages: [
        { role: 'system', content: BRIEFING_SYSTEM_PROMPT },
        { role: 'user', content: context || '（暂无工作项与天气信息，给一句轻松的今日问候即可。）' },
      ],
      temperature: 0.6,
      maxTokens: 1200,
    })
    const content = raw.trim()
    if (!content) throw new Error('简报内容为空')
    briefing.value = {
      content,
      date: todayStr(),
      generatedAt: Date.now(),
      locationSignature: generationLocationSignature,
      dataSignature: generationDataSignature,
    }
    generated = true
  } catch (e) {
    // 网络类错误归连通性层（让首页/状态栏统一降级）；非网络错误保留给组件 error 态
    const reason = classifyError(e)
    if (reason) {
      markUnreachable(reason)
      error.value = (e as Error)?.message || '简报生成失败'
    } else {
      clearConnectivityIssue()
      error.value = (e as Error)?.message || '简报生成失败'
    }
  } finally {
    generating.value = false
    // 兜底：只有本次成功写入简报后，才检查生成期间是否有数据变化需要再跑一次。
    // 如果 LLM 请求失败，缓存仍然 stale，此处不能自触发，否则会无限重试并让 UI 一直停在 loading。
    if (generated && !force && stale.value) void generate(false)
  }
}

/**
 * 首页晨报 composable。
 * 调用即按需触发：今日已生成则复用缓存，否则生成（与 useWelcomeGuide 的「调用即生成」一致）。
 *
 * 订阅两类变化的 watcher：
 *  - 城市/位置变化（今天换城市出差了，简报里的天气和节奏提示应重新生成）
 *  - 工作项数据变化（新来的指派任务 / Bug、本地待办新增或状态变更）→ 让「早上生成过、下午来了新活」
 *    的场景下简报随之刷新，避免让用户看到与现状不符的「没有任务 / 没有 Bug」。
 */
export function useBriefing() {
  // 调用即确保今日简报存在（过期 / 首次才真正生成；有 generating / stale 守卫，重复调用安全）
  generate(false)
  ensureLocationWatcher()
  ensureDataWatcher()
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

let watchingData = false

/**
 * 监听三类「指派给我」工作项的 id+status 签名。
 * 签名变化时触发 ensure 路径：有缓存且仍命中签名则直接复用；否则按 stale 自动重新生成。
 * 仅靠 stale computed 无法自己跑，必须由 watcher 主动调用 generate(false) 才会有 LLM 请求——
 * 组件挂载时生成一次，此后由数据变化驱动，而不是一天只生成死一次。
 */
function ensureDataWatcher() {
  if (watchingData) return
  watchingData = true
  watch(
    () => currentDataSignature(),
    () => {
      void generate(false)
    },
  )
}

// 连通恢复后自动续生成（断网期间错过的晨报，恢复后立即补上）
onRecover(() => void generate(false))
