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
import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { setLocalStorageItem } from '@/features/storage-health'
import { useWeatherStore } from '@/features/weather'
import { omitRenderedScreenshot, renderedScreenshotDataUrl } from '@/features/rendered-screenshot'
import { REACH_REPORT_GUIDE, reachEnabled } from '@/features/reach'
import { ASSISTANT_NAME } from './config'
import { llm } from './llm'
import { callTool, toolLabel, toolDetail, openAiTools, kbEnabled } from './tools'
import { classifyError, markSuccess, markUnreachable, probe as probeConnectivity, onRecover, useConnectivity } from './connectivity'
import {
  summarizeUiRenderResult,
  uiBlocksFromRenderResult,
  uiBlocksFromToolResult,
} from './generative-ui'
import {
  daypart,
  formatDate,
  formatTime,
  truncateHistory,
  cleanupEmptyAssistant,
  MAX_HISTORY_TOKENS,
} from './utils'
import type { ChatMessage, ChatUiBlock, ToolActivity, ToolApproval } from './types'
import type { FeedbackCategory, FeedbackStats } from './types'

/** agent 循环最大轮数，防止工具调用失控 */
const MAX_ROUNDS = 5

/**
 * 工具结果用于 UI 预览的截断长度。完整结果仍保存在 tool 消息里供模型消费，
 * 这里只截断挂在 activity 上的预览——activity 随消息一起被 useStorage 深监听持久化，
 * 若存完整结果（kb.search 一次可达数十 KB），多次工具调用会把 localStorage 撑爆。
 */
const RESULT_PREVIEW_MAX = 800
const KB_VISION_MAX_IMAGES = 3
const KB_VISION_MAX_BYTES = 5 * 1024 * 1024

function previewResultJson(result: unknown): string {
  const json = JSON.stringify(result)
  return json.length > RESULT_PREVIEW_MAX ? json.slice(0, RESULT_PREVIEW_MAX) + '\n…（已截断，完整结果已带入上下文）' : json
}

function appendUiBlocks(message: ChatMessage, blocks: ChatUiBlock[]): void {
  if (!blocks.length) return
  message.ui = [...(message.ui ?? []), ...blocks]
}

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

function isKbSearchTool(wireName: string): boolean {
  return wireName === 'kb__search'
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

async function kbVisionContextFromResult(wireName: string, result: unknown, signal: AbortSignal): Promise<ChatMessage | null> {
  if (!isKbSearchTool(wireName)) return null
  const hits = Array.isArray((result as { results?: unknown[] })?.results)
    ? (result as { results: KbVisionHit[] }).results
    : []
  const imageHits = hits
    .filter((h) => h?.sourceType === 'image' && h.assetUrl)
    .slice(0, KB_VISION_MAX_IMAGES)
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

async function modaoVisionContextFromResult(wireName: string, result: unknown): Promise<ChatMessage | null> {
  if (wireName !== 'modao__read') return null
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
  wireName: string,
  result: unknown,
  signal: AbortSignal,
): Promise<ChatMessage | null> {
  return (
    await modaoVisionContextFromResult(wireName, result) ||
    await kbVisionContextFromResult(wireName, result, signal)
  )
}

function hasWireTool(wireName: string): boolean {
  return openAiTools.some((t) => t.function.name === wireName)
}

function kbHitsFromResult(result: unknown): KbVisionHit[] {
  return Array.isArray((result as { results?: unknown[] })?.results)
    ? (result as { results: KbVisionHit[] }).results
    : []
}

function isConfidentKbHit(hit: KbVisionHit): boolean {
  return hit.confidence === 'high' || hit.confidence === 'medium'
}

async function ambientKbContextFromUser(text: string, signal: AbortSignal): Promise<ChatMessage | null> {
  const query = text.trim()
  if (!query || !kbEnabled || !hasWireTool('kb__search')) return null

  let result: unknown
  try {
    result = await callTool('kb__search', { query, top_k: 4 }, signal)
  } catch {
    return null
  }

  const hits = kbHitsFromResult(result).filter(isConfidentKbHit).slice(0, 4)
  if (!hits.length) return null

  const imageContext = await kbVisionContextFromResult('kb__search', { results: hits }, signal)
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
      '下面是用用户原话进行知识库检索后得到的高置信候选。请只在它们确实相关时使用；如果使用，请标明来源。若它们与用户问题无关，可以忽略。',
      ...sources,
      imageContext ? imageContext.content : '',
    ].filter(Boolean).join('\n'),
    images: imageContext?.images,
  }
}

