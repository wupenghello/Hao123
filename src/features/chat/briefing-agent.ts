/**
 * 每日晨报 · 独立 agent 循环
 *
 * 与 chat/store.ts 的 agent 循环「同底不同路」：
 *  - 同底：复用 llm.chatStream + callTool + clipForModel + openAiTools 基础设施
 *  - 不同路：无 UI、只读工具集、maxRounds=2、responseFormat=json_object
 *
 * 循环设计（至多 2 轮）：
 *  - Round 1：并行查天气 / 禅道任务 / 禅道 Bug / 本地待办（+ 可选知识库）
 *  - Round 2：模型基于全量数据合成结构化 JSON 规划（responseFormat=json_object 保合法）
 *
 * 失败降级：agent 循环任何环节失败 → 返回 null，由 briefing.ts 回退到 llm.complete 原路径。
 * 这样 agent 是「锦上添花」，失败不影响现有晨报体验。
 */
import { llm } from './llm'
import { callTool, openAiTools, kbEnabled } from './tools'
import { useWeatherStore } from '@/features/weather'
import { classifyError, markUnreachable } from './connectivity'
import type { DailyPlan, DailyPlanResult, BriefingProgress, BriefingStep, BriefingAgentCallbacks } from './daily-plan'

/** 生成唯一 id（活动） */
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 晨报 agent 允许调用的只读工具前缀（白名单，规避写操作风险）。
 *  注意：不含 weather__--天气数据直接从 weather store 读（用项目统一当前定位），不让模型调 weather 工具（模型不知道用户在哪，会默认北京）。 */
const ALLOWED_TOOL_PREFIXES = ['zentao__', 'local__list', 'kb__search', 'kb__health']

/** 从全量工具声明里筛出晨报 agent 可用的只读子集 */
function toolsForBriefing() {
  return openAiTools.filter((t) => {
    const name = t.function.name
    // local 只允许 list（local__create/update/complete/delete 是写操作，排除）
    if (name.startsWith('local__') && name !== 'local__list') return false
    // kb 仅在已配置时下发
    if (name.startsWith('kb__') && !kbEnabled) return false
    return ALLOWED_TOOL_PREFIXES.some((p) => name.startsWith(p))
  })
}


/** 解析模型返回的 JSON 规划（容错：允许包裹在 ```json 代码块里） */
function parsePlan(raw: string): DailyPlan | null {
  if (!raw) return null
  let text = raw.trim()
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) text = fence[1].trim()
  // 取第一个 { 到最后一个 } 之间的内容（容错模型前后缀废话）
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  text = text.slice(start, end + 1)
  try {
    const obj = JSON.parse(text)
    // 必要字段校验
    if (!obj || typeof obj !== 'object') return null
    if (!obj.topPriority || !Array.isArray(obj.groups) || !obj.timing || !obj.focus) return null
    return obj as DailyPlan
  } catch {
    return null
  }
}

/** 把结构化 plan 转成自然语言叙述（兜底展示 + 无 plan 时 UI 仍有一句话） */
export function planToNarrative(plan: DailyPlan): string {
  const lines: string[] = []
  const tp = plan.topPriority
  const tpMeta = [tp.riskLabel, tp.priorityLabel, tp.deadline && `截止${tp.deadline}`].filter(Boolean).join(' · ')
  lines.push(`今天先抓「${tp.title}」${tpMeta ? `（${tpMeta}）` : ''}${tp.reason ? '：' + tp.reason : ''}。`)
  for (const g of plan.groups) {
    if (!g.items.length) continue
    const titles = g.items.map((it) => `「${it.title}」`).join('、')
    lines.push(`${g.label}：${titles}。`)
  }
  const t = plan.timing
  const rhythm = [t.morning && `上午 ${t.morning}`, t.afternoon && `下午 ${t.afternoon}`, t.evening && `收尾 ${t.evening}`].filter(Boolean)
  if (rhythm.length) lines.push(rhythm.join('；') + '。')
  if (plan.weatherNote) lines.push(plan.weatherNote)
  return lines.join('\n')
}

