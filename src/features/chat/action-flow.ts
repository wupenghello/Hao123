/**
 * Chat 助手 · 行动流提示词
 *
 * 这些 prompt 用在首页的主动 AI 入口：风险徽标、状态条、洞察卡、晨报深聊。
 * 目标不是「打开聊天随便问一句」，而是让小吴进入接手模式：
 * 先解释优先级，再给今天的处理方案，最后明确列出可继续执行的动作。
 */

export interface ActionFlowItem {
  key: string
  kind: string
  id: string
  title: string
  source: string
  priority?: string
  status?: string
  deadline?: string
  thread?: string
  meta?: string
  riskLabel?: string
  riskWhy?: string
}

export interface ActionFlowSummary {
  total: number
  urgentCount: number
  overdue: number
  dueSoon: number
  stalled: number
  headline?: string
}

export interface ActionFlowInsight {
  title: string
  detail?: string
  action?: string
}

function linesOfItem(it: ActionFlowItem): string {
  return [
    `- key：${it.key}`,
    `- 来源：${it.source}`,
    `- 类型：${it.kind}`,
    `- ID：${it.id}`,
    `- 标题：${it.title}`,
    it.priority && `- 优先级：${it.priority}`,
    it.status && `- 状态：${it.status}`,
    it.deadline && `- 截止日期：${it.deadline}`,
    it.thread && `- 需求线：${it.thread}`,
    it.meta && `- 补充信息：${it.meta}`,
    it.riskLabel && `- 风险：${it.riskLabel}`,
    it.riskWhy && `- 风险理由：${it.riskWhy}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function takeoverRules(extra = ''): string {
  return [
    '请进入「接手模式」，不要只给泛泛建议。',
    '输出必须包含四段：',
    '1. **为什么先处理它**：用数据解释优先级，明确引用风险、优先级、截止日、状态或需求线。',
    '2. **今天怎么处理**：给一个可执行的 2~4 步方案，按先后顺序写。',
    '3. **我可以继续接手**：列出 3~5 个下一步动作，必须包含适用项：生成同步话术、拆成本地跟进待办、查看/补充详情、检索知识库。',
    '4. **需要你确认的事**：如果下一步会新建/修改/删除待办或执行 Git 等写操作，先问确认，不要直接做。',
    '涉及禅道任务/Bug时，如现有信息不足，先调用详情工具补齐；涉及内部流程或模块说明时，先检索知识库。',
    extra,
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildInboxItemActionFlowPrompt(item: ActionFlowItem): string {
  return [
    '我点了收件箱里的一条风险工作项，请你直接接手。',
    '',
    '# 工作项上下文',
    linesOfItem(item),
    '',
    '# 接手要求',
    takeoverRules('如果它是禅道项，可以先查看详情；如果它是本地待办，围绕完成路径和跟进拆解来处理。'),
  ].join('\n')
}

export function buildInboxPlanActionFlowPrompt(summary: ActionFlowSummary, items: ActionFlowItem[]): string {
  const itemLines = items.length
    ? items.map((it, i) => `## ${i + 1}. ${it.title}\n${linesOfItem(it)}`).join('\n\n')
    : '当前没有可列出的工作项。'

  return [
    '我点了「小吴已就绪」，请你接手今天的工作编排。',
    '',
    '# 收件箱概况',
    `- 工作项总数：${summary.total}`,
    `- 紧急项：${summary.urgentCount}`,
    `- 逾期：${summary.overdue}`,
    `- 临期：${summary.dueSoon}`,
    `- 停滞：${summary.stalled}`,
    summary.headline && `- 当前判断：${summary.headline}`,
    '',
    '# 排名前列工作项',
    itemLines,
    '',
    '# 接手要求',
    [
      '请先排出今天的处理顺序，只列最值得先动的 3~5 项。',
      '每项说明：为什么排在这里、今天具体做到哪一步、需要我确认什么。',
      '最后给一个上午/下午/收尾的节奏建议。',
      '如果需要更准确判断，可以并行查询禅道任务、Bug、本地待办或天气工具。',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildInsightActionFlowPrompt(insight: ActionFlowInsight, items: ActionFlowItem[] = []): string {
  const itemLines = items.length
    ? items.map((it, i) => `## 相关项 ${i + 1}. ${it.title}\n${linesOfItem(it)}`).join('\n\n')
    : '当前没有额外的相关项上下文。'

  return [
    '我点了「小吴的洞察」，请你把这条洞察接成一个行动流。',
    '',
    '# 洞察',
    `- 标题：${insight.title}`,
    insight.detail && `- 细节：${insight.detail}`,
    insight.action && `- 原始建议：${insight.action}`,
    '',
    '# 相关工作项',
    itemLines,
    '',
    '# 接手要求',
    takeoverRules('请先判断这条洞察背后的根因或模式，再给今天如何拆解处理。'),
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildBriefingActionFlowPrompt(content: string): string {
  return [
    '我看完了今日简报，请你不要只是继续聊天，而是把简报接成今天的行动流。',
    '',
    '# 今日简报正文',
    content || '（当前没有简报正文）',
    '',
    '# 接手要求',
    [
      '请先提炼今天最该先抓的 1 件事。',
      '然后给出今天的处理顺序，按「先处理 / 顺手推进 / 可以推迟」分组。',
      '最后给出你可以继续接手的动作选项：生成同步话术、拆本地跟进待办、查知识库、查看禅道详情。',
      '任何会写入本地待办或改变外部状态的动作，都先问我确认。',
    ].join('\n'),
  ].join('\n')
}
