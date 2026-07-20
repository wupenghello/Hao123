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
 *
 * 升级（agent 化）：
 *  - generate() 优先走 BriefingAgent（独立 agent 循环，maxRounds=2，只读工具集），产出结构化
 *    DailyPlan + narrative；失败降级到 llm.complete 原路径（向后兼容）。
 *  - 数据显著变化（新增逾期 / 紧急 Bug / 今日截止项状态变更 / 天气预警）时主动重排，
 *    受同日最多 3 次节流；手点「刷新」始终可用。
 *  - UI 优先渲染结构化 plan 卡片，无 plan 时回退 Markdown narrative / content。
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { useStorage } from '@/composables/useStorage'
import { useWeatherStore } from '@/features/weather'
import { useTaskStore, useBugStore } from '@/features/zentao'
import { useLocalTaskStore } from '@/features/local-tasks'
import { llm } from './llm'
import { ASSISTANT_NAME } from './config'
import { buildDashboardContext } from './dashboard-context'
import { classifyError, clearConnectivityIssue, markUnreachable, onRecover } from './connectivity'
import { runBriefingAgent } from './briefing-agent'
import { isSignificantChange, takeSnapshot, consumeRegenerationBudget, remainingRegenerations } from './briefing-significant'
import type { DailyPlan, BriefingProgress } from './daily-plan'

/** localStorage 键：持久化的晨报状态 */
const BRIEFING_KEY = 'hao123-morning-briefing'

interface BriefingState {
  /** Markdown 简报正文（保底 + 向后兼容，agent 模式下为 narrative） */
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
  // ── agent 模式新增 ──
  /** 结构化规划（agent 模式主产出；fallback 路径为 null） */
  plan?: DailyPlan
  /** 同日 plan 版本号（每次自动重排 +1，UI 展示「第 N 版」） */
  planVersion: number
  /** 本次生成所用工具列表（透明度 / 调试用） */
  toolsUsed?: string[]
}

const briefing = useStorage<BriefingState | null>(BRIEFING_KEY, null)
const generating = ref(false)
const error = ref<string | null>(null)

/** 当前生成进度（模块级单例，瞬态，不落盘；UI 订阅它实时渲染进度流） */
const progress = ref<BriefingProgress | null>(null)

