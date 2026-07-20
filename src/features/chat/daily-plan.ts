/**
 * 每日晨报 · 规划产出 + 进度类型
 *
 * 晨报 agent（briefing-agent.ts）产出的结构化「今日规划」。
 * 取代原自由格式 Markdown，让 UI 渲染成可交互卡片：
 *  - topPriority：今天最该先抓的 1 件事（高亮卡）
 *  - groups：按「先处理 / 顺手推进 / 可以推迟」分组的工作项
 *  - timing：上午 / 下午 / 收尾的节奏建议
 *  - weatherNote：仅天气确有影响时的提示
 *  - focus：今天主线一句话
 *
 * 产出分两层：
 *  - plan：结构化 JSON（agent 模式主产出）
 *  - narrative：从 plan 生成的自然语言叙述（兜底 + 无 plan 时展示）
 *
 * 进度类型（BriefingProgress / BriefingActivity）：
 *  让晨报 agent 的多轮工作**实时可感知**——查了什么、哪步完成、正在合成什么。
 *  对齐 chat/store.ts 的 ToolActivity 范式（running → done / error），但去除 approval（晨报无写操作）。
 *  进度是瞬态：不落盘、刷新即清、unmount 时清理。
 */

// ── 产出类型 ──

/** 规划中的单条工作项（引用自真实工作项，只保留展示与操作所需的字段） */
export interface DailyPlanItem {
  /** 工作项 key（与 UnifiedInbox 行 key 同口径：task-{id} / bug-{id} / local-{id}） */
  key: string
  /** 来源：禅道任务 / 禅道 Bug / 本地待办 */
  source: '禅道任务' | '禅道 Bug' | '本地待办'
  /** 标题 */
  title: string
  /** 优先级（数字越小越高，1~4） */
  priority: number
  /** 优先级文案：紧急 / 高 / 中 / 低 */
  priorityLabel: string
  /** 状态文案 */
  status: string
  /** 截止日期 yyyy-MM-dd（无则空） */
  deadline?: string
  /** 风险标签：逾期 / 临期 / 停滞 / 紧急（无则空） */
  riskLabel?: string
  /** 需求线 / 项目名（有则展示，让「连成线」可见） */
  thread?: string
  /** 这项为什么排在这里（agent 给的推理） */
  reason?: string
  /** 今天具体做到哪一步（agent 给的可执行动作） */
  action?: string
}

/** 规划分组 */
export interface DailyPlanGroup {
  /** 分组标签 */
  label: '先处理' | '顺手推进' | '可以推迟'
  /** 该组工作项 */
  items: DailyPlanItem[]
}

/** 一天节奏建议 */
export interface DailyPlanTiming {
  /** 上午重点 */
  morning: string
  /** 下午重点 */
  afternoon: string
  /** 收尾 */
  evening: string
}

/** 今日规划（结构化） */
export interface DailyPlan {
  /** 今天最该先抓的 1 件事（高亮卡主体） */
  topPriority: DailyPlanItem
  /** 分组工作项（先处理 / 顺手推进 / 可以推迟） */
  groups: DailyPlanGroup[]
  /** 一天节奏建议 */
  timing: DailyPlanTiming
  /** 天气提示（仅确有影响时非空，如「下午有雷阵雨，外出带伞」） */
  weatherNote?: string
  /** 今天主线一句话（卡片副标题） */
  focus: string
  /** 生成时所用的数据签名（与 BriefingState.dataSignature 同源，用于显著性判断） */
  dataSignature: string
  /** 生成时间戳 */
  generatedAt: number
}

/** 规划生成结果（agent 主产出 + 兜底叙述） */
export interface DailyPlanResult {
  /** 结构化规划（agent 模式主产出；失败时为 null） */
  plan: DailyPlan | null
  /** 自然语言叙述（agent 模式从 plan 生成；fallback 模式直接产出） */
  narrative: string
  /** 是否走 agent 路径产出 */
  fromAgent: boolean
  /** 本次用到的工具列表（调试 / 透明度用） */
  toolsUsed: string[]
}

// ── 进度类型（瞬态，不落盘）──

/** 晨报 agent 阶段 */
export type BriefingPhase = 'gathering' | 'synthesizing' | 'done' | 'error'

/**
 * 单个工作步骤（人话叙述 + 三态）。
 * 区别于 ToolActivity：不绑技术化工具名，用 stepKey 映射到人话标签；
 * 预填 pending 步骤让用户看到「还要做什么」。
 */
export interface BriefingStep {
  /** 唯一 id */
  id: string
  /** 步骤 key（映射工具调用）：weather / tasks / bugs / local / kb / synthesis / fallback */
  stepKey: string
  /** 人话标签：「看天气」/「查你的任务」/「综合排期」 */
  label: string
  /** 状态：pending(待做) / running(进行中) / done(已完成) / error(失败) */
  status: 'pending' | 'running' | 'done' | 'error'
  /** 完成后的简短结果摘要：「阴 26°C」/「4 个任务」/「无任务」 */
  summary?: string
  /** 失败原因（status=error 时） */
  error?: string
}

/** 晨报生成进度（整体） */
export interface BriefingProgress {
  /** 当前阶段 */
  phase: BriefingPhase
  /** 工作步骤列表（预填 + 随推进更新状态） */
  steps: BriefingStep[]
  /** 本趟预判总步骤数 */
  total: number
  /** 已完成步骤数（done + error） */
  completed: number
  /** 开始时间戳（ms） */
  startedAt: number
  /** 结束时间戳（ms） */
  finishedAt?: number
  /** 阶段提示文案（如「并行拉取中…」「正在整理今日规划…」） */
  message: string
}

/** runBriefingAgent 进度回调 */
export interface BriefingAgentCallbacks {
  /** 整体进度变化（阶段切换 / 步骤状态变化） */
  onProgress?: (progress: BriefingProgress) => void
}
