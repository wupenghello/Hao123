/**
 * 小吴 · 常驻 AI 伙伴 · 状态层 composable
 *
 * 装配工作台现有信号 → mood（确定性）+ 气泡（克制 ambient）+ actions（hand-off）。
 *  - mood：resolveMood 纯函数，输入 configured/connectivity/streaming/unread/风险/问候。
 *  - 气泡：问候（当日首见）/ 洞察（签名变化）/ 恢复（onRecover）/ 庆祝（完成事件），克制不刷屏。
 *  - 成长：本地任务完成 → celebrate + growth.tasksDone++（codepet 式反馈）；git commit 留 notifyGrowth 扩展点。
 *  - 单例 wiring：模块级持久态 + 瞬态，useCompanion() 内 guarded-once 注册 watcher / onRecover。
 *
 * 与渲染解耦：本文件不关心 Live2D / 占位，只产 mood/bubble；视觉由 CompanionPet + renderer 消费。
 */
import { ref, computed, watch } from 'vue'
import { useStorage } from '@/composables/useStorage'
import { useChatStore, useConnectivity, onRecover } from '@/features/chat'
import {
  buildInboxPlanActionFlowPrompt,
  buildInsightActionFlowPrompt,
  type ActionFlowSummary,
} from '@/features/chat'
import { useInboxInsights } from '@/features/insights'
import { useLocalTaskStore } from '@/features/local-tasks'
import { resolveMood, type MoodSignals } from './mood'
import { MOOD_VISUAL } from './ui'
import {
  buildGreeting,
  buildInsightBubble,
  buildRecovery,
  buildCelebration,
  insightSignature,
} from './speech'
import {
  COMPANION_STATE_KEY,
  LEGACY_LAUNCHER_POS_KEY,
  DEFAULT_MODEL_SOURCE,
  DEFAULT_RENDERER,
  DISMISSED_CAP,
  SLEEP_HOUR_START,
  SLEEP_HOUR_END,
  CELEBRATE_MS,
  GREETING_DELAY_MS,
} from './config'
import type { CompanionState, CompanionMood, BubblePayload } from './types'

function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function inSleepWindow(): boolean {
  const h = new Date().getHours()
  return h >= SLEEP_HOUR_START || h < SLEEP_HOUR_END
}
function nextMorningTs(): number {
  const d = new Date()
  d.setHours(SLEEP_HOUR_END, 0, 0, 0)
  d.setDate(d.getDate() + 1)
  return d.getTime()
}
function migratePosition(): { left: number; top: number } | null {
  try {
    const raw = localStorage.getItem(LEGACY_LAUNCHER_POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p && typeof p.left === 'number' && typeof p.top === 'number') return { left: p.left, top: p.top }
  } catch {
    /* 损坏的旧键忽略 */
  }
  return null
}

function defaultState(): CompanionState {
  return {
    position: null,
    mutedUntil: null,
    sleepUntil: null,
    lastGreetDate: null,
    shownInsightSig: null,
    dismissedBubbles: [],
    renderer: DEFAULT_RENDERER,
    modelSource: DEFAULT_MODEL_SOURCE,
    growth: { commits: 0, tasksDone: 0 },
  }
}

// ── 模块级持久态（单例）──
const state = useStorage<CompanionState>(COMPANION_STATE_KEY, defaultState())

// ── 瞬态（不落盘）──
const celebrating = ref(false)
let celebrateTimer: ReturnType<typeof setTimeout> | undefined
const greetingDue = ref(false)
const bubble = ref<BubblePayload | null>(null)
const hidden = ref(false)

// ── 单例 wiring 守卫 ──
let wired = false
let prevDoneCount = 0

function bubbleSig(p: BubblePayload): string {
  return `${p.kind}:${p.text.slice(0, 24)}`
}

