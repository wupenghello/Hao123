/**
 * 洞察（Insights）模块 · 数据类型
 *
 * 把首页「统一收件箱」的预测 / 洞察逻辑收拢为一个自包含特性模块，与天气 / 禅道 / 本地待办
 * 同构。核心产物是「对工作项的风险预测」——纯启发式（不依赖 LLM），故而即时、确定、始终可用，
 * 即便 DeepSeek 未配置，首页也能体现「小吴在主动评估你的工作」。
 *
 * 设计要点：
 *  - 预测引擎只认归一化的 {@link WorkItem}，与禅道 / 本地待办的具体类型解耦（见 composable 的映射）；
 *  - 每条预测必带一句 {@link Prediction.why}——不可解释的预测等于噪音，会透支信任（产品红线）。
 */

/** 工作项来源（与统一收件箱口径一致） */
export type WorkKind = 'task' | 'bug' | 'local'

/**
 * 归一化的工作项——预测引擎只消费这个形状。
 * 由 composable 从禅道任务 / 禅道 Bug / 本地待办三类 store 映射而来。
 */
export interface WorkItem {
  id: string
  kind: WorkKind
  title: string
  /** 优先级 1~4（数字越小越高）；未知则按 4（最低）处理，避免误判为高优 */
  pri: number
  /** 原始状态码（task: wait/doing/...；bug: active/resolved/closed；local: done/wait） */
  status: string
  /** 截止日期 yyyy-MM-dd（禅道 0000-00-00 / 空视为无） */
  deadline?: string
  /** 创建时间 ms（停滞判定的基线之一） */
  openedAt?: number
  /** 最后变动时间 ms（优先于 openedAt 作为「最近活动」） */
  lastEditedAt?: number
  /** Bug 严重度 1~4（仅 bug） */
  severity?: number
  /** 所属「需求线」标签（storyTitle / projectName / productName，归一化用）；本地待办无线索 */
  thread?: string
}

/**
 * 风险等级（由强到弱：逾期 > 临期 > 停滞）。
 * 一条工作项至多命中一档（取最强的），避免一行叠多个徽标。
 */
export type RiskLevel = 'overdue' | 'due-soon' | 'stalled'

/** 单条工作项的风险预测 */
export interface Prediction {
  level: RiskLevel
  /** 行内徽标文案，如「逾期 3 天」「今天到期」「停滞 12 天」 */
  label: string
  /** 一句话理由（hover tooltip）——「为什么这么说」，可解释性红线 */
  why: string
  /** 建议的下一步，已写成用户口吻的请求；点「交给小吴」时作为消息直接发出 */
  action: string
}

/** 列表级洞察汇总：驱动首页「小吴已就绪」状态条 */
export interface InsightSummary {
  /** 逾期项数 */
  overdue: number
  /** 今明到期项数 */
  dueSoon: number
  /** 停滞项数 */
  stalled: number
  /** 有风险的工作项总数（一项只计最强那一档，去重） */
  total: number
  /** 最该先处理的一档（状态条点题用）；无风险则 null */
  top: RiskLevel | null
  /** 点题建议（如「有 2 项已逾期，建议先收尾」）；无风险则空串 */
  headline: string
}

// ============ 深度洞察（Step 3：模式 / 异常 / 归因，喂给「小吴的洞察」卡）============

/**
 * 洞察类型——确定性检测能识别的「值得主动一说」的模式。
 * 优先级（detectInsights 据此排序，仅取前两条以守住「克制」红线）：
 *  root-cause（同根因）> bug-concentration（Bug 集中）> overdue-cluster（多项逾期）
 *  > overload（负载）> stalled-key（高优停滞）
 */
export type InsightKind = 'root-cause' | 'bug-concentration' | 'overdue-cluster' | 'overload' | 'stalled-key'

/**
 * 一条深度洞察。检测是确定性的（可靠、即时、不烧 token），`title` / `detail` 即可直接展示；
 * LLM 可把 `detail` 加工成更自然的提醒 + 具体建议（见 chat/inbox-insight.ts）。
 */
export interface Insight {
  kind: InsightKind
  /** 一句话标题（检测模板可直接用） */
  title: string
  /** 展开素材（相关工作项等，喂给 LLM；无则为空） */
  detail: string
  /** 相关工作项 key（`${kind}-${id}`），供「让小吴展开」带上下文 */
  itemKeys: string[]
  /** 「让小吴展开」时发出的请求（用户口吻） */
  action: string
}