type ApprovalPolicy = Omit<ToolApproval, 'args'>

const APPROVAL_TOOL_LABELS: Record<string, string> = {
  git__checkout: '切换 Git 分支',
  git__fetch: 'Fetch 远端',
  git__pull: 'Pull 远端',
  git__push: 'Push 到远端',
  git__add: '暂存 Git 文件',
  git__commit: '创建 Git 提交',
  git__branch: '管理 Git 分支',
  local__create: '新建本地待办',
  local__update: '修改本地待办',
  local__complete: '变更本地待办完成状态',
  local__delete: '删除本地待办',
  wbscf__launch: '启动本地 dev 服务',
  claude__launch: '启动 Claude Code',
}

function approvalPolicy(wireName: string, args: Record<string, unknown>): ApprovalPolicy | null {
  const label = APPROVAL_TOOL_LABELS[wireName]
  if (!label) return null

  if (wireName.startsWith('git__')) {
    return {
      title: label,
      description: '这会改变 wbscf-web 仓库状态或远端同步状态。',
      risk: '执行前请确认当前分支、未提交改动、远端方向和提交内容都符合预期。',
    }
  }
  if (wireName === 'local__delete') {
    return {
      title: label,
      description: `将删除本地待办 ${args.id ? `#${String(args.id)}` : ''}，并清理其附件。`,
      risk: '删除不可恢复，请确认这不是误删。',
    }
  }
  if (wireName.startsWith('local__')) {
    return {
      title: label,
      description: '这会写入浏览器本地待办数据。',
      risk: '确认后会立即更新本地清单。',
    }
  }
  if (wireName === 'wbscf__launch') {
    return {
      title: label,
      description: `将启动 ${args.app ? String(args.app) : '指定'} 子应用的本地 dev 服务。`,
      risk: '可能拉起新的本地进程并占用端口；TodayOps 退出时会尝试清理由它拉起的服务。',
    }
  }
  if (wireName === 'claude__launch') {
    return {
      title: label,
      description: '将在 wbscf-web 根目录打开新的终端窗口并启动 Claude Code。',
      risk: '新终端由用户自行管理，TodayOps 不会自动关闭该窗口。',
    }
  }
  return {
    title: label,
    description: '该动作会改变本地或外部状态。',
    risk: '请确认后再执行。',
  }
}

function pendingApprovalResult(wireName: string, approval: ToolApproval) {
  return {
    approvalRequired: true,
    tool: wireName,
    title: approval.title,
    description: approval.description,
    risk: approval.risk,
    args: approval.args,
    note: '该动作需要用户在界面确认后才会执行；当前尚未执行。',
  }
}

const FEEDBACK_CATEGORIES: { key: FeedbackCategory; label: string }[] = [
  { key: 'briefing', label: '晨报' },
  { key: 'task-planning', label: '任务排序' },
  { key: 'git', label: 'Git' },
  { key: 'kb', label: '知识库' },
  { key: 'weather', label: '天气' },
  { key: 'local-task', label: '本地待办' },
  { key: 'zentao', label: '禅道' },
  { key: 'vision', label: '图片理解' },
  { key: 'general', label: '通用' },
]

function emptyCategoryStats() {
  return { up: 0, down: 0, regenerations: 0 }
}

function defaultFeedbackStats(): FeedbackStats {
  return { up: 0, down: 0, regenerations: 0, byCategory: {} }
}

function normalizeFeedbackStats(v: FeedbackStats): FeedbackStats {
  if (!v.byCategory) v.byCategory = {}
  for (const cat of FEEDBACK_CATEGORIES) {
    v.byCategory[cat.key] = { ...emptyCategoryStats(), ...(v.byCategory[cat.key] ?? {}) }
  }
  return v
}

function categoryLabel(cat?: FeedbackCategory): string {
  return FEEDBACK_CATEGORIES.find((c) => c.key === cat)?.label || '通用'
}

function incCategory(stats: FeedbackStats, cat: FeedbackCategory, key: keyof ReturnType<typeof emptyCategoryStats>, delta: number) {
  const cur = stats.byCategory[cat] ?? emptyCategoryStats()
  cur[key] = Math.max(0, cur[key] + delta)
  stats.byCategory[cat] = cur
}

