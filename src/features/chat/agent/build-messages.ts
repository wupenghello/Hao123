/**
 * Chat 助手 · agent 消息组装
 *
 * 把 Turn（产品概念）压平为发给模型的 OpenAI 消息序列：
 *   system（静态）→ system（动态上下文）→ 截断后的历史 turns → few-shot →
 *   user（本次，带图）→ 每步 assistant(tool_calls) + tool → answer。
 *
 * 从旧 store.ts 搬迁并做 Turn 化：
 *  - buildStaticSystemPrompt / buildCapabilitiesFromTools / dynamicContextMessage
 *  - truncateHistory / estimateTokens / estimateMessageTokens（原 utils.ts）
 *  - clipForModel / trimLongStrings（工具结果回灌体积控制）
 *  - buildHiddenContextsForUser：RAG 候选证据 + 视觉补充上下文
 *  - buildToolOutcome：工具执行 → 回灌内容 + UI 卡
 *
 * 系统提示词约束（替代旧的「JSON 泄漏抑制」渲染兜底，见方案 2.5）：
 * 工具返回的原始 JSON 是内部素材，绝不整段贴进回答正文。
 */
import { useWeatherStore } from '@/features/weather'
import { omitRenderedScreenshot, renderedScreenshotDataUrl } from '@/features/rendered-screenshot'
import { REACH_REPORT_GUIDE, reachEnabled } from '@/features/reach'
import { getActiveConfig } from '@/features/model-config'
import type { ChatMessage } from '../types'
import type { Turn, ToolStep } from '../turns'
import { ASSISTANT_NAME } from '../config'
import { getChatSettings } from '../settings'
import { openAiTools, kbEnabled, callTool } from '../tools'
import { daypart, formatDate, formatTime } from '../utils'
import { uiBlocksFromRenderResult, uiBlocksFromToolResult, summarizeUiRenderResult } from '../generative-ui'
import type { ChatUiBlock } from '../ui-types'

// ============ 历史截断（原 utils.ts 搬迁） ============

/** 粗略估算文本 token 数（CJK 1.5 / ASCII 0.25 + JSON 开销） */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++
    } else {
      other++
    }
  }
  const base = Math.ceil(cjk * 1.5 + other * 0.25)
  const jsonOverhead = (text.match(/[{}\[\]":,]/g) || []).length * 0.5
  return Math.ceil(base + jsonOverhead)
}

/** 估算单条消息 token（含 tool_calls / 图片） */
export function estimateMessageTokens(msg: ChatMessage): number {
  let tokens = estimateTokens(msg.content || '') + 4
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      tokens += estimateTokens(tc.function.name + tc.function.arguments) + 10
    }
  }
  if (msg.images?.length) tokens += msg.images.length * 1500
  return tokens
}

/**
 * 截断历史到 token 预算。保留最近对话，从最早开始丢；不拆散 assistant+tool 关联；
 * 断点后无 user 则保留尾部 2 条；清理孤立 tool 消息；首条非 user 补占位。
 */
export function truncateHistory(history: ChatMessage[], budget: number): ChatMessage[] {
  if (!history.length) return history
  let total = 0
  for (let i = history.length - 1; i >= 0; i--) {
    total += estimateMessageTokens(history[i])
    if (total > budget) {
      let start = i + 1
      while (start < history.length && history[start].role !== 'user') start++
      const result = start >= history.length ? history.slice(-2) : history.slice(start)
      const validIds = new Set<string>()
      for (const msg of result) {
        if (msg.role === 'assistant' && msg.tool_calls) {
          for (const tc of msg.tool_calls) validIds.add(tc.id)
        }
      }
      const cleaned = result.filter((msg) => {
        if (msg.role === 'tool' && msg.tool_call_id && !validIds.has(msg.tool_call_id)) return false
        return true
      })
      if (cleaned.length && cleaned[0].role !== 'user') {
        cleaned.unshift({ role: 'user', content: '（继续）' })
      }
      return cleaned
    }
  }
  return history
}

// ============ System prompt（静态 + 动态） ============

