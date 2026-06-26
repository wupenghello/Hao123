/**
 * Chat 助手状态层
 *
 * - 悬浮面板开合、对话消息、流式中标志、错误。
 * - send() 实现 agent 循环：流式取回复 → 若有 tool_calls 则执行工具并回灌 → 继续，
 *   直至模型不再调用工具或达到最大轮数。工具执行过程以 ToolActivity 实时呈现。
 * - regenerate() 重答最后一轮；clear() 清空。
 * - 历史持久化到 localStorage（不含 system 提示词）。
 * - 异步卫生沿用项目约定：abort 上一次 + signal.aborted 守卫 + finally 复位。
 *
 * 优化项：
 * - System prompt 拆为静态（能力/风格）+ 动态（时间/城市）两条消息，让 DeepSeek 的
 *   prompt caching 命中静态前缀，减少重复计费。
 * - 能力列表从已注册的 openAiTools 动态生成，而非手写；新增/删除工具时 prompt 自动同步。
 * - Agent 循环使用 temperature=0.3（工具调用更准确）+ max_tokens=2048（控制成本和延迟）。
 * - 工具结果在 JSON 边界处截断，避免模型收到残缺 JSON。
 * - 轻量意图分类：时间/UI 操作类问题直接本地回答，省去不必要的 LLM 调用。
 * - 反馈系统：用户可对 assistant 消息 👍/👎，用于质量追踪与 prompt 迭代。
 */
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { useWeatherStore } from '@/features/weather'
import { ASSISTANT_NAME } from './config'
import { llm } from './llm'
import { callTool, toolLabel, toolDetail, selectToolsForIntent, kbEnabled } from './tools'
import {
  daypart,
  formatDate,
  formatTime,
  truncateHistory,
  cleanupEmptyAssistant,
  MAX_HISTORY_TOKENS,
} from './utils'
import type { ChatMessage, ToolActivity } from './types'

/** agent 循环最大轮数，防止工具调用失控 */
const MAX_ROUNDS = 5

// ============ 轻量意图分类（本地回答，省 LLM 调用）============

type LocalIntent = { type: 'time'; answer: string } | { type: 'ui'; action: () => void; answer: string }

/**
 * 检测用户消息是否可由本地直接回答（无需 LLM）。
 * 只处理最明确的几类，宁可漏判也不误判。
 */
function detectLocalIntent(text: string): LocalIntent | null {
  const t = text.trim()

  // 时间查询（精确匹配短句）
  if (/^(现在)?几点了[？?。]?$/i.test(t) || /^(当前|现在)(的)?时间$/i.test(t) || /^what.?time/i.test(t)) {
    const now = new Date()
    return { type: 'time', answer: `现在是 ${formatDate(now)} ${formatTime(now)}（${daypart(now.getHours())}）。` }
  }

  return null
}

// ============ System Prompt（拆为静态 + 动态，优化 prompt caching）============

/**
 * 从已注册工具自动生成能力描述。
 * 新增/删除工具时 prompt 自动同步，不再需要手动维护。
 */
function buildCapabilitiesFromTools(): string[] {
  const lines: string[] = []

  // 检查是否有天气工具
  const hasWeather = selectToolsForIntent('天气').some((t) => t.function.name.startsWith('weather'))
  if (hasWeather) {
    lines.push('- 天气：实时天气、未来 3/7/10/15 天预报、逐小时预报、分钟级降水、生活指数（穿衣/运动/紫外线等）。')
  }

  // 检查是否有禅道工具（始终存在，但运行时可能未配置）
  const hasZentao = selectToolsForIntent('任务').some((t) => t.function.name.startsWith('zentao'))
  if (hasZentao) {
    lines.push('- 禅道（只读查看，无法新建或修改）：我的任务列表与详情、我的 Bug 列表与详情。')
  }

  // 检查是否有知识库工具（依据真实配置：已配置来源才暴露 kb.search）
  if (kbEnabled) {
    lines.push('- 项目知识库：开发/测试/预发/生产各环境域名、部署流程、个人笔记、常见问答等内部文档。')
  }

  return lines
}