function classifyAssistantMessage(history: ChatMessage[], assistant: ChatMessage): FeedbackCategory {
  const recent = history.slice(-8)
  const text = [...recent, assistant]
    .map((m) => [m.content, ...(m.activities?.map((a) => `${a.name} ${a.label} ${a.detail || ''}`) ?? [])].join('\n'))
    .join('\n')
    .toLowerCase()

  if (/今日简报|晨报|briefing/.test(text)) return 'briefing'
  if (/接手模式|今天最该|处理顺序|任务排序|小吴已就绪|逾期|临期|停滞|安排今天/.test(text)) return 'task-planning'
  if (/git|commit|branch|checkout|pull|push|diff|blame|reflog|stash|tag/.test(text)) return 'git'
  if (/知识库|kb|文档|环境地址|部署流程|kb__search/.test(text)) return 'kb'
  if (/天气|气温|下雨|带伞|穿衣|weather/.test(text)) return 'weather'
  if (/本地待办|local__|记一下|提醒我|待办/.test(text)) return 'local-task'
  if (/禅道|zentao|任务详情|bug/.test(text)) return 'zentao'
  if (/图片|截图|视觉|image_url|看图/.test(text) || recent.some((m) => m.images?.length)) return 'vision'
  return 'general'
}

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

  // 能力是否存在直接看已注册工具集（openAiTools），不再靠关键词猜测——
  // 工具全量喂给模型，由模型自行决定何时调用，避免「手写触发词」这种脆弱且易漏的匹配。
  const wireNames = openAiTools.map((t) => t.function.name) // 形如 weather__current
  const has = (prefix: string) => wireNames.some((n) => n.startsWith(prefix + '__'))

  if (has('weather')) {
    lines.push('- 天气：实时天气、未来 3/7/10/15 天预报、逐小时预报、分钟级降水、生活指数（穿衣/运动/紫外线等）。')
  }
  if (has('zentao')) {
    lines.push('- 禅道（只读查看，无法新建或修改）：我的任务列表与详情、我的 Bug 列表与详情。')
  }
  // 知识库按真实配置门控（未配置来源时不暴露 kb.search）
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