/** 从已注册工具自动生成能力描述（新增/删除工具时 prompt 自动同步） */
function buildCapabilitiesFromTools(): string[] {
  const lines: string[] = []
  const wireNames = openAiTools.map((t) => t.function.name)
  const has = (prefix: string) => wireNames.some((n) => n.startsWith(prefix + '__'))

  if (has('weather')) {
    lines.push('- 天气：实时天气、未来 3/7/10/15 天预报、逐小时预报、分钟级降水、生活指数（穿衣/运动/紫外线等）。')
  }
  if (has('zentao')) {
    lines.push('- 禅道（只读查看，无法新建或修改）：我的任务列表与详情、我的 Bug 列表与详情。')
  }
  if (kbEnabled) {
    lines.push('- 项目 / 个人 RAG 知识库：检索开发/测试/预发/生产各环境域名、部署流程、个人笔记、人名事实、常见问答等内部文档，并可查看知识库健康状态、来源引用与解析警告。')
  }
  if (has('local')) {
    lines.push('- 本地待办（可增删改查）：查看 / 新建 / 修改 / 完成 / 删除用户手动创建的待办任务，可带图片与文件附件。')
  }
  if (has('wbscf')) {
    lines.push('- wbscf-web 本地 dev 服务：查询账号中心 / 买家中心 / 卖家中心 / 运营管理 / ERP 各本地 dev 服务的端口、地址与运行状态（在跑 / 启动中 / 未启动）；并可启动某个服务，与用户在状态栏点击「localhost」走同一条启动路径（已在运行则不重复拉起）。')
  }
  if (has('git')) {
    lines.push('- Git 仓库：查看 wbscf-web 的分支、同步状态、变更、提交日志、责任追溯与配置；可在用户确认后执行 checkout / fetch / pull / push / add / commit / branch 等受控操作。')
  }
  if (has('claude')) {
    lines.push('- Claude Code CLI：查询启动功能可用性，并可在wbscf-web代码库根目录下新开独立终端窗口启动Claude Code，与用户点击状态栏「Claude」按钮效果完全一致。')
  }
  if (has('modao')) {
    lines.push('- 墨刀项目迭代原型：默认读取 .env 中 VITE_MODAO_PROJECT_URL 配置的原型，无需用户重复提供地址；可提取项目、目标页面、页面树、可见文案与按钮文本，用于理解需求、拆开发任务、整理验收点。')
  }
  if (has('webdoc')) {
    lines.push('- 公开文档链接读取：当禅道任务/Bug 详情或用户消息里包含外部文档、Wiki、PRD 链接时，可尝试读取网页的静态标题、正文与链接；墨刀原型链接优先使用专门的 modao.read。')
  }
  if (has('reach')) {
    lines.push('- 外部调研：在用户明确要求查外部资料、调研公开信息、阅读网页链接、分析 GitHub 仓库或总结 YouTube/B站视频时，可搜索公开互联网、读取 Jina Reader 正文、拉取 GitHub 仓库元信息/README/近期 issue，并读取公开视频字幕或元数据。')
  }
  if (has('ui')) {
    lines.push('- 生成式 UI：可在聊天窗口渲染白名单 Vue 卡片（天气、清单、表格、指标、状态、时间线、来源等），用于替代长段 Markdown 表格或纯文字堆叠。')
  }
  return lines
}