/** 晨报 agent 系统 prompt（独立于 chat 的 system prompt：这是「一次性规划」场景） */
function briefingSystemPrompt(now: Date): string {
  const dateStr = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
  return [
    `你正在为用户的「今日工作规划」做决策支持。现在是${dateStr}。`,
    '',
    '# 你的任务',
    '基于工作台快照（天气 + 指派给我的禅道任务/Bug + 本地待办），排出今天的处理顺序，输出结构化 JSON 规划。',
    '',
    '# 铁律（不可违反）',
    '1. 禁止反问：不请求更多信息、不说「需要更多数据」、不问用户。快照数据已足够决策。',
    '2. 信息缺口按合理默认处理：任务无截止日期（deadline 为空 / 0000-00-00）视为「不紧急」按优先级排；无进度信息视为「未开始」。不要因信息缺口拒绝输出。',
    '3. 禁止编造：只引用快照里真实存在的工作项名、数字、天气；不确定的字段留空。',
    '4. 最后一轮必须只输出 JSON：不输出解释、反问、寒暄、Markdown 代码块。若想问用户，直接转成基于现有信息的最佳判断写入 JSON。',
    '5. 排序：逾期 > 今天截止 > 紧急 > 临期 > 停滞 > 其它；同档按优先级（pri 小 > 大）、截止日（早 > 晚）。',
    '6. 分组：「先处理」至多 3 项 /「顺手推进」≤ 3 项 /「可以推迟」≤ 3 项。',
    '',
    '# 工具使用',
    '天气数据已在上方上下文提供（用户当前定位）。第一轮并行拉取任务、Bug、本地待办。数据足够，不要查任务详情、不要查知识库（除非某逾期项需要判断根因' + (kbEnabled ? '，或涉及内部流程时检索知识库' : '') + '）。',
    '第二轮直接输出 JSON，不要任何额外文字。',
    '',
    '# 输出 JSON 结构',
    JSON.stringify({
      topPriority: { key: 'task-123', source: '禅道任务', title: '示例任务', priority: 1, priorityLabel: '紧急', status: '进行中', deadline: '2026-07-18', riskLabel: '逾期', thread: 'Q3 改版', reason: '为什么先处理它', action: '今天具体做到哪一步' },
      groups: [{ label: '先处理', items: [{ key: 'task-123', source: '禅道任务', title: '示例任务', priority: 1, priorityLabel: '紧急', status: '进行中', deadline: '2026-07-18', riskLabel: '逾期', thread: 'Q3 改版', reason: '为什么排这里', action: '今天具体做到哪一步' }] }, { label: '顺手推进', items: [] }, { label: '可以推迟', items: [] }],
      timing: { morning: '上午重点', afternoon: '下午重点', evening: '收尾' },
      weatherNote: '仅天气确有影响时填写，否则空字符串',
      focus: '今天主线一句话',
      dataSignature: '生成时数据签名（占位，由系统回填）',
      generatedAt: 0,
    }, null, 2),
  ].join('\n')
}

/** 步骤 key -> 人话标签（不展示技术化工具名） */
const STEP_LABELS: Record<string, string> = {
  weather: '看天气',
  tasks: '查你的任务',
  bugs: '查测试给你的 Bug',
  local: '看本地待办',
  kb: '查知识库',
  synthesis: '综合排期',
}

/** 工具线上名 -> 步骤 key（详情类工具不展示，避免噪音） */
function toolToStepKey(toolName: string): string | null {
  if (toolName.startsWith('weather__')) return 'weather'
  if (toolName === 'zentao__my_tasks') return 'tasks'
  if (toolName === 'zentao__my_bugs') return 'bugs'
  if (toolName === 'local__list') return 'local'
  if (toolName === 'kb__search') return 'kb'
  return null
}

/** 从工具结果提炼简短摘要（人话，如「阴 26°C」「4 个任务」） */
function extractSummary(stepKey: string, result: unknown): string | undefined {
  try {
    const r = result as any
    if (stepKey === 'weather') {
      const now = r?.now || r
      if (now?.text && now?.temp != null) return `${now.text} ${now.temp}°C`
      return undefined
    }
    if (stepKey === 'tasks') {
      const n = r?.tasks?.length ?? 0
      return n > 0 ? `${n} 个任务` : '无任务'
    }
    if (stepKey === 'bugs') {
      const n = r?.bugs?.length ?? 0
      return n > 0 ? `${n} 个 Bug` : '无 Bug'
    }
    if (stepKey === 'local') {
      const list = r?.tasks ?? r?.list ?? []
      const open = Array.isArray(list) ? list.filter((t: any) => !t.done).length : 0
      return open > 0 ? `${open} 个待办` : '无待办'
    }
    if (stepKey === 'kb') {
      const n = r?.results?.length ?? r?.hits?.length ?? 0
      return n > 0 ? `${n} 条相关` : '无相关'
    }
  } catch { /* 提炼失败不影响主流程 */ }
  return undefined
}