/**
 * 静态 system prompt（会话内不变，供 DeepSeek prompt caching 命中）。
 * 知识库相关条款仅在 kbEnabled 时拼入——未配置 VITE_KB_SOURCE 时 kb.search 工具
 * 不会下发给模型，prompt 也不得引导它去调用一个不存在的工具或宣称该能力。
 */
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
      '- 涉及项目内部信息或个人知识库事实时，优先基于 kb.search 或系统自动补充的 RAG 候选证据回答，绝不凭记忆编造；回答中尽量标明来源文档/章节。若检索证据低置信或为空，要如实说明知识库未覆盖。若知识库命中图片且系统随后补充了图片上下文，你可以直接看图回答，不要再要求用户手动上传同一张图。',
    )
  }
  lines.push(
    '- 用户说「记一下」「提醒我」「加个待办：…」等要落一条待办时，用 local.create 创建本地待办；查看/完成/修改同理调用对应工具。删除任务（local.delete）前先向用户确认。',
    '- Git 查询类请求（状态、日志、diff、blame、搜索、贡献者、配置）可以直接调用工具；任何会改变仓库状态的 Git 操作（checkout / pull / push / add / commit / branch 等）必须先用 git.status 看清当前分支、同步状态与未提交变更，再用一句话复述将执行的动作和影响，获得用户明确确认后再执行。',
    '- 用户只是讨论方案、让你评估风险、生成提交信息或解释 diff 时，不等于授权执行 Git 写操作；分支名、远端、文件列表、提交信息、force/amend 意图不明确时先追问。涉及删除、强制、覆盖历史或脏工作区下 pull/checkout 的风险动作，必须额外提醒风险并二次确认。',
    '- 用户问「项目迭代」「迭代原型」「墨刀里有什么」等时，直接调用 modao.read，不要追问链接；只有用户明确给了另一条墨刀链接时才把该链接传给工具。普通需求基于项目、页面树、targetScreen 和 rendered 文案总结。若用户明确要求看 UI 截图预览、视觉稿、页面布局、按钮位置或截图内容，调用 modao.read 时设置 includeScreenshot=true，系统会把截图作为图片上下文补给你；这时可以基于图片本身回答。',
    '- 用户没指明地点/日期时，用下方「当前上下文」里的默认城市与当前日期补全，直接执行，不要反问。',
    '- 工具返回的数据若为空或报错，如实说明，并给出下一步建议，不要假装有数据。',
    `- 天气、禅道列表、Bug、本地待办、Git 状态、本地服务${kbEnabled ? '、知识库检索' : ''}等工具结果会由前端自动生成 UI 卡片；这类场景不要再额外调用 ui.render，只需用短文本补充结论。只有没有现成工具卡片、且确实需要自定义清单/表格/步骤/指标时，才调用 ui.render。不要输出 Vue/JSX/HTML 代码。`,
    '- 用户可能发送图片（截图 / 照片）。你能看图：分析报错截图、识别白板或照片里的文字（必要时据此用 local.create 落成待办）。回答时先简述你从图里看到的关键信息，再给判断或行动。',
    '- 当用户消息要求进入「接手模式」或包含结构化工作项上下文时，不要只泛泛回答；必须先解释为什么优先处理，再给今天的处理步骤，最后列出可继续接手的动作选项。任何写操作仍需先确认。',
  )
  if (reachEnabled) {
    lines.push(
      '- 外部调研只在用户明确要求"查/搜/调研/读链接/分析 GitHub 仓库/总结视频/最近有什么变化"等公开互联网信息时使用；不要后台自动抓取社媒或使用登录态平台。调研回答必须列出来源链接；视频工具若只返回元数据或提示缺少字幕，要明确说明限制，不要假装看完完整视频。',
      `- 外部调研报告规则：${REACH_REPORT_GUIDE}`,
    )
  }
  if (kbEnabled) {
    lines.push(
      '',
      '# 知识库调用时机',
      '判断原则：当问题的答案更可能存在于用户自己的资料、团队内部文档、历史记录、文件内容或知识库图片中，而不是通用世界知识或其它实时工具时，优先查知识库或使用系统自动补充的 RAG 候选证据。若候选证据与问题相关，就基于证据回答并标明来源；若不相关或置信不足，就忽略它，不要强行引用。',
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
    lines.push('- 「帮我调研 X / 这个 GitHub 仓库能不能引进 / 总结这个视频」→ reach.search / reach.read_url / reach.github_repo / reach.video_summary 收集外部证据，再给结论、关键发现、对本项目的影响和来源。')
  }
  if (kbEnabled) {
    lines.push('- 「这个 bug 怎么定位」→ 先 zentao.bug_detail 拿详情，再 kb.search 查相关流程/说明，综合给思路。')
  }
  lines.push(
    '- 「带伞吗 / 穿什么」→ weather.current（不够再 weather.forecast_daily / life_indices），结合当前上下文给一句贴心建议。',
    '',
    '# 回答风格',
    '- 简体中文，口吻自然亲切、简洁不啰嗦，像一位靠谱的同事。',
    '- 善用生成式 UI 与 Markdown：已有 UI 卡片时，文字只补结论、取舍理由和下一步，避免重复罗列卡片内容。',
    '- 数据型回答先给结论/概览，再列细节；天气可适当加一句贴心提示（如带伞、添衣）。',
    '- 不要暴露工具名、接口、字段等技术细节，用户只关心结果。',
  )
  return lines.join('\n')
}

const STATIC_SYSTEM_PROMPT = buildStaticSystemPrompt()

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

/** 读取持久化的对话历史（不含图片——图片 data URL 不进 localStorage，见 messages 注释） */
function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem('hao123-chat-history')
    return raw ? (JSON.parse(raw) as ChatMessage[]) : []
  } catch {
    console.warn('[chat] 历史记录解析失败，已重置')
    return []
  }
}