/** 静态 system prompt（会话内不变，命中 prompt caching） */
function buildStaticSystemPrompt(): string {
  const lines: string[] = [
    `你是「${ASSISTANT_NAME}」，嵌在 TodayOps 个人工作台里的智能助理。`,
    '',
    '# 你的能力',
    ...buildCapabilitiesFromTools(),
    '',
    '# 工作方式',
    '- 涉及天气或禅道数据时，必须先调用对应工具拿到真实数据再回答，绝不凭空编造数字或结论。',
  ]
  if (kbEnabled) {
    lines.push(
      '- 涉及项目内部信息或个人知识库事实时，优先基于 kb.search 或系统自动补充的 RAG 候选证据回答，绝不凭记忆编造；回答中尽量标明来源文档/章节。若用户明确要求查知识库但检索证据低置信或为空，要如实说明知识库未覆盖；若只是系统自动补充的候选与问题无关，请静默忽略，不要在最终回答里特意说明“知识库内容无关/已忽略”。若知识库命中图片且系统随后补充了图片上下文，你可以直接看图回答，不要再要求用户手动上传同一张图。',
    )
  }
  lines.push(
    '- 用户说「记一下」「提醒我」「加个待办：…」等要落一条待办时，用 local.create 创建本地待办；查看/完成/修改同理调用对应工具。删除任务（local.delete）前先向用户确认。',
    '- 任何会改变仓库状态的 Git 操作（checkout / pull / push / add / commit / branch 等）会先经 git.status 看清当前分支、同步状态与未提交变更，再直接调用对应工具——系统会在界面弹出审批卡，用户确认后才真正执行，因此不要先向用户要口头确认（避免双重确认）。调用前若分支、远端、文件列表、提交信息、force/amend 意图不明确，先追问；涉及删除、强制、覆盖历史或脏工作区下 pull/checkout 的风险动作，在正文里额外提醒风险。',
    '- 用户只是讨论方案、让你评估风险、生成提交信息或解释 diff 时，不等于授权执行 Git 写操作，此时不要调用工具。',
    '- 用户问「项目迭代」「迭代原型」「墨刀里有什么」等时，直接调用 modao.read，不要追问链接；只有用户明确给了另一条墨刀链接时才把该链接传给工具。普通需求基于项目、页面树、targetScreen 和 rendered 文案总结。若用户明确要求看 UI 截图预览、视觉稿、页面布局、按钮位置或截图内容，调用 modao.read 时设置 includeScreenshot=true，系统会把截图作为图片上下文补给你；这时可以基于图片本身回答。',
    '- 用户没指明地点/日期时，用下方「当前上下文」里的默认城市与当前日期补全，直接执行，不要反问。',
    '- 工具返回的数据若为空或报错，如实说明，并给出下一步建议，不要假装有数据。',
    `- 天气、禅道列表、Bug、本地待办、Git 状态、本地服务${kbEnabled ? '、知识库检索' : ''}等工具结果会由前端自动生成 UI 卡片；这类场景不要再额外调用 ui.render，只需用短文本补充结论。只有没有现成工具卡片、且确实需要自定义清单/表格/步骤/指标时，才调用 ui.render。不要输出 Vue/JSX/HTML 代码。`,
    '- 用户可能发送图片（截图 / 照片）。你能看图：分析报错截图、识别白板或照片里的文字（必要时据此用 local.create 落成待办）。回答时先简述你从图里看到的关键信息，再给判断或行动。',
    '- 当用户消息要求进入「接手模式」或包含结构化工作项上下文时，不要只泛泛回答；必须先解释为什么优先处理，再给今天的处理步骤，最后列出可继续接手的动作选项。任何写操作仍需先确认。',
    // ★ 替代旧的「JSON 泄漏抑制」渲染兜底：工具原始 JSON 是内部素材，绝不整段进正文
    '- 工具返回的 JSON 是内部素材，绝不整段贴进回答正文，也不要用 JSON 代码块展示；一律用自己的话整理成自然语言。',
  )
  if (reachEnabled) {
    lines.push(
      '- 外部调研只在用户明确要求"查/搜/调研/读链接/分析 GitHub 仓库/总结视频/最近有什么变化"等公开互联网信息时使用；不要后台自动抓取社媒或使用登录态平台。调研回答必须列出来源链接；视频工具若只返回元数据或提示缺少字幕，要明确说明限制，不要假装看完完整视频。',
      `- 外部调研报告规则：${REACH_REPORT_GUIDE}`,
      '- 回答「对本项目的影响」时，必须结合下方「当前上下文」里的「项目画像」（技术栈 / 阶段 / 约束）；若未提供项目画像，给出通用的引入评估维度（兼容性 / 体积 / 维护风险）即可，不要凭空编造本项目的细节。',
    )
  }
  if (kbEnabled) {
    lines.push(
      '',
      '# 知识库调用时机',
      '判断原则：当问题的答案更可能存在于用户自己的资料、团队内部文档、历史记录、文件内容或知识库图片中，而不是通用世界知识或其它实时工具时，优先查知识库或使用系统自动补充的 RAG 候选证据。若候选证据与问题相关，就基于证据回答并标明来源；若不相关或置信不足，就静默忽略它，不要强行引用，也不要把“知识库无关/已忽略”写进最终回答。只有用户明确要求查知识库或问知识库覆盖情况时，才说明未覆盖或低置信。',
      '组合场景：Bug/任务定位、发布部署、环境配置、文件内容解释、个人笔记事实等问题，经常需要把禅道/Git/图片理解与知识库证据合并判断。',
    )
  }
  lines.push(
    '',
    '# 组合规划（你的核心价值）',
    `你有天气 / 禅道任务 / 禅道 Bug${kbEnabled ? ' / 知识库' : ''} / 本地待办等多类工具。面对开放性、规划类问题，不要只调一个工具就草草作答——要把相关工具放在一起掂量，先收集全貌再综合给建议。多个互相独立的查询，尽量在同一轮并行发起（一次多个 tool_calls），减少往返、加快回答。`,
    '典型串联：',
    '- 「今天怎么安排 / 我先做什么好」→ 并行 zentao.my_tasks + zentao.my_bugs + local.list（必要时加 weather.current），再按紧急·逾期·今天截止排出优先级与节奏。',
    '- 「这周还有啥没做完 / 我手头多少事」→ 并行 zentao.my_tasks + zentao.my_bugs + local.list，归类汇总，点名最该跟进的。',
  )
  if (reachEnabled) {
    lines.push(
      '- 「帮我调研 X / 这个 GitHub 仓库能不能引进 / 总结这个视频」→ reach.search / reach.read_url / reach.github_repo / reach.video_summary 收集外部证据，再给结论、关键发现、对本项目的影响和来源。',
      '- 「对比 X 和 Y / 选哪个库 / 选型」→ 并行多个 reach.github_repo（或 reach.search）收集证据，再用 ui.render 的 data-table 卡输出对比矩阵（维度 × 候选），文字给出推荐、关键依据和取舍理由，不要只留一句结论。',
    )
  }
  if (kbEnabled) {
    lines.push('- 「这个 bug 怎么定位」→ 先 zentao.bug_detail 拿详情，再 kb.search 查相关流程/说明，综合给思路。')
  }
  lines.push(
    '- 「带伞吗 / 穿什么」→ weather.current（不够再 weather.forecast_daily / life_indices），结合当前上下文给一句贴心建议。',
    '',
    '# 回答风格',
    '- 简体中文，口吻自然亲切、简洁不啰嗦，像一位靠谱的同事。',
    '- 工具返回的数据（JSON / 字段名 / 原始结构）是内部素材，绝不原样贴进回答，也不要用 JSON 或代码块形式展示；一律用自己的话整理成自然语言（列表 / 表格 / 短句），工具结果会由前端自动生成卡片。',
    '- 遇到需要用户确认的操作时，工具会返回 approvalRequired。此时只能说明“我已准备好，等你确认”，不要说动作已经完成；用户确认或取消后，会收到新的工具结果，再继续给结论。',
    '- 用户拒绝了一个动作（工具结果含 approvalRejected）时，不要重复尝试或追问“确定不执行吗”，直接接受结果：简要说明该动作未执行，给出替代方案或下一步建议（例如把提交信息整理好等用户自己执行）。',
    '- 善用生成式 UI 与 Markdown：卡片是速览，正文要能让用户不点开卡片也读懂论据。涉及外部调研、网页读取、知识库检索等带来源的回答，正文应分层呈现：先给结论，再用自己的话复述查到的关键观点和依据（可引用原文要点，不要只丢一句结论），最后给出处。不要因为信息已进卡片就把过程省成干瘪总结。',
    '- 数据型回答先给结论/概览，再列细节；天气可适当加一句贴心提示（如带伞、添衣）。',
    '- 不要暴露工具名、接口、字段等技术细节，用户只关心结果。',
  )
  return lines.join('\n')
}