/** 预填核心步骤（全部 pending，让用户看到「还要做什么」） */
function initSteps(): BriefingStep[] {
  const keys = ['weather', 'tasks', 'bugs', 'local']
  if (kbEnabled) keys.push('kb')
  keys.push('synthesis')
  return keys.map((k) => ({ id: genId('bs'), stepKey: k, label: STEP_LABELS[k] || k, status: 'pending' }))
}

/** 把剩余 pending 步骤标 done（agent 结束时调用：没调用的视为不需要） */
function finalizeSteps(progress: BriefingProgress): void {
  progress.steps.forEach((s) => { if (s.status === 'pending') s.status = 'done' })
  progress.completed = progress.steps.filter((s) => s.status === 'done' || s.status === 'error').length
}

/**
 * 运行晨报 agent 循环，产出结构化规划。
 * 失败返回 null（由调用方降级到 llm.complete 原路径）。
 *
 * 进度可感知：
 *  - 通过 opts.onProgress / opts.onActivity 回调把「正在查哪几个工具」「哪个完成」实时推给 UI
 *  - 单活动 error 不阻断整体（该项标 ❌，其余继续）
 *  - 阶段切换：gathering（并行拉取）→ synthesizing（模型合成）→ done / error
 */
export async function runBriefingAgent(opts: { maxRounds?: number } & BriefingAgentCallbacks = {}): Promise<DailyPlanResult> {
  if (!llm.configured) {
    return { plan: null, narrative: '', fromAgent: true, toolsUsed: [] }
  }
  const maxRounds = Math.min(Math.max(1, opts.maxRounds ?? 2), 3)
  const toolsUsed: string[] = []
  // ── 天气数据直接从 weather store 读（用项目统一当前定位），不让模型调 weather 工具 ──
  const weather = useWeatherStore()
  await weather.ensureReady()
  const wNow = weather.now
  const wToday = weather.daily[0]
  const wCity = weather.cityName
  const weatherContext = [
    wCity && `所在城市：${wCity}`,
    wNow && `当前${wNow.text} ${wNow.temp}°C`,
    wToday && `今日 ${wToday.tempMin}~${wToday.tempMax}°C，白天${wToday.textDay}`,
  ].filter(Boolean).join('；')
  const weatherSummary = wNow ? `${wNow.text} ${wNow.temp}°C` : undefined
  const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }> = [
    { role: 'system', content: briefingSystemPrompt(new Date()) },
    { role: 'user', content: `以下是用户当前定位的真实天气：${weatherContext || '暂无天气数据'}

请基于工作台快照（上述天气 + 指派给我的禅道任务/Bug + 本地待办），排出今天的处理顺序，输出结构化 JSON 规划。` },
  ]

  // ── 进度状态（可变，emit 时传快照）──
  const progress: BriefingProgress = {
    phase: 'gathering',
    steps: initSteps(),
    total: 0,
    completed: 0,
    startedAt: Date.now(),
    message: '小吴正在收集你的工作台…',
  }
  progress.total = progress.steps.length
  const emit = () => opts.onProgress?.({ ...progress, steps: progress.steps.map((s) => ({ ...s })) })

  /** 更新某个步骤的状态 + 摘要 */
  const setStep = (stepKey: string, status: BriefingStep['status'], summary?: string, error?: string) => {
    const step = progress.steps.find((s) => s.stepKey === stepKey)
    if (!step) return
    step.status = status
    if (summary !== undefined) step.summary = summary
    if (error !== undefined) step.error = error
    progress.completed = progress.steps.filter((s) => s.status === 'done' || s.status === 'error').length
    emit()
  }
  emit()
  // 天气数据已从 store 读出注入 context，weather 步骤直接标 done（不调工具）
  setStep('weather', 'done', weatherSummary)

  try {
    for (let round = 0; round < maxRounds; round++) {
      const isLastRound = round === maxRounds - 1

      // 最后一轮：进入合成阶段（在 chatStream 前标状态，让流式 onText 能实时反馈）
      if (isLastRound) {
        progress.phase = 'synthesizing'
        progress.message = '小吴正在综合排期…'
        // 数据已够，把不会再查的工具步骤标 done（如知识库），只留 synthesis running
        progress.steps.forEach((s) => { if (s.stepKey !== 'synthesis' && s.status === 'pending') s.status = 'done' })
        setStep('synthesis', 'running')
      }

      let synthChars = 0
      let lastSynthEmit = 0
      const { content, toolCalls } = await llm.chatStream({
        messages: messages as any,
        tools: toolsForBriefing(),
        temperature: isLastRound ? 0.2 : 0.3,
        toolChoice: isLastRound ? 'none' : 'auto',
        onText: (delta) => {
          // 合成阶段流式反馈：实时显示「已写 X 字」，让用户知道在动而非卡死
          if (!isLastRound) return
          synthChars += delta.length
          const now = Date.now()
          if (now - lastSynthEmit > 200) {
            lastSynthEmit = now
            progress.message = `小吴正在综合排期… 已写 ${synthChars} 字`
            emit()
          }
        },
      })

      // 合成（最后一轮，或非最后一轮但模型没调工具直接给答案）
      if (isLastRound || !toolCalls.length) {
        if (!isLastRound) {
          progress.phase = 'synthesizing'
          progress.message = '小吴正在综合排期…'
          progress.steps.forEach((s) => { if (s.stepKey !== 'synthesis' && s.status === 'pending') s.status = 'done' })
          setStep('synthesis', 'running')
        }
        const plan = parsePlan(content)
        if (plan) {
          setStep('synthesis', 'done')
          finalizeSteps(progress)
          progress.phase = 'done'
          progress.message = '规划已就绪'
          progress.finishedAt = Date.now()
          emit()
          return { plan, narrative: planToNarrative(plan), fromAgent: true, toolsUsed }
        }
        // 没解析出合法 JSON -> 降级（若 content 是 JSON 片段，不存为 narrative，让 fallback 接管，避免显示原始 JSON）
        setStep('synthesis', 'done')
        finalizeSteps(progress)
        progress.phase = 'done'
        progress.finishedAt = Date.now()
        emit()
        const looksLikeJson = content.trim().startsWith('{') || content.trim().startsWith('```')
        return { plan: null, narrative: looksLikeJson ? '' : content.trim(), fromAgent: true, toolsUsed }
      }

      // ── 并行拉取：把对应步骤标 running，完成后写 summary ──
      const assistantMsg: any = { role: 'assistant', content, tool_calls: toolCalls }
      messages.push(assistantMsg)
      const results = await Promise.all(
        toolCalls.map(async (call) => {
          const name = call.function.name
          toolsUsed.push(name)
          const stepKey = toolToStepKey(name)
          if (stepKey) setStep(stepKey, 'running')
          let args: Record<string, unknown> = {}
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
          } catch {
            if (stepKey) setStep(stepKey, 'error', undefined, '参数解析失败')
            return { name, result: JSON.stringify({ error: '参数解析失败' }) }
          }
          try {
            const result = await callTool(name, args)
            if (stepKey) setStep(stepKey, 'done', extractSummary(stepKey, result))
            return { name, result: JSON.stringify(result) }
          } catch (e) {
            const msg = (e as Error)?.message || '工具执行失败'
            if (stepKey) setStep(stepKey, 'error', undefined, msg)
            return { name, result: JSON.stringify({ error: msg }) }
          }
        }),
      )
      for (let i = 0; i < toolCalls.length; i++) {
        messages.push({ role: 'tool', tool_call_id: toolCalls[i].id, content: results[i].result })
      }
    }
    // 用尽轮次仍没拿到合法 JSON
    finalizeSteps(progress)
    progress.phase = 'error'
    progress.message = '规划生成失败，可重试'
    progress.finishedAt = Date.now()
    emit()
    return { plan: null, narrative: '', fromAgent: true, toolsUsed }
  } catch (e) {
    // 任何异常 → error phase + 上报连通性层（让首页琥珀条 / 自动重试生效）
    const reason = classifyError(e)
    if (reason) markUnreachable(reason)
    progress.phase = 'error'
    progress.message = (e as Error)?.message || '规划生成失败'
    progress.finishedAt = Date.now()
    emit()
    return { plan: null, narrative: '', fromAgent: true, toolsUsed }
  }
}