/** 静态 system prompt（会话内不变，供 DeepSeek prompt caching 命中） */
const STATIC_SYSTEM_PROMPT = [
  `你是「${ASSISTANT_NAME}」，嵌在 Hao123 个人工作台里的智能助理。`,
  '',
  '# 你的能力',
  ...buildCapabilitiesFromTools(),
  '',
  '# 工作方式',
  '- 涉及天气或禅道数据时，必须先调用对应工具拿到真实数据再回答，绝不凭空编造数字或结论。',
  '- 涉及项目内部信息（环境域名、部署流程、内部约定、笔记、FAQ）时，先调用 kb.search 检索知识库再回答，绝不凭记忆编造地址或流程。',
  '- 用户没指明地点/日期时，用下方「当前上下文」里的默认城市与当前日期补全，直接执行，不要反问。',
  '- 一个问题可能需要多次/多个工具配合（如先搜城市再查天气、先列任务再看详情），自行规划。',
  '- 工具返回的数据若为空或报错，如实说明，并给出下一步建议，不要假装有数据。',
  '',
  '# 回答风格',
  '- 简体中文，口吻自然亲切、简洁不啰嗦，像一位靠谱的同事。',
  '- 善用 Markdown：要点用列表、关键数据用 **加粗**、多维对比用表格，让信息一眼能抓住重点。',
  '- 数据型回答先给结论/概览，再列细节；天气可适当加一句贴心提示（如带伞、添衣）。',
  '- 不要暴露工具名、接口、字段等技术细节，用户只关心结果。',
].join('\n')

/** 动态上下文消息（每轮刷新：时间 + 城市；作为独立 system 消息，不影响静态前缀缓存） */
function dynamicContextMessage(): ChatMessage {
  const now = new Date()
  const dateStr = formatDate(now)
  const timeStr = formatTime(now)
  const dp = daypart(now.getHours())

  const weather = useWeatherStore()
  // autoLocate 失败兜底已改为 nearestCity().name（不再写 '当前位置' 占位），故此处直接取城市名，
  // 仅在 cityName 为空（未初始化）时回退默认「北京」。
  const city = weather.cityName || '北京'

  return {
    role: 'system',
    content: [
      '# 当前上下文（实时刷新）',
      `- 现在是 ${dateStr} ${timeStr}（${dp}）。用户说「今天 / 现在 / 明天 / 几点」等，一律以此为基准，不要使用训练数据里的旧时间。`,
      `- 用户默认所在城市：${city}。用户问天气、空气、穿衣等却没指明城市时，直接默认查询「${city}」，不要反问「哪里」。`,
    ].join('\n'),
  }
}

/** 构造发给模型的消息序列：静态 system + 动态 system + 截断后的历史 */
function buildApiMessages(history: ChatMessage[]): ChatMessage[] {
  const truncated = truncateHistory(history, MAX_HISTORY_TOKENS)

  // 如果历史被截断了，插入一条提醒（让模型知道早期对话已丢失）
  const wasTruncated = truncated.length < history.length
  const contextNote: ChatMessage[] = wasTruncated
    ? [
        {
          role: 'system',
          content: '（提示：早期对话因长度已省略，请基于当前上下文回答。若用户引用了早期内容，请礼貌说明已不在上下文中。）',
        },
      ]
    : []

  return [
    { role: 'system', content: STATIC_SYSTEM_PROMPT },
    dynamicContextMessage(),
    ...contextNote,
    ...truncated,
  ]
}