const STATIC_SYSTEM_PROMPT = buildStaticSystemPrompt()

/** 动态上下文消息（每轮刷新：时间 + 城市；独立 system 消息，不影响静态前缀缓存） */
function dynamicContextMessage(): ChatMessage {
  const now = new Date()
  const dateStr = formatDate(now)
  const timeStr = formatTime(now)
  const dp = daypart(now.getHours())
  const weather = useWeatherStore()
  const city = weather.cityName || '北京'
  const lines = [
    '# 当前上下文（实时刷新）',
    `- 现在是 ${dateStr} ${timeStr}（${dp}）。用户说「今天 / 现在 / 明天 / 几点」等，一律以此为基准，不要使用训练数据里的旧时间。`,
    `- 用户默认所在城市：${city}。用户问天气、空气、穿衣等却没指明城市时，直接默认查询「${city}」，不要反问「哪里」。`,
  ]
  if (reachEnabled) {
    const profile = import.meta.env.VITE_PROJECT_PROFILE?.trim()
    if (profile) {
      lines.push(`- 项目画像：${profile}。回答外部调研的「对本项目的影响」时以此为基准。`)
    }
  }
  return { role: 'system', content: lines.join('\n') }
}

// ============ 工具结果回灌体积控制（原 store.ts 搬迁） ============