/** 本地日期 yyyy-MM-dd */
function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 清理进度（generate 结束 / abort / unmount 时） */
function clearProgress() {
  progress.value = null
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
 * 路径选择：
 *  1. 优先走 BriefingAgent（独立 agent 循环，maxRounds=2，只读工具集），产出结构化 plan + narrative。
 *  2. agent 失败降级到 llm.complete 原路径（向后兼容，失败不影响现有晨报体验）。
 *
 * 进度可感知：
 *  - agent 路径：通过 onProgress 回调实时推「正在查哪几个工具」「哪个完成」「正在合成」
 *  - fallback 路径：也发单活动事件（「生成简报…」），UI 无路径差异感知
 *  - 进度是瞬态：generate 结束 / abort 时清理
 */
async function generate(force = false): Promise<void> {
  if (generating.value) return
  const needsGenerate = force || stale.value
  if (!needsGenerate) return
  if (!llm.configured) return

  generating.value = true
  error.value = null
  const generationLocationSignature = currentLocationSignature()
  const generationDataSignature = currentDataSignature()
  let generated = false
  try {
    // ── 路径 1：agent 模式（结构化 plan）—— 带进度回调 ──
    const agentResult = await runBriefingAgent({
      maxRounds: 2,
      onProgress: (p) => { progress.value = p },
    })
    clearProgress()
    if (agentResult.plan) {
      briefing.value = {
        content: agentResult.narrative,
        date: todayStr(),
        generatedAt: Date.now(),
        locationSignature: generationLocationSignature,
        dataSignature: generationDataSignature,
        plan: agentResult.plan,
        planVersion: (briefing.value?.planVersion || 0) + 1,
        toolsUsed: agentResult.toolsUsed,
      }
      lastSnapshot = takeSnapshot()
      generated = true
      return
    }
    // agent 没拿到 plan 但有 narrative → 当 fallback content，不再二次调 llm
    if (agentResult.narrative) {
      briefing.value = {
        content: agentResult.narrative,
        date: todayStr(),
        generatedAt: Date.now(),
        locationSignature: generationLocationSignature,
        dataSignature: generationDataSignature,
        planVersion: briefing.value?.planVersion || 0,
        toolsUsed: agentResult.toolsUsed,
      }
      lastSnapshot = takeSnapshot()
      generated = true
      return
    }

    // ── 路径 2：原路径降级（一次性 llm.complete → Markdown）—— 也发活动事件 ──
    progress.value = { phase: 'synthesizing', steps: [{ id: 'fb', stepKey: 'fallback', label: '生成简报', status: 'running' }], total: 1, completed: 0, startedAt: Date.now(), message: '小吴正在整理今日简报…' }
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
    const fbStart = progress.value?.startedAt ?? Date.now(); progress.value = { phase: 'done', steps: [{ id: 'fb', stepKey: 'fallback', label: '生成简报', status: 'done' }], total: 1, completed: 1, startedAt: fbStart, finishedAt: Date.now(), message: '简报已就绪' }
    briefing.value = {
      content,
      date: todayStr(),
      generatedAt: Date.now(),
      locationSignature: generationLocationSignature,
      dataSignature: generationDataSignature,
      planVersion: briefing.value?.planVersion || 0,
      toolsUsed: agentResult.toolsUsed,
    }
    lastSnapshot = takeSnapshot()
    generated = true
  } catch (e) {
    // 网络类错误只归连通性层（琥珀条 / Launcher 色点 / 自动重 retries），不污染简报卡红条；
    // 非网络错误（解析失败、工具异常等）才走 store.error 红条
    const reason = classifyError(e)
    if (reason) {
      markUnreachable(reason)
    } else {
      clearConnectivityIssue()
      error.value = (e as Error)?.message || '简报生成失败'
    }
  } finally {
    generating.value = false
    clearProgress()
    // 注意：此处不再自动重跑。agent 模式下 generate 慢（多轮 + 工具调用），若 stale 触发重跑，
    // 会因 dataSignature 在生成期间变化（zentao 轮询等）而无限循环。
    // 数据显著变化的自动重排已由 ensureDataWatcher + 显著性门控（briefing-significant.ts）接管；
    // 用户手点「刷新」始终可用。
    // 生成失败且无缓存时，清掉可能残留的空 content briefing，避免 UI 显示空卡
    if (!generated && !force && briefing.value && !briefing.value.content?.trim()) {
      briefing.value = null
    }
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
 *
 * 数据变化不再无脑重排：走显著性门控（briefing-significant.ts），只有「新增逾期 / 紧急 Bug /
 * 今日截止项状态变更 / 天气预警」才触发重排，受同日最多 3 次节流；手点「刷新」始终可用。
 */
export function useBriefing() {
  // 调用即确保今日简报存在（过期 / 首次才真正生成；有 generating / stale 守卫，重复调用安全）
  generate(false)
  ensureLocationWatcher()
  ensureDataWatcher()
  // 组件卸载时清理进度 ref，避免内存泄漏（必须在 return 之前注册才有效）
  onUnmounted(clearProgress)
  return {
    briefing,
    generating,
    error,
    stale,
    /** 当前生成进度（瞬态，UI 订阅以实时渲染进度流；generate 结束后为 null） */
    progress,
    /** 剩余可自动重排次数（UI 展示用） */
    remainingRefreshes: () => remainingRegenerations(),
    /** 手动重新生成（绕过缓存，取最新工作台数据，始终可用） */
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

/** 上一次生成规划时的快照（供显著性判断用） */
let lastSnapshot: ReturnType<typeof takeSnapshot> | null = null

/**
 * 监听三类「指派给我」工作项的 id+status 签名。
 * 签名变化时走显著性门控：只有「新增逾期 / 紧急 Bug / 今日截止项状态变更 / 天气预警」
 * 才触发重排，受同日最多 3 次节流。手点「刷新」始终可用（不走门控）。
 * 仅靠 stale computed 无法自己跑，必须由 watcher 主动调用 generate(false) 才会有 LLM 请求——
 * 组件挂载时生成一次，此后由数据显著变化驱动，而不是一有风吹草动就重排。
 */
function ensureDataWatcher() {
  if (watchingData) return
  watchingData = true
  watch(
    () => currentDataSignature(),
    () => {
      // 生成中不重排（避免与进行中的 generate 冲突，也避免空耗预算）
      if (generating.value) return
      // 显著性门控：不值得重排的变化直接跳过
      const { significant } = isSignificantChange(lastSnapshot)
      if (!significant) return
      // 节流器：同日自动重排上限
      if (!consumeRegenerationBudget()) return
      void generate(false)
    },
  )
}

// 连通恢复后自动续生成（断网期间错过的晨报，恢复后立即补上）
onRecover(() => void generate(false))
