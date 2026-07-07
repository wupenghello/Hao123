/**
 * Chat 助手 · 收件箱洞察（LLM 主动开口）
 *
 * 与 briefing（每日晨报）同构——都是「采集 → llm.complete 加工」，但聚焦**模式 / 异常 / 归因**
 * 而非「今日叙事」：基于 insights 模块的**确定性检测**结果（同根因 / Bug 集中 / 多项逾期 /
 * 负载 / 高优停滞），让小吴用一两句话主动点出最值得注意的一处并给一个具体建议——
 * 这就是「AI 主动开口」的高科技感。
 *
 * 分工（关键）：
 *  - **检测是确定性的**（可靠、即时、不烧 token），命中才有洞察、才发 LLM；未命中不渲染
 *    （守「克制」红线），也不产生任何 LLM 调用。
 *  - **LLM 只负责把检测到的模式说成人话 + 给建议**；未配置 LLM 时组件侧回退到检测模板文案，
 *    洞察依然展示（检测本身才是核心价值）。
 *
 * 缓存：按日 + 按检测签名（同一天同一组检测结果只生成一次）；检测签名变化（清单结构变了）
 * 才重生成——既响应变化又不过度调用。
 */
import { ref, computed, watch } from 'vue'
import { useStorage } from '@/composables/useStorage'
import { llm } from './llm'
import { classifyError, clearConnectivityIssue, markUnreachable, onRecover } from './connectivity'
import { useInboxInsights } from '@/features/insights'
import type { Insight } from '@/features/insights'

/** localStorage 键：持久化的洞察文案 */
const INSIGHT_KEY = 'hao123-inbox-insight'

interface InsightState {
  /** LLM 生成的主动提醒正文 */
  content: string
  /** 触发它的检测签名（检测到的洞察集合 hash）；签名变化才需重生成 */
  signature: string
  /** 生成日期 yyyy-MM-dd */
  date: string
  /** 生成时间戳 */
  generatedAt: number
}

const state = useStorage<InsightState | null>(INSIGHT_KEY, null)
const generating = ref(false)

/** 本地日期 yyyy-MM-dd */
function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 检测签名：把检测到的洞察 kind+title 串起来，作为缓存键 */
function signatureOf(insights: Insight[]): string {
  return insights.map((i) => `${i.kind}:${i.title}`).join('|')
}

/** 洞察系统提示词（与晨报 / 对话的 system prompt 独立：一次性生成场景，不走 agent 循环） */
const INSIGHT_SYSTEM_PROMPT = [
  '你在为用户的收件箱做一次「主动洞察」——你看了一遍 ta 指派的任务 / Bug / 本地待办，发现了下面这些值得注意的模式。',
  '请用简体中文，挑最值得注意的**一处**，用一两句话主动提醒 ta（像靠谱同事顺嘴提一句），并给一个**具体**的下一步建议。',
  '要求：直入主题，不寒暄、不啰嗦、不用感叹号；工作项名用「」框起来；只输出提醒正文，不要标题、不要解释你是 AI。',
].join('\n')

/**
 * 按需生成洞察文案。
 * - 无检测 / 未配置：清掉旧文案（组件侧改用检测模板），不发 LLM。
 * - 同日同签名已生成：直接复用，省一次 LLM 调用。
 * - 进行中：跳过，避免重复调用。
 */
async function generate(insights: Insight[]): Promise<void> {
  if (generating.value) return
  if (!insights.length || !llm.configured) {
    if (state.value) state.value = null
    return
  }
  const sig = signatureOf(insights)
  if (state.value && state.value.date === todayStr() && state.value.signature === sig) return

  generating.value = true
  try {
    const material = insights.map((i) => `- ${i.title}（${i.detail || '见清单'}）`).join('\n')
    const raw = await llm.complete({
      messages: [
        { role: 'system', content: INSIGHT_SYSTEM_PROMPT },
        { role: 'user', content: `以下是发现，请据此写主动提醒：\n${material}` },
      ],
      temperature: 0.5,
      maxTokens: 280,
    })
    const content = raw.trim()
    if (content) state.value = { content, signature: sig, date: todayStr(), generatedAt: Date.now() }
  } catch (e) {
    // 网络类错误归连通性层（让 UnifiedInbox 的洞察卡显示「AI 解读暂不可用」）；
    // 失败仍静默——组件侧回退检测模板，不抛错、不留错态干扰首页
    const reason = classifyError(e)
    if (reason) markUnreachable(reason)
    else clearConnectivityIssue()
  } finally {
    generating.value = false
  }
}

// 连通恢复后自动续生成（断网期间错过的洞察，恢复后立即补上）
let latestInsights: Insight[] = []
onRecover(() => {
  void generate(latestInsights)
})

/**
 * 首页「小吴的洞察」卡 composable。
 * 调用即按需触发生成（有检测 + 已配置 + 未缓存才真正跑 LLM）；检测结果变化时自动续生成。
 */
export function useInboxInsight() {
  const { insights } = useInboxInsights()

  // 检测结果变化时按需生成（缓存守卫确保同日同签名只生成一次）
  watch(insights, (val) => {
    latestInsights = val
    void generate(val)
  }, { immediate: true })

  /** 当前可用的 LLM 文案：仅当已配置、今日已生成、且签名仍匹配当前检测时才有值 */
  const content = computed(() => {
    if (!state.value || state.value.date !== todayStr()) return null
    if (state.value.signature !== signatureOf(insights.value)) return null
    return state.value.content
  })

  return {
    /** 当前检测到的洞察（确定性，始终可用；LLM 未配置时即用它展示） */
    insights,
    /** LLM 生成的主动提醒正文（已配置且已生成且仍匹配当前检测时才有值，否则 null） */
    content,
    generating,
    /** 手动重新分析（清缓存后重生成；LLM 未配置时无操作） */
    refresh: () => {
      if (!insights.value.length || !llm.configured || generating.value) return
      state.value = null
      void generate(insights.value)
    },
  }
}