const TOOL_RESULT_FIELD_MAX = 4_000
const TOOL_RESULT_MAX_CHARS = 16_000

/** 递归裁剪超长字符串字段（保持结构，输出仍是合法 JSON） */
function trimLongStrings(value: unknown, max: number): unknown {
  if (typeof value === 'string') {
    return value.length > max ? value.slice(0, max) + `…（已截断 ${value.length - max} 字符）` : value
  }
  if (Array.isArray(value)) return value.map((v) => trimLongStrings(v, max))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = trimLongStrings(v, max)
    return out
  }
  return value
}

/** 工具按类型给不同单字段上限（git diff 不裁剪；reach.read_url 走可配置上限） */
function fieldMaxFor(toolName?: string): number {
  if (toolName === 'reach__read_url') {
    const cfg = getChatSettings().readUrlMaxChars
    return cfg > 0 ? cfg : Number.MAX_SAFE_INTEGER
  }
  return TOOL_RESULT_FIELD_MAX
}

/** 回灌给模型的工具结果体积控制：裁剪超长字段 + 整体兜底，保证合法 JSON */
export function clipForModel(result: unknown, toolName?: string): string {
  if (toolName === 'git__show' || toolName === 'git__diff') {
    return JSON.stringify(result)
  }
  const trimmed = trimLongStrings(result, fieldMaxFor(toolName))
  const json = JSON.stringify(trimmed)
  if (json.length <= TOOL_RESULT_MAX_CHARS) return json
  return JSON.stringify({
    error: '工具结果体积过大，已整体跳过',
    detail: `序列化后 ${json.length} 字符，超过 ${TOOL_RESULT_MAX_CHARS} 上限。请缩小查询范围或换更具体的来源。`,
    preview: json.slice(0, 2000),
  })
}

// ============ RAG 候选证据 + 视觉补充上下文 ============

const KB_VISION_MAX_BYTES = 5 * 1024 * 1024
const KB_VISION_MAX_IMAGES = 3

interface KbVisionHit {
  doc?: string
  docTitle?: string
  section?: string
  sourceType?: string
  assetUrl?: string
  mimeType?: string
  confidence?: 'high' | 'medium' | 'low'
  score?: number
  matchedTerms?: string[]
  highlights?: string[]
  content?: string
  citation?: { label?: string; path?: string }
  metadata?: { path?: string; mimeType?: string }
}

function hasWireTool(wireName: string): boolean {
  return openAiTools.some((t) => t.function.name === wireName)
}

function absolutizeAssetUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  return new URL(url, window.location.origin).toString()
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

async function assetToDataUrl(url: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(absolutizeAssetUrl(url), { signal })
  if (!res.ok) return null
  const blob = await res.blob()
  if (!blob.type.startsWith('image/') || blob.size > KB_VISION_MAX_BYTES) return null
  return blobToDataUrl(blob)
}