export const useChatStore = defineStore('chat', () => {
  const open = ref(false)
  // 持久化的对话历史（user/assistant/tool；不含 system）
  const messages = useStorage<ChatMessage[]>('hao123-chat-history', [])
  const streaming = ref(false)
  const error = ref<string | null>(null)
  /** 未读提示：面板关闭时收到新回复，圆钮上显示小红点 */
  const unread = ref(false)
  /** 反馈统计（持久化，用于质量追踪） */
  const feedbackStats = useStorage<{ up: number; down: number; regenerations: number }>(
    'hao123-chat-feedback',
    { up: 0, down: 0, regenerations: 0 },
  )

  const configured = computed(() => llm.configured)
  const hasMessages = computed(() =>
    messages.value.some((m) => m.role === 'user' || m.role === 'assistant'),
  )

  let abortController: AbortController | null = null

  function toggle() {
    open.value = !open.value
    if (open.value) unread.value = false
  }

  /** 召唤面板（快捷键 / 入口按钮 / 欢迎页触发） */
  function show() {
    open.value = true
    unread.value = false
  }

  /** 关闭面板（Esc / 遮罩 / 关闭按钮）；不打断进行中的生成 */
  function close() {
    open.value = false
  }

  function clear() {
    stop()
    messages.value = []
    error.value = null
  }

  function stop() {
    abortController?.abort()
    abortController = null
    streaming.value = false
  }

  /**
   * 用户对 assistant 消息的反馈（👍/👎）。
   * 用于质量追踪与 prompt 迭代。
   */
  function rate(messageIndex: number, rating: 'up' | 'down') {
    const msg = messages.value[messageIndex]
    if (!msg || msg.role !== 'assistant') return

    // 撤销之前的反馈（如果有）
    if (msg.feedback === 'up') feedbackStats.value.up--
    if (msg.feedback === 'down') feedbackStats.value.down--

    // 设置新反馈（点击同一按钮则取消）
    if (msg.feedback === rating) {
      msg.feedback = undefined
    } else {
      msg.feedback = rating
      if (rating === 'up') feedbackStats.value.up++
      if (rating === 'down') feedbackStats.value.down++
    }
  }

  /**
   * 跑一轮 agent 循环（基于当前 messages 末尾的上下文）。
   * 调用前应已 push 好用户消息（或已截断到要重答的位置）。
   */
  async function runAgentLoop() {
    abortController?.abort()
    const controller = new AbortController()
    abortController = controller
    const signal = controller.signal

    error.value = null
    streaming.value = true

    // 获取最后一条用户消息，用于动态工具选择
    const lastUserMsg = messages.value.filter((m) => m.role === 'user').pop()?.content || ''
    const toolsForThisTurn = selectToolsForIntent(lastUserMsg)

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        // 每轮新建一个 assistant 占位消息；改「数组里的响应式代理」以驱动流式重渲染
        const idx = messages.value.push({ role: 'assistant', content: '', ts: Date.now() }) - 1
        const assistant = messages.value[idx]

        const { toolCalls } = await llm.chatStream({
          messages: buildApiMessages(messages.value.slice(0, -1)),
          signal,
          tools: toolsForThisTurn,
          // temperature: 0.3 兼顾工具调用准确性与回答自然度
          temperature: 0.3,
          // 限制单次输出长度，降低延迟和成本；工具调用轮通常很短，最终回答也够用
          maxTokens: 2048,
          onText: (delta) => {
            if (signal.aborted) return
            assistant.content += delta
          },
        })
        if (signal.aborted) return

        // 无工具调用 → 本轮即最终回答，结束
        if (!toolCalls.length) break

        // 解析参数 + 建立可视活动（先标记 running）
        assistant.tool_calls = toolCalls
        const parsedArgs: Record<string, unknown>[] = toolCalls.map((c) => {
          try {
            return c.function.arguments ? JSON.parse(c.function.arguments) : {}
          } catch {
            return { __parseError: true, raw: c.function.arguments }
          }
        })
        assistant.activities = toolCalls.map((c, i) => ({
          name: c.function.name,
          label: toolLabel(c.function.name),
          detail: toolDetail(c.function.name, parsedArgs[i]),
          status: 'running' as const,
        }))

        // 并行执行所有工具调用
        const activities = assistant.activities!
        const results = await Promise.all(
          toolCalls.map(async (call, i) => {
            const activity = activities[i] as ToolActivity
            const args = parsedArgs[i]
            if (args.__parseError) {
              activity.status = 'error'
              return `工具参数解析失败，原始内容: ${String(args.raw || '').slice(0, 200)}`
            }
            let result: unknown
            try {
              result = await callTool(call.function.name, args)
              activity.status = (result as { error?: unknown })?.error ? 'error' : 'done'
            } catch (e) {
              result = { error: (e as Error)?.message || '工具执行失败' }
              activity.status = 'error'
            }
            // 工具结果原样返回（不截断），保证信息完整；如个别工具结果过大，
            // 后续在切片层控制片段大小，而非在工具层丢数据。
            return JSON.stringify(result)
          }),
        )

        // 按顺序推送 tool 消息（保证与 tool_calls 索引对应）
        for (let i = 0; i < toolCalls.length; i++) {
          if (signal.aborted) return
          messages.value.push({
            role: 'tool',
            tool_call_id: toolCalls[i].id,
            content: results[i],
          })
        }
        // 继续下一轮，让模型基于工具结果作答
      }
      // 循环结束（用尽 MAX_ROUNDS）时若最后一条是 tool 消息，说明模型仍想调工具但已无轮次，
      // 没有给出最终文本答复。补一条兜底提示，避免页面在工具活动后静默停止、
      // 看起来「答完却没有回答」。
      const tail = messages.value[messages.value.length - 1]
      if (tail?.role === 'tool') {
        messages.value.push({
          role: 'assistant',
          content: '（已达到工具调用轮数上限，未能给出最终答复，请缩小问题范围或继续追问。）',
          ts: Date.now(),
        })
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        // 中止也要清理当前轮留下的「空 assistant 占位」（content 为空且无 tool_calls），
        // 否则它会被持久化到 localStorage，下一轮 buildApiMessages 把空 content 的
        // assistant 喂给模型，DeepSeek/OpenAI 会以 400「content must be non-empty」拒绝。
        cleanupEmptyAssistant(messages.value)
        return
      }
      const msg = (e as Error)?.message || '对话出错了，请稍后重试'
      // 诊断常见配置问题：代理未启动 / API Key 未设置
      if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) {
        error.value = '无法连接 LLM 服务，请确认 Vite 开发服务器正在运行且 /deepseek 代理已配置'
      } else if (/401|403|Unauthorized|Forbidden/.test(msg)) {
        error.value = 'LLM 认证失败，请在 .env 设置 VITE_DEEPSEEK_API_KEY 后重启 dev'
      } else {
        error.value = msg
      }
      // 移除空的尾部 assistant 占位（避免残留空气泡）
      cleanupEmptyAssistant(messages.value)
    } finally {
      if (abortController === controller) {
        streaming.value = false
        abortController = null
        if (!open.value) unread.value = true
      }
    }
  }

  /** 发送一条用户消息并跑完 agent 循环。 */
  async function send(text: string) {
    const content = text.trim()
    if (!content || streaming.value) return

    // 轻量意图分类：本地可直接回答的问题
    const localIntent = detectLocalIntent(content)
    if (localIntent) {
      messages.value.push({ role: 'user', content, ts: Date.now() })
      messages.value.push({ role: 'assistant', content: localIntent.answer, ts: Date.now() })
      return
    }

    messages.value.push({ role: 'user', content, ts: Date.now() })
    await runAgentLoop()
  }

  /**
   * 重新生成最后一条回答：回退到最后一条用户消息之后，丢弃其后的 assistant/tool 消息，
   * 再重跑 agent 循环。
   */
  async function regenerate() {
    if (streaming.value) return
    // 找到最后一条 user 消息
    let lastUser = -1
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'user') {
        lastUser = i
        break
      }
    }
    if (lastUser < 0) return
    messages.value = messages.value.slice(0, lastUser + 1)
    feedbackStats.value.regenerations++
    await runAgentLoop()
  }

  return {
    open,
    messages,
    streaming,
    error,
    unread,
    configured,
    hasMessages,
    feedbackStats,
    toggle,
    show,
    close,
    clear,
    stop,
    send,
    regenerate,
    rate,
  }
})