export const useChatStore = defineStore('chat', () => {
  const open = ref(false)
  // 对话历史（user/assistant/tool；不含 system）。不再用 useStorage 默认持久化——
  // user 消息可能带图片 data URL（多模态输入），base64 体积过大会撑爆 localStorage。
  // 这里自定义持久化：内存中完整持有（供 agent loop 多轮 + 当前会话回显），写入前剥离 images。
  const messages = ref<ChatMessage[]>(loadHistory())
  watch(
    messages,
    (val) => {
      const slim = val.map((m) => (m.images?.length ? { ...m, images: undefined } : m))
      setLocalStorageItem('hao123-chat-history', JSON.stringify(slim))
    },
    { deep: true },
  )
  const streaming = ref(false)
  const error = ref<string | null>(null)
  /** 未读提示：面板关闭时收到新回复，圆钮上显示小红点 */
  const unread = ref(false)
  /** 反馈统计（持久化，用于质量追踪） */
  const feedbackStats = useStorage<FeedbackStats>(
    'hao123-chat-feedback',
    defaultFeedbackStats(),
  )
  feedbackStats.value = normalizeFeedbackStats(feedbackStats.value)

  const configured = computed(() => llm.configured)
  const hasMessages = computed(() =>
    messages.value.some((m) => m.role === 'user' || m.role === 'assistant' || !!m.ui?.length),
  )
  const feedbackCategoryRows = computed(() =>
    FEEDBACK_CATEGORIES
      .map((cat) => {
        const stats = feedbackStats.value.byCategory[cat.key] ?? emptyCategoryStats()
        return {
          key: cat.key,
          label: cat.label,
          up: stats.up,
          down: stats.down,
          regenerations: stats.regenerations,
          total: stats.up + stats.down + stats.regenerations,
        }
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.down + b.regenerations - (a.down + a.regenerations) || b.total - a.total),
  )

  let abortController: AbortController | null = null

  // 连通性状态（组件可通过 store 读取；store 自身在 send() 里据此短路）
  const connectivity = useConnectivity()
  const connectivityStatus = connectivity.status

  // 连通恢复时：若对话末尾是用户消息（断网期间发出的提问未得到答复），自动重跑 agent 循环
  onRecover(() => {
    if (streaming.value) return
    const tail = messages.value[messages.value.length - 1]
    if (tail?.role === 'user') void runAgentLoop()
  })

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
    if (!msg.qualityCategory) {
      msg.qualityCategory = classifyAssistantMessage(messages.value.slice(0, messageIndex), msg)
    }
    const cat = msg.qualityCategory || 'general'

    // 撤销之前的反馈（如果有）
    if (msg.feedback === 'up') {
      feedbackStats.value.up--
      incCategory(feedbackStats.value, cat, 'up', -1)
    }
    if (msg.feedback === 'down') {
      feedbackStats.value.down--
      incCategory(feedbackStats.value, cat, 'down', -1)
    }

    // 设置新反馈（点击同一按钮则取消）
    if (msg.feedback === rating) {
      msg.feedback = undefined
    } else {
      msg.feedback = rating
      if (rating === 'up') {
        feedbackStats.value.up++
        incCategory(feedbackStats.value, cat, 'up', 1)
      }
      if (rating === 'down') {
        feedbackStats.value.down++
        incCategory(feedbackStats.value, cat, 'down', 1)
      }
    }
  }

  /**
   * 跑一轮 agent 循环（基于当前 messages 末尾的上下文）。
   * 调用前应已 push 好用户消息（或已截断到要重答的位置）。
   */
  async function runAgentLoop(extraHiddenContexts: ChatMessage[] = []) {
    abortController?.abort()
    const controller = new AbortController()
    abortController = controller
    const signal = controller.signal

    error.value = null
    streaming.value = true

    // 工具全量下发给模型，由模型自行决定是否调用、调用哪个——
    // 不再做关键词意图筛选（脆弱且易漏）：现代模型的 function-calling 路由已足够可靠，
    // 全量工具的 token 开销也远小于一次误判带来的多轮往返。
    const toolsForThisTurn = openAiTools
    const toolsWithoutUiRender = toolsForThisTurn.filter((t) => t.function.name !== 'ui__render')
    let autoUiGenerated = false
    const hiddenContexts: ChatMessage[] = [...extraHiddenContexts]
    const latestUser = [...messages.value].reverse().find((m) => m.role === 'user')
    const ambientKbContext = await ambientKbContextFromUser(latestUser?.content || '', signal)
    if (ambientKbContext) hiddenContexts.push(ambientKbContext)

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        // 每轮新建一个 assistant 占位消息；改「数组里的响应式代理」以驱动流式重渲染
        const idx = messages.value.push({ role: 'assistant', content: '', ts: Date.now() }) - 1
        const assistant = messages.value[idx]

        const { toolCalls } = await llm.chatStream({
          messages: buildApiMessages([...messages.value.slice(0, -1), ...hiddenContexts]),
          signal,
          tools: autoUiGenerated ? toolsWithoutUiRender : toolsForThisTurn,
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
        if (!toolCalls.length) {
          assistant.qualityCategory = classifyAssistantMessage(messages.value.slice(0, idx), assistant)
          break
        }

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
          startTime: Date.now(),
          expanded: false,
        }))

        // 并行执行所有工具调用
        const activities = assistant.activities!
        const visionContexts: Array<ChatMessage | null> = []
        const results = await Promise.all(
          toolCalls.map(async (call, i) => {
            const activity = activities[i] as ToolActivity
            const args = parsedArgs[i]
            if (args.__parseError) {
              activity.status = 'error'
              activity.endTime = Date.now()
              activity.duration = activity.endTime - activity.startTime!
              return `工具参数解析失败，原始内容: ${String(args.raw || '').slice(0, 200)}`
            }
            let result: unknown
            try {
              const policy = approvalPolicy(call.function.name, args)
              if (policy) {
                const approval: ToolApproval = { ...policy, args }
                result = pendingApprovalResult(call.function.name, approval)
                activity.status = 'pending'
                activity.approval = approval
              } else {
                result = await callTool(call.function.name, args, signal)
                activity.status = (result as { error?: unknown })?.error ? 'error' : 'done'
              }
              const rawResult = result
              const renderedBlocks = uiBlocksFromRenderResult(rawResult)
              if (renderedBlocks.length) {
                appendUiBlocks(assistant, renderedBlocks)
                result = summarizeUiRenderResult(rawResult)
              } else {
                const autoBlocks = uiBlocksFromToolResult(call.function.name, rawResult)
                appendUiBlocks(assistant, autoBlocks)
                if (autoBlocks.length) autoUiGenerated = true
              }
              const messageResult = omitRenderedScreenshot(result)
              activity.result = previewResultJson(messageResult)
              visionContexts[i] = await visionContextFromToolResult(call.function.name, rawResult, signal)
              result = messageResult
            } catch (e) {
              result = { error: (e as Error)?.message || '工具执行失败' }
              activity.status = 'error'
              activity.result = previewResultJson(result)
              visionContexts[i] = null
            }
            // 记录结束时间和耗时
            activity.endTime = Date.now()
            activity.duration = activity.endTime - activity.startTime!
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
        hiddenContexts.push(...visionContexts.filter((m): m is ChatMessage => !!m))
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
          qualityCategory: 'general',
        })
      }
      // 整轮顺利完成 → 通知连通性层「现在可达」，触发 ambient 模块恢复续生成
      markSuccess()
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        // 中止也要清理当前轮留下的「空 assistant 占位」（content 为空且无 tool_calls），
        // 否则它会被持久化到 localStorage，下一轮 buildApiMessages 把空 content 的
        // assistant 喂给模型，DeepSeek/OpenAI 会以 400「content must be non-empty」拒绝。
        cleanupEmptyAssistant(messages.value)
        return
      }
      // 网络类错误归连通性层（琥珀条 / Launcher 色点 / 自动重试），不污染 store.error 红条；
      // 非网络错误（解析失败、工具异常等）才走红条。
      const reason = classifyError(e)
      if (reason) {
        markUnreachable(reason)
      } else {
        error.value = (e as Error)?.message || '对话出错了，请稍后重试'
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

  /**
   * 发送一条用户消息并跑完 agent 循环。
   * @param images 可选的图片 data URL（多模态输入）；纯文字时可空。带图时跳过本地意图分类。
   */
  async function send(text: string, images: string[] = []) {
    const content = text.trim()
    if (streaming.value) return
    if (!content && !images.length) return

    // 轻量意图分类：仅纯文字、且命中明确句式时本地直答，省一次 LLM 调用（带图不走）
    const localIntent = images.length ? null : detectLocalIntent(content)
    if (localIntent) {
      messages.value.push({ role: 'user', content, ts: Date.now() })
      messages.value.push({ role: 'assistant', content: localIntent.answer, ts: Date.now(), qualityCategory: 'general' })
      return
    }

    messages.value.push({
      role: 'user',
      content,
      images: images.length ? images : undefined,
      ts: Date.now(),
    })

    // 已知连不上时先快速 probe（5s 超时），避免用户白等 fetchWithRetry 的 1+2+4s 退避；
    // probe 成功 → 正常跑；仍不通 → 不调用 runAgentLoop（auto-retry 恢复后 onRecover 会自动续答）
    if (connectivityStatus.value === 'unreachable') {
      const ok = await probeConnectivity()
      if (!ok) return
    }
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
    const lastAssistant = messages.value
      .slice(lastUser + 1)
      .reverse()
      .find((m) => m.role === 'assistant' && m.content)
    const regenCategory = lastAssistant?.qualityCategory || 'general'
    messages.value = messages.value.slice(0, lastUser + 1)
    feedbackStats.value.regenerations++
    incCategory(feedbackStats.value, regenCategory, 'regenerations', 1)
    await runAgentLoop()
  }

  /**
   * 重试单个失败的工具调用。
   * 成功后用新结果替换对应 tool 消息，截断其后的旧答复并重跑 agent 循环，
   * 让模型基于新结果重新作答（否则可见的助手回答仍是失败时的旧文本）。
   * @param messageIndex 消息索引
   * @param activityIndex 活动索引
   */
  async function retryTool(messageIndex: number, activityIndex: number) {
    if (streaming.value) return
    const msg = messages.value[messageIndex]
    if (!msg || !msg.activities || !msg.tool_calls) return

    const activity = msg.activities[activityIndex]
    const toolCall = msg.tool_calls[activityIndex]
    if (!activity || !toolCall) return

    // 重置活动状态
    activity.status = 'running'
    activity.startTime = Date.now()
    activity.endTime = undefined
    activity.duration = undefined
    activity.result = undefined

    // 参数解析单独处理，给出准确的「参数解析失败」语义（而非混入「工具执行失败」）
    let args: Record<string, unknown>
    try {
      args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {}
    } catch {
      activity.status = 'error'
      activity.result = previewResultJson({ error: '工具参数解析失败，原始内容已不可用' })
      activity.endTime = Date.now()
      activity.duration = activity.endTime - activity.startTime!
      return
    }

    // 单独重跑一个工具：起一个临时 AbortController，让用户「停止」也能中断长任务（如 wbscf.launch）
    abortController?.abort()
    const retryController = new AbortController()
    abortController = retryController

    let result: unknown
    try {
      result = await callTool(toolCall.function.name, args, retryController.signal)
      activity.status = (result as { error?: unknown })?.error ? 'error' : 'done'
      const rawResult = result
      const renderedBlocks = uiBlocksFromRenderResult(rawResult)
      if (renderedBlocks.length) {
        appendUiBlocks(msg, renderedBlocks)
        result = summarizeUiRenderResult(rawResult)
      } else {
        appendUiBlocks(msg, uiBlocksFromToolResult(toolCall.function.name, rawResult))
      }
      const visionContext = await visionContextFromToolResult(toolCall.function.name, rawResult, retryController.signal)
      result = omitRenderedScreenshot(result)
      activity.result = previewResultJson(result)
      activity.endTime = Date.now()
      activity.duration = activity.endTime - activity.startTime!

      // await 期间用户可能已发起新对话；此时放弃后续重跑，避免与进行中的循环抢改消息
      if (streaming.value) return
      if (activity.status !== 'done') return

      // 用新结果更新对应的 tool 消息
      let toolMsgIndex = -1
      for (let i = messageIndex + 1; i < messages.value.length; i++) {
        if (messages.value[i].role === 'tool' && messages.value[i].tool_call_id === toolCall.id) {
          messages.value[i].content = JSON.stringify(result)
          toolMsgIndex = i
          break
        }
      }
      if (toolMsgIndex < 0) return

      // 截断到「本条 assistant 发起的连续 tool 消息」末尾（多工具并行也安全），
      // 丢弃其后基于失败结果生成的旧答复，再重跑让模型重新作答。
      let lastToolIdx = toolMsgIndex
      for (let i = toolMsgIndex + 1; i < messages.value.length; i++) {
        if (messages.value[i].role === 'tool') lastToolIdx = i
        else break
      }
      messages.value = messages.value.slice(0, lastToolIdx + 1)
      await runAgentLoop(visionContext ? [visionContext] : [])
    } catch (e) {
      result = { error: (e as Error)?.message || '工具执行失败' }
      activity.status = 'error'
      activity.result = previewResultJson(result)
      activity.endTime = Date.now()
      activity.duration = activity.endTime - activity.startTime!
    }
  }

  function findToolMessageIndex(toolCallId: string, after: number): number {
    for (let i = after + 1; i < messages.value.length; i++) {
      if (messages.value[i].role === 'tool' && messages.value[i].tool_call_id === toolCallId) return i
    }
    return -1
  }

  function truncateAfterToolResult(toolMsgIndex: number): void {
    let lastToolIdx = toolMsgIndex
    for (let i = toolMsgIndex + 1; i < messages.value.length; i++) {
      if (messages.value[i].role === 'tool') lastToolIdx = i
      else break
    }
    messages.value = messages.value.slice(0, lastToolIdx + 1)
  }

  /** 用户确认 pending approval 后，才真正执行工具并把真实结果回灌给模型 */
  async function approveTool(messageIndex: number, activityIndex: number) {
    if (streaming.value) return
    const msg = messages.value[messageIndex]
    if (!msg?.activities || !msg.tool_calls) return
    const activity = msg.activities[activityIndex]
    const toolCall = msg.tool_calls[activityIndex]
    if (!activity?.approval || !toolCall || activity.status !== 'pending') return

    let args: Record<string, unknown>
    try {
      args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {}
    } catch {
      activity.status = 'error'
      activity.result = previewResultJson({ error: '工具参数解析失败，无法执行审批动作' })
      return
    }

    activity.approval.decision = 'approved'
    activity.approval.decidedAt = Date.now()
    activity.status = 'running'
    activity.startTime = Date.now()
    activity.endTime = undefined
    activity.duration = undefined
    activity.result = undefined

    abortController?.abort()
    const approvalController = new AbortController()
    abortController = approvalController
    streaming.value = true

    let result: unknown
    let visionContext: ChatMessage | null = null
    try {
      result = await callTool(toolCall.function.name, args, approvalController.signal)
      activity.status = (result as { error?: unknown })?.error ? 'error' : 'done'
      const rawResult = result
      const renderedBlocks = uiBlocksFromRenderResult(rawResult)
      if (renderedBlocks.length) {
        appendUiBlocks(msg, renderedBlocks)
        result = summarizeUiRenderResult(rawResult)
      } else {
        appendUiBlocks(msg, uiBlocksFromToolResult(toolCall.function.name, rawResult))
      }
      visionContext = await visionContextFromToolResult(toolCall.function.name, rawResult, approvalController.signal)
      result = omitRenderedScreenshot(result)
      activity.result = previewResultJson(result)
    } catch (e) {
      result = { error: (e as Error)?.message || '工具执行失败' }
      activity.status = 'error'
      activity.result = previewResultJson(result)
    } finally {
      activity.endTime = Date.now()
      activity.duration = activity.endTime - activity.startTime!
      if (abortController === approvalController) abortController = null
      streaming.value = false
    }

    const toolMsgIndex = findToolMessageIndex(toolCall.id, messageIndex)
    if (toolMsgIndex < 0) return
    messages.value[toolMsgIndex].content = JSON.stringify(result)

    truncateAfterToolResult(toolMsgIndex)
    await runAgentLoop(visionContext ? [visionContext] : [])
  }

  /** 用户拒绝 pending approval：不执行工具，只把拒绝结果回灌给模型 */
  async function rejectTool(messageIndex: number, activityIndex: number) {
    if (streaming.value) return
    const msg = messages.value[messageIndex]
    if (!msg?.activities || !msg.tool_calls) return
    const activity = msg.activities[activityIndex]
    const toolCall = msg.tool_calls[activityIndex]
    if (!activity?.approval || !toolCall || activity.status !== 'pending') return

    activity.approval.decision = 'rejected'
    activity.approval.decidedAt = Date.now()
    activity.status = 'error'
    activity.endTime = Date.now()
    activity.duration = activity.startTime ? activity.endTime - activity.startTime : undefined

    const result = {
      approvalRejected: true,
      tool: toolCall.function.name,
      title: activity.approval.title,
      note: '用户拒绝执行该动作；工具未执行。',
    }
    activity.result = previewResultJson(result)

    const toolMsgIndex = findToolMessageIndex(toolCall.id, messageIndex)
    if (toolMsgIndex < 0) return
    messages.value[toolMsgIndex].content = JSON.stringify(result)
    truncateAfterToolResult(toolMsgIndex)
    await runAgentLoop()
  }

  /**
   * 切换工具活动详情展开/收起
   */
  function toggleActivityExpand(messageIndex: number, activityIndex: number) {
    const msg = messages.value[messageIndex]
    if (!msg?.activities?.[activityIndex]) return
    msg.activities[activityIndex].expanded = !msg.activities[activityIndex].expanded
  }

  /**
   * 手动重试连通性（连通性横条「重试」按钮调用）。
   * 立即 probe 一次（跳过自动重试的退避）；恢复后若末尾是未答复的用户消息则自动续答。
   */
  async function retryConnection() {
    const ok = await probeConnectivity()
    if (!ok) return
    if (streaming.value) return
    const tail = messages.value[messages.value.length - 1]
    if (tail?.role === 'user') await runAgentLoop()
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
    feedbackCategoryRows,
    categoryLabel,
    toggle,
    show,
    close,
    clear,
    stop,
    send,
    regenerate,
    rate,
    retryTool,
    approveTool,
    rejectTool,
    toggleActivityExpand,
    retryConnection,
  }
})