async function kbVisionContextFromResult(result: unknown, signal: AbortSignal): Promise<ChatMessage | null> {
  const hits = Array.isArray((result as { results?: unknown[] })?.results)
    ? (result as { results: KbVisionHit[] }).results
    : []
  const imageHits = hits.filter((h) => h?.sourceType === 'image' && h.assetUrl).slice(0, KB_VISION_MAX_IMAGES)
  if (!imageHits.length) return null
  const images: string[] = []
  const labels: string[] = []
  for (const hit of imageHits) {
    if (!hit.assetUrl) continue
    try {
      const dataUrl = await assetToDataUrl(hit.assetUrl, signal)
      if (!dataUrl) continue
      images.push(dataUrl)
      labels.push(hit.citation?.label || hit.metadata?.path || hit.docTitle || hit.doc || '知识库图片')
    } catch {
      // 单张图片失败不影响其它图片或工具结果
    }
  }
  if (!images.length) return null
  return {
    role: 'user',
    content: [
      '以下图片来自刚才的知识库检索结果，请直接查看图片内容来回答用户上一问。',
      '不要因为知识库缺少 OCR/摘要就要求用户重新上传；如果图片内容足够清楚，请基于图片本身说明。',
      `图片来源：${labels.join('；')}`,
    ].join('\n'),
    images,
  }
}

interface ModaoScreenshotResult {
  title?: string
  url?: string
  finalUrl?: string
  project?: { name?: string }
  targetScreen?: { id?: string; name?: string; path?: string[] }
  rendered?: {
    finalUrl?: string
    screenshotDataUrl?: string
    visibleText?: string
    currentCanvasText?: string
    buttonTexts?: string[]
  }
}

async function modaoVisionContextFromResult(result: unknown): Promise<ChatMessage | null> {
  const image = renderedScreenshotDataUrl(result)
  if (!image) return null
  const data = result as ModaoScreenshotResult
  const screen = data.targetScreen?.name || data.targetScreen?.id || '项目概览'
  const project = data.project?.name || data.title || '墨刀原型'
  return {
    role: 'user',
    content: [
      '以下图片是刚才 modao.read 工具返回的墨刀 UI 截图预览。',
      '用户明确要求看 UI 截图预览或视觉布局时，请直接基于这张图判断；同时结合工具返回的页面树、文案、按钮和画布元信息。',
      `项目：${project}`,
      `页面：${screen}`,
      data.targetScreen?.path?.length ? `路径：${data.targetScreen.path.join(' / ')}` : '',
      data.rendered?.finalUrl || data.finalUrl || data.url ? `渲染 URL：${data.rendered?.finalUrl || data.finalUrl || data.url}` : '',
    ].filter(Boolean).join('\n'),
    images: [image],
  }
}

async function visionContextFromToolResult(
  tool: string,
  result: unknown,
  signal: AbortSignal,
): Promise<ChatMessage | null> {
  if (tool === 'modao__read') return modaoVisionContextFromResult(result)
  if (tool === 'kb__search') return kbVisionContextFromResult(result, signal)
  return null
}

function isConfidentKbHit(hit: KbVisionHit): boolean {
  return hit.confidence === 'high' || hit.confidence === 'medium'
}

/** RAG 候选证据：用用户原话检索知识库，高置信命中注入为 user 消息（附图片上下文） */
async function ambientKbContextFromUser(text: string, signal: AbortSignal): Promise<ChatMessage | null> {
  const query = text.trim()
  if (!query || !kbEnabled || !hasWireTool('kb__search')) return null
  let result: unknown
  try {
    result = await callTool('kb__search', { query, top_k: 4 }, signal)
  } catch {
    return null
  }
  const hits = Array.isArray((result as { results?: unknown[] })?.results)
    ? (result as { results: KbVisionHit[] }).results.filter(isConfidentKbHit).slice(0, 4)
    : []
  if (!hits.length) return null
  const imageContext = await kbVisionContextFromResult({ results: hits }, signal)
  const sources = hits.map((h, i) => {
    const source = h.citation?.label || h.metadata?.path || h.docTitle || h.doc || `结果 ${i + 1}`
    const confidence = h.confidence || 'unknown'
    const highlights = h.highlights?.length ? `\n  摘要：${h.highlights.join(' / ')}` : ''
    const content = h.content ? `\n  内容：${h.content.slice(0, 600)}` : ''
    return `${i + 1}. ${source}（${confidence}，score=${h.score ?? 'n/a'}）${highlights}${content}`
  })
  return {
    role: 'user',
    content: [
      '（系统自动补充的 RAG 候选证据）',
      '下面是用用户原话进行知识库检索后得到的高置信候选。请只在它们确实相关时使用；如果使用，请标明来源。若它们与用户问题无关，请静默忽略，不要在最终回答里提到"知识库内容无关"或"已忽略知识库"。',
      ...sources,
      imageContext ? imageContext.content : '',
    ].filter(Boolean).join('\n'),
    images: imageContext?.images,
  }
}