export function useCompanion() {
  const chat = useChatStore()
  const conn = useConnectivity()
  const { summary, insights } = useInboxInsights()
  const localStore = useLocalTaskStore()

  const isMuted = computed(() => !!state.value.mutedUntil && Date.now() < state.value.mutedUntil)
  const isSleeping = computed(() => inSleepWindow() || (!!state.value.sleepUntil && Date.now() < state.value.sleepUntil))
  const canSpeak = computed(
    () => !!chat.configured && !isMuted.value && !isSleeping.value && !hidden.value && !chat.open,
  )

  const topRisk = computed<MoodSignals['topRisk']>(() => {
    // insights 的 RiskLevel 用连字符（'due-soon'），映射到内部 camel 口径
    const t = (summary.value as { top?: string | null }).top
    if (t === 'overdue') return 'overdue'
    if (t === 'due-soon') return 'dueSoon'
    if (t === 'stalled') return 'stalled'
    return null
  })

  const mood = computed<CompanionMood>(() =>
    resolveMood({
      configured: !!chat.configured,
      connectivity: conn.status.value as MoodSignals['connectivity'],
      streaming: !!chat.streaming,
      celebrating: celebrating.value,
      unread: !!chat.unread,
      open: !!chat.open,
      topRisk: topRisk.value,
      greetingDue: greetingDue.value,
    }),
  )

  const visual = computed(() => MOOD_VISUAL[mood.value])
  const growth = computed(() => state.value.growth)

  // ── actions ──
  function showBubble(p: BubblePayload): void {
    if (!canSpeak.value) return
    if (state.value.dismissedBubbles.includes(bubbleSig(p))) return
    bubble.value = p
  }
  function dismissBubble(): void {
    const cur = bubble.value
    if (cur) {
      const sig = bubbleSig(cur)
      const list = [...state.value.dismissedBubbles.filter((x) => x !== sig), sig]
      while (list.length > DISMISSED_CAP) list.shift()
      state.value = { ...state.value, dismissedBubbles: list }
    }
    bubble.value = null
  }
  function celebrate(extra?: string): void {
    if (celebrateTimer) clearTimeout(celebrateTimer)
    celebrating.value = true
    celebrateTimer = setTimeout(() => {
      celebrating.value = false
    }, CELEBRATE_MS)
    if (canSpeak.value) showBubble(buildCelebration(extra))
  }
  function deepChat(prompt: string): void {
    chat.show()
    void chat.send(prompt)
  }
  function openPalette(): void {
    chat.show()
  }
  function mute30(): void {
    state.value = { ...state.value, mutedUntil: Date.now() + 30 * 60 * 1000 }
    bubble.value = null
  }
  function sleepUntilMorning(): void {
    state.value = { ...state.value, sleepUntil: nextMorningTs() }
    bubble.value = null
  }
  function toggleHide(): void {
    hidden.value = !hidden.value
    if (hidden.value) bubble.value = null
  }
  function resetPosition(): void {
    state.value = { ...state.value, position: null }
  }

  // ── hand-off prompt（复用 action-flow 四段式接手）──
  function planPrompt(): string {
    const s = summary.value as unknown as ActionFlowSummary
    return buildInboxPlanActionFlowPrompt(
      {
        total: s.total,
        urgentCount: 0,
        overdue: s.overdue,
        dueSoon: s.dueSoon,
        stalled: s.stalled,
        headline: s.headline,
      },
      [],
    )
  }
  function insightPrompt(title: string, action?: string): string {
    return buildInsightActionFlowPrompt({ title, action }, [])
  }

  // ── 一次性 wiring（单例）──
  if (!wired) {
    wired = true

    // 迁移老药丸位置
    if (state.value.position === null) {
      const m = migratePosition()
      if (m) state.value = { ...state.value, position: m }
    }

    // 当日首见 → 问候标记
    if (state.value.lastGreetDate !== todayStr()) greetingDue.value = true

    // 问候：延迟开口，等工作台可交互
    setTimeout(() => {
      if (!canSpeak.value) {
        greetingDue.value = false
        return
      }
      const s = summary.value as { overdue?: number; dueSoon?: number; total?: number }
      showBubble(
        buildGreeting({
          hour: new Date().getHours(),
          overdue: s.overdue ?? 0,
          dueSoon: s.dueSoon ?? 0,
          total: s.total ?? 0,
          onDeepChat: () => deepChat(planPrompt()),
        }),
      )
      state.value = { ...state.value, lastGreetDate: todayStr() }
      greetingDue.value = false
    }, GREETING_DELAY_MS)

    // 新洞察 → 主动开口（首次只记录签名不弹，避免和问候抢；签名变化才弹）
    watch(
      insights,
      (list) => {
        if (!list.length) return
        const sig = insightSignature(list)
        const prev = state.value.shownInsightSig
        if (prev === sig) return
        state.value = { ...state.value, shownInsightSig: sig }
        if (prev === null) return // 首次见：静默记录，不弹
        if (!canSpeak.value) return
        const first = list[0]
        showBubble(
          buildInsightBubble(
            { title: first.title, action: first.action },
            () => deepChat(insightPrompt(first.title, first.action)),
          ),
        )
      },
      { immediate: true },
    )

    // 本地任务完成 → 庆祝 + 成长（codepet 式反馈）
    prevDoneCount = localStore.done.length
    watch(
      () => localStore.done.length,
      (n) => {
        if (n > prevDoneCount) {
          state.value = {
            ...state.value,
            growth: { ...state.value.growth, tasksDone: state.value.growth.tasksDone + 1 },
          }
          celebrate()
        }
        prevDoneCount = n
      },
    )

    // 连通恢复 → 恢复气泡（断网期间错过的开口，恢复后补一句）
    onRecover(() => {
      if (canSpeak.value) showBubble(buildRecovery())
    })
  }

  return {
    state,
    mood,
    bubble,
    celebrating,
    hidden,
    visual,
    isMuted,
    isSleeping,
    canSpeak,
    growth,
    // actions
    showBubble,
    dismissBubble,
    celebrate,
    deepChat,
    openPalette,
    mute30,
    sleepUntilMorning,
    toggleHide,
    resetPosition,
  }
}