// ============ Turn → 消息序列 ============

/** 把一步工具调用压平成 assistant(tool_calls) + tool 两条协议消息 */
function flattenStep(step: ToolStep): ChatMessage[] {
  const call: ChatMessage['tool_calls'] = [
    {
      id: step.callId,
      type: 'function',
      function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) },
    },
  ]
  return [
    { role: 'assistant', content: '', tool_calls: call },
    { role: 'tool', tool_call_id: step.callId, content: step.result ?? '' },
  ]
}

/** 组装发给模型的完整消息序列（含动态上下文 / 截断 / few-shot / RAG / 视觉） */
export async function buildApiMessages(
  turn: Turn,
  opts: { fewShotSystem: ChatMessage | null },
): Promise<ChatMessage[]> {
  // 历史 = 当前 turn 已完成的部分（steps + 已产出的 answer），由调用方并入历史 turns
  const history: ChatMessage[] = []
  for (const step of turn.steps) history.push(...flattenStep(step))
  if (turn.answer) {
    history.push({ role: 'assistant', content: turn.answer })
  }

  const truncated = truncateHistory(history, getChatSettings().maxHistoryTokens)
  const wasTruncated = truncated.length < history.length
  const contextNote: ChatMessage[] = wasTruncated
    ? [{ role: 'system', content: '（提示：早期对话因长度已省略，请基于当前上下文回答。若用户引用了早期内容，请礼貌说明已不在上下文中。）' }]
    : []

  const userMsg: ChatMessage = {
    role: 'user',
    content: turn.userContent,
    ...(turn.images?.length ? { images: turn.images } : {}),
  }

  return [
    { role: 'system', content: STATIC_SYSTEM_PROMPT },
    dynamicContextMessage(),
    ...contextNote,
    ...(opts.fewShotSystem ? [opts.fewShotSystem] : []),
    ...truncated,
    ...(turn.hiddenContexts ?? []),
    userMsg,
  ]
}

/**
 * 引擎每轮前：准备隐藏上下文（RAG 候选证据 + 视觉补充）。
 */
export async function buildHiddenContextsForUser(
  userText: string,
  toolResults: { tool: string; raw: unknown }[],
  signal: AbortSignal,
): Promise<ChatMessage[]> {
  const out: ChatMessage[] = []
  const ambientKb = await ambientKbContextFromUser(userText, signal)
  if (ambientKb) out.push(ambientKb)
  for (const tr of toolResults) {
    const vision = await visionContextFromToolResult(tr.tool, tr.raw, signal)
    if (vision) out.push(vision)
  }
  return out
}

/** 工具执行后：渲染 UI 卡并裁剪回灌结果（旧 store 的 uiBlocksFromToolResult 编排） */
export interface ToolExecutionOutcome {
  /** 回灌给模型的 tool 消息内容 */
  fedBack: string
  /** 追加到 turn.uiBlocks 的 UI 卡（steps 内的自动卡由调用方决定挂载位置） */
  uiBlocks: ChatUiBlock[]
  /** 供视觉上下文的原始结果（未裁剪） */
  raw: unknown
}

/** 执行一个工具并产出回灌内容 + UI 卡（逻辑与旧 store 完全一致） */
export function buildToolOutcome(tool: string, result: unknown): ToolExecutionOutcome {
  const raw = result
  const uiBlocks: ChatUiBlock[] = []
  let fedBack: unknown = result
  const renderedBlocks = uiBlocksFromRenderResult(raw)
  if (renderedBlocks.length) {
    uiBlocks.push(...renderedBlocks)
    fedBack = summarizeUiRenderResult(raw)
  } else {
    const autoBlocks = uiBlocksFromToolResult(tool, raw)
    if (autoBlocks.length) uiBlocks.push(...autoBlocks)
  }
  fedBack = omitRenderedScreenshot(fedBack)
  return { fedBack: clipForModel(fedBack, tool), uiBlocks, raw }
}

// 供 few-shot 检索使用当前激活模型
export function currentModelName(): string {
  return getActiveConfig().model
}
