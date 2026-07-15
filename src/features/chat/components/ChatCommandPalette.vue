<script setup lang="ts">
/**
 * 小吴 · 命令面板（Spotlight / Cmd+K 式中央对话）
 *
 * 全局快捷键 Alt+K（Mac ⌘K）召唤，从屏幕中央偏上缩放入场。LLM 是本应用的主功能，
 * 故采用「随叫随到、占据中央」的命令面板形态，而非角落挂件。
 *
 * 形态：半透明遮罩 + 居中卡片，对话流居上、底部为大输入框（经典对话布局）。
 * 能力：流式 Markdown 回复、工具调用过程可视、空态推荐、复制、重新生成、停止、清空。
 * 视觉语言对齐 DetailModal（navy→teal 玻璃、四角科技边框、流光顶条）。
 * 交互增强：右下角拖拽调整面板尺寸，自动记忆上次大小。
 */
import { ref, nextTick, watch, computed, onMounted, onUnmounted } from 'vue'
import { useChatStore } from '../store'
import { reachEnabled, summarizeReachResult } from '@/features/reach'
import { ASSISTANT_NAME } from '../config'
import { renderMarkdown } from '../markdown'
import { useStorage } from '@/composables/useStorage'
import { useChatSettings } from '../settings'
import { activeModel, activeProvider, configured as modelConfigured, hasUiConfig } from '@/features/model-config'
import GenerativeUiBlock from './GenerativeUiBlock.vue'
import ToolActivityRow from './ToolActivityRow.vue'
import ChatSettingsModal from './ChatSettingsModal.vue'
import { useConnectivity } from '../connectivity'
import { currentModelSupportsVision } from '../vision-models'
import type { ChatMessage, ToolActivity } from '../types'
import IconRobot from '~icons/mdi/robot-happy-outline'
import IconClose from '~icons/mdi/close'
import IconPlus from '~icons/mdi/plus'
import IconSend from '~icons/mdi/arrow-up'
import IconStop from '~icons/mdi/stop'
import IconBroom from '~icons/mdi/broom'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCheck from '~icons/mdi/check-circle'
import IconLoading from '~icons/mdi/loading'
import IconCopy from '~icons/mdi/content-copy'
import IconRefresh from '~icons/mdi/refresh'
import IconWeather from '~icons/mdi/weather-partly-cloudy'
import IconTask from '~icons/mdi/checkbox-marked-circle-outline'
import IconBug from '~icons/mdi/bug-outline'
import IconSearchWeb from '~icons/mdi/web'
import IconSpark from '~icons/mdi/star-four-points'
import IconClip from '~icons/mdi/clipboard-list-outline'
import IconThumbUp from '~icons/mdi/thumb-up-outline'
import IconThumbDown from '~icons/mdi/thumb-down-outline'
import IconThumbUpFill from '~icons/mdi/thumb-up'
import IconThumbDownFill from '~icons/mdi/thumb-down'
import IconQuote from '~icons/mdi/format-quote-close'
import IconCloseCircle from '~icons/mdi/close-circle'
import IconCog from '~icons/mdi/cog-outline'
import IconArrowDown from '~icons/mdi/arrow-down'
import IconFullscreen from '~icons/mdi/fullscreen'
import IconFullscreenExit from '~icons/mdi/fullscreen-exit'
import IconMessageText from '~icons/mdi/message-text-outline'
import IconTimeline from '~icons/mdi/timeline-clock-outline'
import IconViewDashboard from '~icons/mdi/view-dashboard-outline'
import IconPanelRight from '~icons/mdi/page-layout-sidebar-right'

const store = useChatStore()
const { settings } = useChatSettings()

const currentModelProvider = computed(() => activeProvider.value?.name?.trim() || '未命名 Provider')
const currentModelName = computed(() => activeModel.value || '未选择模型')
const currentModelLabel = computed(() => {
  if (!hasUiConfig.value) return '模型未配置'
  return `${currentModelProvider.value} / ${currentModelName.value}`
})
const currentModelTitle = computed(() => {
  if (!hasUiConfig.value) return '当前未配置模型'
  return `当前模型：${currentModelProvider.value} / ${currentModelName.value}${modelConfigured.value ? '' : '（等待配置）'}`
})

const input = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const copiedIdx = ref(-1)
const copyFailedIdx = ref(-1)
const showSettings = ref(false)
const confirmClear = ref(false)
const sessionMenuOpen = ref(false)

/** 双击会话项重命名（沉浸式侧栏） */
function renameSessionPrompt(id: string, title: string) {
  const next = window.prompt('重命名会话', title)
  if (next !== null) store.renameSession(id, next)
}

/** 删除会话前确认（避免误触丢失整段历史；与 clear() 二次确认同口径） */
function confirmDeleteSession(id: string, title: string) {
  const name = title && title !== '新的协作会话' ? `「${title}」` : '该会话'
  if (window.confirm(`确定删除${name}？整段对话历史不可恢复。`)) store.deleteSession(id)
}

/** 点击会话切换器外部关闭下拉 */
function onDocClick(e: MouseEvent) {
  if (!sessionMenuOpen.value) return
  if (!(e.target as HTMLElement)?.closest?.('.cmd-session-switcher-wrap')) sessionMenuOpen.value = false
}
const isImmersive = useStorage<boolean>('hao123-chat-immersive', false)
const immersiveSidebarOpen = useStorage<boolean>('hao123-chat-immersive-sidebar', true)
const activeComposerMode = ref<'ask' | 'plan' | 'write' | 'debug'>('ask')
const isAwayFromLatest = ref(false)
const hasNewContentWhileAway = ref(false)

const FOLLOW_BOTTOM_THRESHOLD = 88
let programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null
let isProgrammaticScroll = false

// ============ 上下文感知动态建议 ============
// 基于时间 + 当前浏览上下文动态生成引导问题，而非静态模板匹配。
// 放在输入框下方作为可点击的快捷按钮，不在输入框内部做幽灵补全。

function pickGreeting(): string {
  const h = new Date().getHours()
  if (h < 9) return '早上好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

interface ContextSuggestion {
  text: string
  icon: 'weather' | 'task' | 'bug' | 'local' | 'plan' | 'reach'
}

/** 响应式当前小时：让 contextSuggestions 能随时间推移自动刷新建议。
 *  每分钟检查一次，仅在小时变化时更新（避免无意义的重渲染）。 */
const currentHour = ref(new Date().getHours())
let hourTimer: ReturnType<typeof setInterval> | null = null

/** 生成上下文感知的快捷提问：基于时间、当前页面等信息。 */
const contextSuggestions = computed<ContextSuggestion[]>(() => {
  const h = currentHour.value
  const items: ContextSuggestion[] = []

  // 早上 → 倾向问今日安排
  if (h < 11) {
    items.push({ text: '今天有哪些事需要处理？', icon: 'plan' })
    items.push({ text: '今天天气怎么样，需要带伞吗？', icon: 'weather' })
  } else if (h < 14) {
    // 午后 → 关注进度
    items.push({ text: '手头还有哪些没做完的？', icon: 'task' })
    items.push({ text: '下午有什么需要优先处理的？', icon: 'plan' })
  } else {
    // 傍晚 → 回顾 + 收尾
    items.push({ text: '今天还有遗漏的事吗？', icon: 'plan' })
    items.push({ text: '明天有什么需要提前准备的？', icon: 'task' })
  }

  // 始终提供快捷入口
  items.push({ text: '帮我记一条待办', icon: 'local' })

  // 外部调研可用时多给一条
  if (reachEnabled) {
    items.push({ text: '帮我查一下最新技术动态', icon: 'reach' })
  }

  return items.slice(0, 4)
})

const composerModes = [
  { key: 'ask', label: '问答', placeholder: '直接跟我说就好…' },
  { key: 'plan', label: '规划', placeholder: '说目标，我来拆步骤和优先级…' },
  { key: 'write', label: '写作', placeholder: '给我材料，我来整理成可用文本…' },
  { key: 'debug', label: '排查', placeholder: '描述现象、报错或代码位置…' },
] as const

const contextChips = computed(() => [
  { key: 'dashboard', label: '工作台', prompt: '结合当前工作台上下文，帮我判断现在最该先处理什么。' },
  { key: 'zentao', label: '禅道', prompt: '帮我看一下禅道里指派给我的任务和 Bug，排一下处理顺序。' },
  { key: 'local', label: '待办', prompt: '帮我梳理本地待办，找出今天应该先完成的事项。' },
  { key: 'weather', label: '天气', prompt: '结合今天的天气，提醒我是否会影响通勤或外出安排。' },
  ...(reachEnabled ? [{ key: 'reach', label: '调研', prompt: '帮我做一次外部信息调研，并给出可执行结论。' }] : []),
])

const activeModePlaceholder = computed(() => {
  return composerModes.find((m) => m.key === activeComposerMode.value)?.placeholder ?? '直接跟我说就好…'
})

const conversationTitle = computed(() => {
  const firstUser = store.messages.find((m) => m.role === 'user' && m.content.trim())
  const raw = firstUser?.content.replace(/\s+/g, ' ').trim()
  if (!raw) return '新的协作会话'
  return raw.length > 28 ? raw.slice(0, 28) + '…' : raw
})

const conversationStats = computed(() => {
  const user = store.messages.filter((m) => m.role === 'user').length
  const assistant = store.messages.filter((m) => m.role === 'assistant' && (m.content || m.activities?.length || m.ui?.length)).length
  const activities = store.messages.flatMap((m) => m.activities ?? [])
  const running = activities.filter((a) => a.status === 'running').length
  const pending = activities.filter((a) => a.status === 'pending').length
  const done = activities.filter((a) => a.status === 'done').length
  const error = activities.filter((a) => a.status === 'error').length
  return { user, assistant, total: user + assistant, activities: activities.length, running, pending, done, error }
})

const recentActivities = computed(() => {
  return store.messages
    .flatMap((m) => m.activities ?? [])
    .slice(-7)
    .reverse()
})

/** 跨会话最近 3 条 user 提问（空态「最近提问」快捷重问） */
const recentUserMessages = computed(() => {
  const all: string[] = []
  for (const s of store.sessions) {
    for (const m of s.messages) {
      if (m.role === 'user' && m.content.trim()) all.push(m.content.replace(/\s+/g, ' ').trim())
    }
  }
  return all.slice(-3).reverse()
})

/** 把上一条 user 消息回填输入框（错误后「换个问法」） */
function refillLastUser() {
  for (let i = store.messages.length - 1; i >= 0; i--) {
    if (store.messages[i].role === 'user' && store.messages[i].content.trim()) {
      input.value = store.messages[i].content
      store.error = null
      nextTick(() => { autoGrow(); inputEl.value?.focus() })
      return
    }
  }
}

const activeToolSummary = computed(() => {
  const stats = conversationStats.value
  if (stats.running) return `${stats.running} 个工具执行中`
  if (stats.pending) return `${stats.pending} 个操作待确认`
  if (stats.error) return `${stats.error} 个工具异常`
  if (stats.activities) return `${stats.done}/${stats.activities} 个工具完成`
  return '暂未调用工具'
})

function suggestionIconFor(kind: ContextSuggestion['icon']) {
  return kind === 'weather' ? IconWeather
    : kind === 'task' ? IconTask
    : kind === 'bug' ? IconBug
    : kind === 'local' ? IconClip
    : kind === 'reach' ? IconSearchWeb
    : IconSpark
}

// ============ 引用回复相关 ============
/** 当前引用的消息索引（null 表示无引用） */
const quoteMessageIdx = ref<number | null>(null)

/** 开始引用某条消息 */
function startQuote(idx: number) {
  quoteMessageIdx.value = idx
  nextTick(() => {
    inputEl.value?.focus()
  })
}

/** 取消引用 */
function cancelQuote() {
  quoteMessageIdx.value = null
}

/** 获取被引用的消息文本预览 */
function getQuotePreview(idx: number): string {
  const msg = store.messages[idx]
  if (!msg) return ''
  const preview = msg.content.slice(0, 60)
  return preview.length < msg.content.length ? preview + '...' : preview
}

/** 获取被引用消息的角色显示 */
function getQuoteRole(idx: number): string {
  const msg = store.messages[idx]
  if (!msg) return ''
  return msg.role === 'user' ? '我' : ASSISTANT_NAME
}

/** 构建带引用前缀的发送文本 */
function buildQuoteText(): string {
  if (quoteMessageIdx.value === null) return ''
  const msg = store.messages[quoteMessageIdx.value]
  if (!msg) return ''
  return `> 引用【${getQuoteRole(quoteMessageIdx.value)}】：\n${getQuotePreview(quoteMessageIdx.value)}\n\n`
}

/** 格式化消息时间戳 */
function formatMessageTime(ts: number | undefined): string {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ============ 图片输入（多模态）============
/** 单张图片上限 5MB（base64 进 HTTP 请求，过大慢且贵）；数量上限由对话参数控制 */
const MAX_CHAT_IMAGE_SIZE = 5 * 1024 * 1024
/** 待发送的图片（data URL，发送时随消息一起发给视觉模型） */
interface PendingImage { id: string; url: string; name: string }
const pendingImages = ref<PendingImage[]>([])
/** 大图预览（点用户消息缩略图 / 待发送缩略图展开） */
const previewImage = ref<string | null>(null)
const isDraggingImage = ref(false)
const imageError = ref('')
let imageErrorTimer: ReturnType<typeof setTimeout> | null = null
function flashImageError(msg: string) {
  imageError.value = msg
  if (imageErrorTimer) clearTimeout(imageErrorTimer)
  imageErrorTimer = setTimeout(() => (imageError.value = ''), 3000)
}

function isImage(type: string): boolean {
  return typeof type === 'string' && type.startsWith('image/')
}

/** File → data URL（发给视觉模型必须是 base64 data URL，blob: object URL 模型访问不到） */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** 把图片文件加入待发送列表（校验类型 / 体积 / 数量） */
async function addImages(files: File[]) {
  if (!currentModelSupportsVision()) flashImageError('当前模型可能不支持图片，建议切换 VL 模型')
  for (const file of files) {
    if (!isImage(file.type)) continue
    if (pendingImages.value.length >= settings.value.maxImages) {
      flashImageError(`最多 ${settings.value.maxImages} 张`)
      break
    }
    if (file.size > MAX_CHAT_IMAGE_SIZE) {
      flashImageError(`单张不超过 ${Math.round(MAX_CHAT_IMAGE_SIZE / 1024 / 1024)}MB`)
      continue
    }
    try {
      const url = await fileToDataUrl(file)
      pendingImages.value.push({
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        url,
        name: file.name || '图片',
      })
    } catch {
      /* 读取失败：跳过该张 */
    }
  }
}

function removePendingImage(id: string) {
  pendingImages.value = pendingImages.value.filter((p) => p.id !== id)
}

/** 粘贴：剪贴板含图片才接管（纯文本粘贴照常插入输入框，不拦截） */
async function onImagePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const it of Array.from(items)) {
    if (it.kind === 'file' && isImage(it.type)) {
      const f = it.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length) {
    e.preventDefault() // 阻止图片被当文本插入输入框
    await addImages(files)
  }
}

async function onImageDrop(e: DragEvent) {
  isDraggingImage.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.some((f) => isImage(f.type))) await addImages(files)
}

/** 发送文本（若有挂起的引用，自动拼上引用前缀并清除引用；一并带上待发图片） */
function commitSend(text: string) {
  const finalText = quoteMessageIdx.value !== null ? buildQuoteText() + text : text
  const imgs = pendingImages.value.map((p) => p.url)
  quoteMessageIdx.value = null
  pendingImages.value = []
  isAwayFromLatest.value = false
  hasNewContentWhileAway.value = false
  scrollToBottom()
  store.send(finalText, imgs, activeComposerMode.value)
}

// ============ 拖拽缩放相关 ============
/** 面板尺寸持久化存储 */
const panelSize = useStorage<{ width: number; height: number }>('hao123-chat-panel-size', {
  width: 820,
  height: 0, // 0 表示用默认满高（视口 76%），由 initSize 折算为具体像素
})
const isResizing = ref(false)
const startPos = ref({ x: 0, y: 0 })
const startSize = ref({ width: 820, height: 0 })
const currentSize = ref({ width: 820, height: 0 })

const MIN_WIDTH = 620
const MIN_HEIGHT = 320
// 最大宽度为视口宽度的 90%，最大高度为视口高度的 85%。
// 必须是 ref：computed 读 window.innerWidth 不产生响应式依赖，永远不会重算，
// 窗口缩放后钳制就会失效。这里在 onWindowResize 里手动刷新。
const viewportMaxWidth = () => (typeof window !== 'undefined' ? window.innerWidth * 0.9 : 900)
const viewportMaxHeight = () => (typeof window !== 'undefined' ? window.innerHeight * 0.85 : 700)
const maxWidth = ref(viewportMaxWidth())
const maxHeight = ref(viewportMaxHeight())
const panelStyle = computed(() => {
  if (isImmersive.value) {
    return {
      width: '100vw',
      maxWidth: '100vw',
      height: '100dvh',
      maxHeight: '100dvh',
    }
  }
  return {
    width: currentSize.value.width + 'px',
    maxWidth: maxWidth.value + 'px',
    height: currentSize.value.height > 0 ? currentSize.value.height + 'px' : 'auto',
    maxHeight: maxHeight.value + 'px',
  }
})

/** 默认面板高度：视口的 76%，限制在 [MIN_HEIGHT, maxHeight] 之间。
 * 用固定高度而非 auto，是为了让输入框始终钉在面板底部（中间对话区/空态区 flex-1 撑开、
 * 各自滚动），不会内容少时浮到中间。 */
function defaultPanelHeight() {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1000
  return Math.min(Math.max(Math.round(vh * 0.76), MIN_HEIGHT), maxHeight.value)
}

/** 初始化尺寸 */
function initSize() {
  currentSize.value = {
    width: Math.min(Math.max(panelSize.value.width, MIN_WIDTH), maxWidth.value),
    height: panelSize.value.height > 0 ? Math.min(Math.max(panelSize.value.height, MIN_HEIGHT), maxHeight.value) : defaultPanelHeight(),
  }
}

/** 开始拖拽 */
function onResizeStart(e: MouseEvent) {
  if (isImmersive.value) return
  e.preventDefault()
  e.stopPropagation()
  isResizing.value = true
  startPos.value = { x: e.clientX, y: e.clientY }
  // 自适应高度（height=0）下，起手改用面板元素的实际高度，
  // 否则 newHeight 永远跟随 startSize.height 停在 0，垂直方向缩不动。
  const realHeight = currentSize.value.height > 0
    ? currentSize.value.height
    : panelEl.value?.offsetHeight ?? MIN_HEIGHT
  startSize.value = { width: currentSize.value.width, height: realHeight }

  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
  document.addEventListener('mouseleave', onResizeEnd)
}

/** 拖拽中 */
function onResizeMove(e: MouseEvent) {
  if (!isResizing.value) return

  const deltaX = e.clientX - startPos.value.x
  const deltaY = e.clientY - startPos.value.y

  // 右下角拖拽：横向和纵向都可调整
  // 左右对称扩展（保持居中）
  const newWidth = Math.min(Math.max(startSize.value.width + deltaX * 2, MIN_WIDTH), maxWidth.value)
  // startSize.height 在 onResizeStart 里已确保 > 0
  const newHeight = Math.min(Math.max(startSize.value.height + deltaY, MIN_HEIGHT), maxHeight.value)

  currentSize.value = { width: newWidth, height: newHeight }
}

/** 结束拖拽 */
function onResizeEnd() {
  isResizing.value = false
  // 持久化存储
  panelSize.value = { ...currentSize.value }

  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.removeEventListener('mouseleave', onResizeEnd)
}

/** 双击重置尺寸 */
function onResizeDoubleClick() {
  currentSize.value = { width: 820, height: defaultPanelHeight() }
  panelSize.value = { ...currentSize.value }
}

function toggleImmersive() {
  const shouldKeepFollowing = isNearBottom()
  isImmersive.value = !isImmersive.value
  if (isImmersive.value && isResizing.value) {
    isResizing.value = false
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
    document.removeEventListener('mouseleave', onResizeEnd)
  }
  nextTick(() => {
    autoGrow()
    if (shouldKeepFollowing) scrollToBottom()
    else syncScrollState()
  })
}

function onImmersiveKeydown(e: KeyboardEvent) {
  if (!store.open || e.key !== 'Escape' || e.isComposing || showSettings.value) return
  if (previewImage.value) {
    e.preventDefault()
    e.stopImmediatePropagation()
    previewImage.value = null
    return
  }
  if (!isImmersive.value) return
  e.preventDefault()
  e.stopImmediatePropagation()
  isImmersive.value = false
  nextTick(syncScrollState)
}

// 监听窗口大小变化：先刷新最大限制，再把当前尺寸钳回新视口内
function onWindowResize() {
  maxWidth.value = viewportMaxWidth()
  maxHeight.value = viewportMaxHeight()
  currentSize.value.width = Math.min(currentSize.value.width, maxWidth.value)
  if (currentSize.value.height > 0) {
    currentSize.value.height = Math.min(currentSize.value.height, maxHeight.value)
  }
}

/** 格式化工具执行耗时 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** 格式化 JSON 预览 */
function formatJsonPreview(jsonStr: string): string {
  try {
    const parsed = JSON.parse(jsonStr)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return jsonStr
  }
}

/**
 * 把 agent 循环中间步骤的多条活动标签合并为可读摘要。
 * - 单条有详情时显示「标签（详情）」
 * - 多条同标签时合并为「标签（N 项）」避免「读取外部链接 · 读取外部链接」这种无意义重复
 * - 多条不同标签时用「→」连接
 */
function formatLoopLabel(activities: ToolActivity[]): string {
  if (!activities?.length) return ''
  if (activities.length === 1) {
    const a = activities[0]
    return a.detail ? `${a.label}（${a.detail}）` : a.label
  }
  const firstLabel = activities[0].label
  const allSame = activities.every((a) => a.label === firstLabel)
  if (allSame) {
    return `${firstLabel}（${activities.length} 项）`
  }
  return activities.map((a) => a.label).join(' → ')
}

/**
 * Markdown 渲染缓存：历史消息按 content 命中；流式中的消息限频解析。
 * 这样既避免结束时从纯文本跳到富文本，也不会每个 token 都跑一次 markdown-it。
 */
const STREAM_MD_RENDER_INTERVAL = 80
const mdCache = new WeakMap<ChatMessage, { content: string; html: string; renderedAt: number; streaming: boolean }>()
function renderMd(m: ChatMessage, streaming = false): string {
  const cached = mdCache.get(m)
  if (cached && cached.content === m.content && cached.streaming === streaming) return cached.html
  const now = Date.now()
  if (streaming && cached && cached.streaming === streaming && now - cached.renderedAt < STREAM_MD_RENDER_INTERVAL) {
    return cached.html
  }
  const html = renderMarkdown(m.content, { streaming })
  mdCache.set(m, { content: m.content, html, renderedAt: now, streaming })
  return html
}

// 代码块复制：markdown 经 v-html 注入的「复制」按钮不归 Vue 管事件，
// 在 Markdown 容器上做局部事件委托。代码内容从同一代码块里的 <pre><code> 读回，
// 避免把代码内联进 HTML 属性（会触发换行/引号语法错误与注入）。
async function onMarkdownClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement)?.closest<HTMLButtonElement>('.code-copy-btn')
  if (!btn) return

  e.preventDefault()
  e.stopPropagation()
  if (btn.disabled || btn.dataset.copyDisabled === 'true') return

  const wrapper = btn.closest('.code-block-wrapper')
  const code = wrapper?.querySelector('pre code')?.textContent ?? wrapper?.querySelector('pre')?.textContent ?? ''
  const originalText = btn.textContent || '复制'
  const ok = await writeClipboardText(code)

  btn.textContent = ok ? '已复制' : '复制失败'
  btn.classList.toggle('copied', ok)
  btn.classList.toggle('copy-failed', !ok)
  setTimeout(() => {
    btn.textContent = originalText
    btn.classList.remove('copied', 'copy-failed')
  }, 1500)
}
/** 当前是否正在流式生成第 i 条消息（该条 content 仍在增长，用纯文本渲染避免每 token 重解析） */
function isStreamingAt(i: number): boolean {
  return !!store.streaming && i === store.messages.length - 1
}

/**
 * 等待态：只要 assistant 还没给出用户可见的文字回答，就持续显示等待动画。
 * 方案A：工具执行期间也保持等待态（而非之前那样一旦有 tool_calls 就隐藏三个点）。
 * 方案B：区分「思考中」和「执行中」两个阶段，给用户清晰的进度感知。
 */
const awaitingFirstToken = computed(() => {
  if (!store.streaming) return false
  const last = store.messages[store.messages.length - 1]
  return last?.role === 'assistant' && !last.content
})

/** 当前正在执行工具（有活动卡但还没文字输出） */
const isExecutingTools = computed(() => {
  if (!store.streaming) return false
  const last = store.messages[store.messages.length - 1]
  if (last?.role !== 'assistant') return false
  return !!(last.activities?.length) && !last.content
})

/** 当前 agent 循环已进行的轮数（多轮调研进度感；> 1 时显示「步骤 N」前缀） */
const currentLoopStep = computed(() => {
  if (!store.streaming) return 0
  // 复用 loopMeta 已算好的分组轮次，避免再过滤一遍 messages（口径漂移风险）。
  // loopMeta 在下方定义；computed getter 懒执行，渲染时 loopMeta 已就绪。
  const lastIdx = store.messages.length - 1
  return loopMeta.value.get(lastIdx)?.round ?? 0
})

/** 工具执行中的进度描述（含多轮步骤前缀） */
const executingToolLabel = computed(() => {
  const last = store.messages[store.messages.length - 1]
  if (!last?.activities?.length) return ''
  const running = last.activities.filter((a) => a.status === 'running')
  const done = last.activities.filter((a) => a.status === 'done')
  const error = last.activities.filter((a) => a.status === 'error')
  const pending = last.activities.filter((a) => a.status === 'pending')
  // 多轮调研时给「步骤 N ·」前缀，让用户知道这是第几步、还要继续
  const stepPrefix = currentLoopStep.value > 1 ? `步骤 ${currentLoopStep.value} · ` : ''
  if (running.length > 1) return `${stepPrefix}正在并行查询（${done.length}/${last.activities.length}）…`
  if (running.length === 1) return `${stepPrefix}正在查询${running[0].label}…`
  if (pending.length) return `等待确认（${pending.length} 项）…`
  if (error.length === last.activities.length) return '查询遇到问题，可点击下方活动卡重试'
  if (error.length) return `部分查询失败（${error.length}/${last.activities.length}），可点击重试`
  if (done.length === last.activities.length) return `${stepPrefix}正在组织回答…`
  return ''
})

// ============ Agent 循环中间步骤折叠（P0：多轮工具调用合并显示）============

/**
 * 消息索引 → agent 循环元信息。
 * 同一次 runAgentLoop 产生的多个 assistant 消息共享 _loopGroup，
 * 这里将它们分组并标记中间步骤（非最终回答），供模板折叠为紧凑摘要。
 */
const loopMeta = computed(() => {
  const meta = new Map<number, { group: string; isIntermediate: boolean; round: number }>()
  const groups = new Map<string, number[]>()

  store.messages.forEach((m, i) => {
    if (m.role === 'assistant' && m._loopGroup) {
      const indices = groups.get(m._loopGroup) || []
      indices.push(i)
      groups.set(m._loopGroup, indices)
    }
  })

  for (const [, indices] of groups) {
    // 找该组的最终回答：有 _loopFinal 标记的最后一条，否则取最后一条
    let finalIdx = -1
    for (let j = indices.length - 1; j >= 0; j--) {
      if (store.messages[indices[j]]._loopFinal) {
        finalIdx = indices[j]
        break
      }
    }
    if (finalIdx < 0) finalIdx = indices[indices.length - 1]

    indices.forEach((idx, round) => {
      meta.set(idx, {
        group: store.messages[idx]._loopGroup!,
        isIntermediate: idx !== finalIdx,
        round: round + 1,
      })
    })
  }

  return meta
})

/** 用户手动 toggle 的步骤展开状态（key -> 是否展开）；未记录的走默认（副作用步骤默认展开） */
const manualExpand = ref(new Map<string, boolean>())

/** 是否副作用工具调用（默认展开；纯查询折叠）--与 store.approvalPolicy 同源：写操作 + pending */
function isSideEffectActivity(a: ToolActivity): boolean {
  if (a.status === 'pending') return true
  const n = a.name
  if (['local__create', 'local__update', 'local__delete', 'local__complete'].includes(n)) return true
  if (n === 'wbscf__launch' || n === 'claude__launch') return true
  // git__ 写操作展开；查询类（status/log/show/diff/blame/search/contributors/reflog/config）折叠
  if (n.startsWith('git__') && !['git__status', 'git__log', 'git__show', 'git__diff', 'git__blame', 'git__search', 'git__contributors', 'git__reflog', 'git__config'].includes(n)) return true
  return false
}

/** 步骤是否展开：手动 toggle 优先，否则含副作用活动则默认展开 */
function isLoopStepExpanded(m: ChatMessage, round: number): boolean {
  const key = `${m._loopGroup}_${round}`
  if (manualExpand.value.has(key)) return manualExpand.value.get(key)!
  return !!(m.activities?.some(isSideEffectActivity))
}

function toggleLoopStep(group: string, round: number, activities?: ToolActivity[]) {
  const key = `${group}_${round}`
  const cur = manualExpand.value.has(key)
    ? manualExpand.value.get(key)!
    : !!(activities?.some(isSideEffectActivity))
  manualExpand.value.set(key, !cur)
  manualExpand.value = new Map(manualExpand.value)
}

// ============ 统一错误入口（问题9·方案A）============
// 合并 store.error（业务错误）和 connectivity.unreachable（网络问题）为一个统一入口。
// 内部保留分类，但用户只看到一个错误条，文案和操作统一。

const connectivity = useConnectivity()

interface UnifiedError {
  visible: boolean
  message: string
  style: string
  iconClass: string
  actionClass: string
  actions: { label: string; disabled?: boolean; handler: () => void }[]
}

const unifiedError = computed<UnifiedError>(() => {
  const conn = connectivity.unreachable.value
  const biz = !!store.error

  if (!conn && !biz) {
    return { visible: false, message: '', style: '', iconClass: '', actionClass: '', actions: [] }
  }

  // 网络不可达优先（阻断性更强），但也合并业务错误信息
  if (conn) {
    const baseStyle = 'bg-amber-400/8 ring-1 ring-amber-300/20 text-amber-100/90'
    const baseIcon = 'text-amber-300/80'
    const baseAction = 'text-amber-200/80 hover:text-amber-100'

    // 给用户看的文案（不暴露 classifyError 的内部根因）
    let message: string
    if (connectivity.reason.value === 'auth') {
      message = 'API Key 可能已过期或无效，请在模型配置中更新。'
    } else {
      message = '小吴暂时无法回应，请检查网络或稍后再试。'
    }
    // 如果同时有业务错误，追加一句
    if (biz) {
      message += `（上次对话也出了点问题：${store.error!.slice(0, 60)}）`
    }

    return {
      visible: true,
      message,
      style: baseStyle,
      iconClass: baseIcon,
      actionClass: baseAction,
      actions: [
        {
          label: connectivity.autoRetrying.value ? '重试中…' : '重试',
          disabled: connectivity.autoRetrying.value,
          handler: () => connectivity.retry(),
        },
      ],
    }
  }

  // 纯业务错误
  return {
    visible: true,
    message: store.error!,
    style: 'bg-rose-400/10 ring-1 ring-rose-300/25 text-rose-100/90',
    iconClass: 'text-rose-300/80',
    actionClass: 'text-rose-200/80 hover:text-rose-100',
    actions: [
      { label: '重新回答', handler: () => store.regenerate() },
      { label: '换个问法', handler: () => refillLastUser() },
    ],
  }
})

// 工具类型对应的颜色类
const toolColorClass = (toolName: string) => {
  if (toolName.includes('本地待办')) return 'tool-local'
  if (toolName.includes('天气') || toolName.includes('weather')) return 'tool-weather'
  if (toolName.includes('任务') || toolName.includes('task')) return 'tool-task'
  if (toolName.includes('Bug') || toolName.includes('bug') || toolName.includes('缺陷')) return 'tool-bug'
  if (toolName.includes('知识库') || toolName.includes('kb') || toolName.includes('检索')) return 'tool-kb'
  return ''
}

function bottomDistance(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function isNearBottom(el = scrollEl.value): boolean {
  if (!el) return true
  return bottomDistance(el) <= FOLLOW_BOTTOM_THRESHOLD
}

function syncScrollState() {
  const el = scrollEl.value
  if (!el) return
  if (isNearBottom(el)) {
    isAwayFromLatest.value = false
    hasNewContentWhileAway.value = false
  } else if (!isProgrammaticScroll) {
    isAwayFromLatest.value = true
  }
}

function markProgrammaticScroll(smooth: boolean) {
  isProgrammaticScroll = true
  if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer)
  programmaticScrollTimer = setTimeout(() => {
    isProgrammaticScroll = false
    syncScrollState()
  }, smooth ? 420 : 80)
}

// ============ 外部调研可视化（S3 徽标 / S6 继续调研 / S9 活动卡可读摘要）============

/**
 * 一条 reach__* 活动是否算「成功的外部来源」——徽标 / 来源计数 / 继续调研 chip 统一口径。
 * 必须 status === 'done'：否则全失败的 reach 会显示「基于 0 个来源」徽标，并给出无意义的
 * 「整理成文档」chip。
 */
function isDoneReach(a: ToolActivity): boolean {
  return a.name.startsWith('reach__') && a.status === 'done'
}

/**
 * 该消息（或其所属 agent 循环分组）是否用到成功的外部调研——决定是否挂「基于公开网络信息」徽标。
 * 关键：最终回答消息本身没有 activities（activities 在工具轮的中间消息上），因此必须回溯同组
 * 工具轮，否则多轮 reach 调研的最终答案永远不会挂徽标。
 */
function usesExternalResearch(m: ChatMessage): boolean {
  if (m.activities?.some(isDoneReach)) return true
  if (m._loopGroup) {
    return store.messages.some(
      (mm) => mm._loopGroup === m._loopGroup && mm.activities?.some(isDoneReach),
    )
  }
  return false
}

/** 估算外部来源数（同组内成功 reach 活动数；hover 提示用，不需精确到条） */
function externalSourceCount(m: ChatMessage): number {
  const group = m._loopGroup
    ? store.messages.filter((mm) => mm._loopGroup === m._loopGroup)
    : [m]
  return group.flatMap((mm) => mm.activities ?? []).filter(isDoneReach).length
}

/** reach 答案后的「继续调研」快捷选项（模块级常量，避免每次渲染重新分配） */
const REACH_FOLLOW_UPS: { label: string; text: string }[] = [
  { label: '再深入一些', text: '针对刚才的调研，挑最重要的发现再深入展开，必要时补充新来源。' },
  { label: '换来源再查', text: '换一批来源重新查一下刚才的问题，看看有没有不同结论。' },
  { label: '整理成文档', text: '把刚才的调研结果整理成一份 Markdown 记录，方便我存到知识库或周报。' },
]

/** 是否为 reach 答案末尾渲染「继续调研」chip（仅在成功 reach 后、非流式时） */
function showReachFollowUps(m: ChatMessage): boolean {
  return usesExternalResearch(m) && !store.streaming
}

/**
 * 把工具活动卡的结果渲染成人类可读摘要。reach 工具的字段排版下沉到 reach 模块的
 * summarizeReachResult（与 UI 卡复用同一套字段读取，避免漂移）；非 reach 工具回退 pretty JSON。
 */
function formatActivityResult(a: ToolActivity): string {
  if (!a.result) return ''
  return summarizeReachResult(a.name, a.result) ?? formatJsonPreview(a.result)
}

function scrollToBottom(smooth = false) {
  const done = () => {
    const el = scrollEl.value
    if (el) {
      markProgrammaticScroll(smooth)
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
      isAwayFromLatest.value = false
      hasNewContentWhileAway.value = false
      if (!smooth) requestAnimationFrame(syncScrollState)
      return true
    }
    return false
  }
  nextTick(() => {
    // content-fade 过渡（out-in）离场期间 scrollEl 可能短暂为 null，
    // 此时补一次延时，等新滚动容器挂载后再滚（如清空后立即发送的首条消息）。
    if (!done()) setTimeout(done, 260)
  })
}

function maybeScrollToBottom() {
  const shouldFollow = !isAwayFromLatest.value || isNearBottom()
  if (shouldFollow) {
    scrollToBottom()
  } else {
    hasNewContentWhileAway.value = true
  }
}

function onChatScroll() {
  syncScrollState()
}

function jumpToLatest() {
  scrollToBottom(true)
}

const showJumpToLatest = computed(() => {
  return store.hasMessages && (hasNewContentWhileAway.value || (store.streaming && isAwayFromLatest.value))
})

// 内容变化时智能跟随到底部。用「最后一条消息内容长度 + 活动状态 + 消息总数」作廉价信号，
// 避免每来一个 token 就把所有消息内容拼成大字符串（流式时 O(n²)）。
watch(
  () => {
    const last = store.messages[store.messages.length - 1]
    return (
      store.messages.length +
      '|' +
      (last ? last.content.length : 0) +
      '|' +
      (last?.ui?.length ?? 0) +
      '|' +
      (last?.activities?.map((a) => a.status).join('') ?? '')
    )
  },
  () => maybeScrollToBottom(),
)

// 打开时聚焦输入框并滚到底
watch(
  () => store.open,
  (v) => {
    if (v) {
      scrollToBottom()
      nextTick(() => inputEl.value?.focus())
    }
  },
)

// 切换会话时清空引用回复 / 待发图片，避免残留指向新会话的错误消息（P2.5）
watch(() => store.activeSessionId, () => {
  quoteMessageIdx.value = null
  pendingImages.value = []
})

/** 输入框最大高度（面板高度的 40%，最小 160px） */
const maxInputHeight = computed(() => {
  if (isImmersive.value) return Math.max(maxHeight.value * 0.45, 180)
  const panelHeight = currentSize.value.height > 0
    ? currentSize.value.height
    : Math.min(600, maxHeight.value) // 默认自适应高度下用 600px 作基准
  return Math.max(panelHeight * 0.4, 160)
})

function autoGrow() {
  const el = inputEl.value
  if (!el) return

  // 先重置高度以获取真实 scrollHeight；输入第二行时就应自然增高。
  el.style.height = 'auto'
  const scrollH = el.scrollHeight
  const maxH = maxInputHeight.value

  el.style.height = Math.min(scrollH, maxH) + 'px'
  el.style.overflowY = scrollH > maxH ? 'auto' : 'hidden'
}

function onSend() {
  const text = input.value
  if ((!text.trim() && !pendingImages.value.length) || store.streaming) return
  input.value = ''
  nextTick(autoGrow)
  commitSend(text)
}

function ask(text: string) {
  if (store.streaming) return
  commitSend(text)
}

function askContext(prompt: string) {
  if (store.streaming) return
  commitSend(prompt)
}

function onEnter(e: KeyboardEvent) {
  // Alt+Enter = 换行（不发送）
  if (e.key === 'Enter' && e.altKey && !e.isComposing) {
    e.preventDefault()
    // 手动插入换行符并移动光标
    const el = inputEl.value
    if (el) {
      const start = el.selectionStart
      const end = el.selectionEnd
      const text = input.value
      input.value = text.slice(0, start) + '\n' + text.slice(end)
      nextTick(() => {
        el.selectionStart = el.selectionEnd = start + 1
        autoGrow()
      })
    }
    return
  }

  // Enter = 发送（非输入法 composing 时不触发）
  // Shift+Enter = 原生换行（浏览器默认行为，不阻止）
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    onSend()
  }
}

async function copy(text: string, idx: number) {
  const ok = await writeClipboardText(text)
  if (ok) {
    copiedIdx.value = idx
    copyFailedIdx.value = -1
    setTimeout(() => {
      if (copiedIdx.value === idx) copiedIdx.value = -1
    }, 1600)
  } else {
    copyFailedIdx.value = idx
    setTimeout(() => {
      if (copyFailedIdx.value === idx) copyFailedIdx.value = -1
    }, 1600)
  }
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 非安全上下文、权限拒绝或 WebView 限制时继续走传统降级。
    }
  }

  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.left = '-1000px'
  ta.style.opacity = '0'

  const selection = document.getSelection()
  const ranges: Range[] = []
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i))
  }
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null

  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  ta.setSelectionRange(0, ta.value.length)

  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }

  document.body.removeChild(ta)
  active?.focus?.()
  if (selection) {
    selection.removeAllRanges()
    for (const range of ranges) selection.addRange(range)
  }

  return ok
}

function isLastAssistant(idx: number): boolean {
  for (let i = store.messages.length - 1; i >= 0; i--) {
    const m = store.messages[i]
    if (m.role === 'assistant') return i === idx
    if (m.role === 'user') return false
  }
  return false
}

// 初始化尺寸监听
onMounted(() => {
  initSize()
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('click', onDocClick)
  window.addEventListener('keydown', onImmersiveKeydown, true)
  // 每分钟检查小时变化，驱动 contextSuggestions 刷新（Fix 3）
  hourTimer = setInterval(() => {
    const h = new Date().getHours()
    if (h !== currentHour.value) currentHour.value = h
  }, 60_000)
})

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', onImmersiveKeydown, true)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.removeEventListener('mouseleave', onResizeEnd)
  if (programmaticScrollTimer) { clearTimeout(programmaticScrollTimer); programmaticScrollTimer = null }
  if (hourTimer) { clearInterval(hourTimer); hourTimer = null }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="cmd-fade">
      <div
        v-if="store.open"
        class="cmd-shell"
        :class="{ 'is-immersive': isImmersive }"
      >
        <!-- 遮罩 -->
        <div class="cmd-backdrop" @click="store.close()" />

        <!-- 面板 -->
        <Transition name="cmd-pop" appear>
          <section
            v-if="store.open"
            ref="panelEl"
            class="cmd-card relative z-10 flex flex-col overflow-hidden"
            :class="{ 'is-resizing': isResizing, 'is-immersive': isImmersive }"
            :style="panelStyle"
            @click.stop
          >
            <!-- 顶部状态条：仅流式时流动发光 -->
            <div class="cmd-accent" :class="{ 'is-streaming': store.streaming }" />

            <!-- 极简头部 -->
            <header class="cmd-header">
              <button class="cmd-brand-dot" type="button" :title="ASSISTANT_NAME" @click="showSettings = true">
                <IconRobot class="w-4 h-4" />
                <span class="cmd-status-dot" :class="store.configured ? 'is-ready' : 'is-warn'" />
              </button>
              <button
                type="button"
                class="cmd-model-chip"
                :class="{ 'is-unconfigured': !modelConfigured }"
                :title="currentModelTitle"
                @click="showSettings = true"
              >
                <span v-if="hasUiConfig" class="cmd-model-provider">{{ currentModelProvider }}</span>
                <span class="cmd-model-name">{{ hasUiConfig ? currentModelName : currentModelLabel }}</span>
              </button>

              <div v-if="isImmersive" class="cmd-head-stats">
                <span>{{ conversationStats.total }} 轮</span>
                <span>{{ activeToolSummary }}</span>
              </div>
              <div v-else class="cmd-session-switcher-wrap">
                <button type="button" class="cmd-session-switcher" :disabled="store.streaming" :title="store.currentSessionTitle" @click="sessionMenuOpen = !sessionMenuOpen">
                  <IconMessageText class="w-3.5 h-3.5 shrink-0" />
                  <span class="flex-1">{{ store.currentSessionTitle }}</span>
                  <svg class="w-3 h-3 shrink-0 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                <div v-if="sessionMenuOpen" class="cmd-session-menu cmd-scroll">
                  <button type="button" class="cmd-session-menu-new" :disabled="store.streaming" @click="store.newSession(); sessionMenuOpen = false"><IconPlus class="w-3.5 h-3.5" /> 新建会话</button>
                  <button v-for="s in store.sessions" :key="s.id" type="button" class="cmd-session-menu-item" :class="{ 'is-active': s.id === store.activeSessionId }" @click="store.switchSession(s.id); sessionMenuOpen = false">
                    <span class="truncate">{{ s.title || '新的协作会话' }}</span>
                  </button>
                </div>
              </div>

              <div class="cmd-header-actions">
                <button
                  v-if="isImmersive"
                  class="cmd-iconbtn"
                  :class="{ 'is-active': immersiveSidebarOpen }"
                  title="上下文侧栏"
                  @click="immersiveSidebarOpen = !immersiveSidebarOpen"
                >
                  <IconPanelRight class="w-4 h-4" />
                </button>
                <button
                  class="cmd-iconbtn"
                  :title="isImmersive ? '退出沉浸式' : '沉浸式对话'"
                  @click="toggleImmersive"
                >
                  <IconFullscreenExit v-if="isImmersive" class="w-4 h-4" />
                  <IconFullscreen v-else class="w-4 h-4" />
                </button>
                <button class="cmd-iconbtn" title="对话参数设置" @click="showSettings = true">
                  <IconCog class="w-4 h-4" />
                </button>
                <button
                  v-if="store.hasMessages"
                  class="cmd-iconbtn"
                  :disabled="store.streaming"
                  title="清空对话"
                  @click="confirmClear = true"
                >
                  <IconBroom class="w-4 h-4" />
                </button>
                <button class="cmd-iconbtn" title="关闭（Esc）" @click="store.close()">
                  <IconClose class="w-4 h-4" />
                </button>
              </div>
            </header>

            <!-- 清空确认条（P1.3：清空不可逆，二次确认） -->
            <div v-show="confirmClear" class="cmd-confirm-clear">
                <span class="flex-1">确定清空当前会话？此操作不可撤销。</span>
                <button class="cmd-confirm-clear-btn is-cancel" @click="confirmClear = false">取消</button>
                <button class="cmd-confirm-clear-btn is-ok" :disabled="store.streaming" @click="store.clear(); confirmClear = false">确认清空</button>
              </div>

            <div class="cmd-body-shell" :class="{ 'has-sidebar': isImmersive && immersiveSidebarOpen }">
              <aside v-if="isImmersive" class="cmd-session-rail relative z-10" aria-label="会话导航">
                <div class="cmd-session-head">
                  <span>会话</span>
                  <button type="button" class="cmd-session-new" :disabled="store.streaming" title="新建会话" @click="store.newSession()">
                    <IconPlus class="w-4 h-4" />
                  </button>
                </div>
                <div class="cmd-session-list cmd-scroll">
                  <button
                    v-for="s in store.sessions"
                    :key="s.id"
                    type="button"
                    class="cmd-session-item"
                    :class="{ 'is-active': s.id === store.activeSessionId }"
                    :disabled="store.streaming"
                    :title="s.title || '新的协作会话'"
                    @click="store.switchSession(s.id)"
                    @dblclick="renameSessionPrompt(s.id, s.title)"
                  >
                    <IconMessageText class="w-4 h-4 shrink-0" />
                    <span class="flex-1 truncate text-left">{{ s.title || '新的协作会话' }}</span>
                    <span class="cmd-session-del" @click.stop="confirmDeleteSession(s.id, s.title)" title="删除会话">
                      <IconClose class="w-3 h-3" />
                    </span>
                  </button>
                </div>
                <div class="cmd-session-context">
                  <span>快捷上下文</span>
                  <button
                    v-for="chip in contextChips.slice(0, 4)"
                    :key="chip.key"
                    type="button"
                    :disabled="store.streaming"
                    @click="askContext(chip.prompt)"
                  >
                    {{ chip.label }}
                  </button>
                </div>
              </aside>
              <main class="cmd-main-stage">
                <!-- 信息流 / 空态 -->
                <Transition name="content-fade" mode="out-in">
                  <div
                    v-if="store.hasMessages || store.error || !store.configured"
                    ref="scrollEl"
                    class="cmd-stream relative z-10 flex-1 min-h-0 overflow-y-auto cmd-scroll"
                    @scroll.passive="onChatScroll"
                  >
                    <!-- 未配置 -->
                    <div v-if="!store.configured" class="cmd-setup">
                      <IconAlert class="w-7 h-7" />
                      <p class="cmd-setup-title">尚未接入 LLM</p>
                      <p class="cmd-setup-hint">点击下方按钮或头部模型芯片，填写 API Key 后即可对话</p>
                      <button class="cmd-setup-btn" @click="store.openModelConfig()">配置模型</button>
                    </div>

                    <!-- 消息列表 -->
                    <div v-else class="cmd-messages">
                      <template v-for="(m, i) in store.messages" :key="i">
                        <!-- 用户 -->
                        <div v-if="m.role === 'user'" class="cmd-msg cmd-msg-user">
                          <div class="cmd-msg-body">
                            <div v-if="m.images?.length" class="cmd-msg-images">
                              <img
                                v-for="(img, ii) in m.images"
                                :key="ii"
                                :src="img"
                                class="cmd-msg-img"
                                alt="发送的图片"
                                @click="previewImage = img"
                              >
                            </div>
                            <p v-if="m.content" class="cmd-msg-text">{{ m.content }}</p>
                          </div>
                          <span class="cmd-msg-time">{{ formatMessageTime(m.ts) }}</span>
                        </div>

                        <!-- 助手 · 中间步骤（折叠） -->
                        <div
                          v-else-if="m.role === 'assistant' && loopMeta.get(i)?.isIntermediate && m.activities?.length"
                          class="cmd-msg cmd-msg-step"
                        >
                          <div class="cmd-step-rail"><IconRobot class="w-3.5 h-3.5" /></div>
                          <div class="cmd-step-body">
                            <div
                              class="cmd-loop-intermediate"
                              :class="{ 'is-expanded': isLoopStepExpanded(m, loopMeta.get(i)!.round) }"
                              @click="toggleLoopStep(m._loopGroup!, loopMeta.get(i)!.round, m.activities)"
                            >
                              <div class="flex items-center gap-2">
                                <span class="cmd-loop-step-num">步骤 {{ loopMeta.get(i)!.round }}</span>
                                <span class="cmd-loop-step-label truncate text-[11px] text-white/45">
                                  {{ formatLoopLabel(m.activities!) }}
                                </span>
                                <span class="ml-auto flex items-center gap-1 shrink-0">
                                  <template v-if="m.activities!.every(a => a.status === 'done')">
                                    <IconCheck class="w-3 h-3 text-emerald-300/60" />
                                    <span class="text-[10px] text-emerald-300/60">{{ formatDuration(m.activities!.reduce((sum, a) => sum + (a.duration || 0), 0)) }}</span>
                                  </template>
                                  <template v-else-if="m.activities!.some(a => a.status === 'error')">
                                    <IconAlert class="w-3 h-3 text-rose-300/60" />
                                    <span class="text-[10px] text-rose-300/60">部分失败</span>
                                  </template>
                                  <template v-else-if="m.activities!.some(a => a.status === 'running')">
                                    <IconLoading class="w-3 h-3 text-sky-300/60 animate-spin" />
                                    <span class="text-[10px] text-sky-300/60">执行中</span>
                                  </template>
                                </span>
                                <svg
                                  class="w-3 h-3 text-white/25 transition-transform duration-200"
                                  :class="{ 'rotate-180': isLoopStepExpanded(m, loopMeta.get(i)!.round) }"
                                  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                >
                                  <polyline points="6 9 12 15 18 9" />
                                </svg>
                              </div>
                            </div>
                            <div v-if="m.content" class="mt-1 text-[11px] text-white/25 leading-relaxed line-clamp-2 px-1">
                              {{ m.content }}
                            </div>
                            <div
                              v-if="isLoopStepExpanded(m, loopMeta.get(i)!.round)"
                              class="mt-1.5 space-y-1"
                            >
                              <div
                                v-for="(a, ai) in m.activities!"
                                :key="ai"
                                class="cmd-activity is-compact"
                                :class="[toolColorClass(a.label), a.status, { 'is-error': a.status === 'error' }]"
                              >
                                <ToolActivityRow :activity="a" compact />
                                <div v-if="a.status === 'pending' && a.approval" class="cmd-approval mt-1" @click.stop>
                                  <div class="cmd-approval-head">
                                    <span class="cmd-approval-kicker">需要确认</span>
                                    <strong>{{ a.approval.title }}</strong>
                                  </div>
                                  <p class="cmd-approval-desc">{{ a.approval.description }}</p>
                                  <p class="cmd-approval-risk">{{ a.approval.risk }}</p>
                                  <div class="cmd-approval-actions">
                                    <button class="cmd-approval-btn is-cancel" :disabled="store.streaming" @click="store.rejectTool(i, ai)">取消</button>
                                    <button class="cmd-approval-btn is-confirm" :disabled="store.streaming" @click="store.approveTool(i, ai)">确认执行</button>
                                  </div>
                                </div>
                                <div v-if="a.result" class="mt-1 pt-1 border-t border-white/10">
                                  <pre class="text-[11px] text-white/70 bg-black/30 p-2 rounded-md max-h-[220px] overflow-auto whitespace-pre-wrap break-all">{{ formatActivityResult(a) }}</pre>
                                </div>
                              </div>
                            </div>
                            <div v-if="m.ui?.length" class="cmd-ui-stack mt-1.5">
                              <GenerativeUiBlock
                                v-for="block in m.ui"
                                :key="block.id"
                                :block="block"
                              />
                            </div>
                            <span class="cmd-msg-time">{{ formatMessageTime(m.ts) }}</span>
                          </div>
                        </div>

                        <!-- 助手 · 最终回答 -->
                        <div
                          v-else-if="m.role === 'assistant' && (m.content || m.activities?.length || m.ui?.length)"
                          class="cmd-msg cmd-msg-ai"
                        >
                          <div class="cmd-ai-rail"><IconRobot class="w-4 h-4" /></div>
                          <div class="cmd-ai-body">
                            <!-- 工具活动（纤薄可展开行） -->
                            <div v-if="m.activities?.length" class="cmd-activities">
                              <div v-if="m.activities.filter((a) => a.status === 'running').length > 1" class="cmd-activities-progress">
                                <div class="flex items-center justify-between text-[10px] text-white/40 mb-1">
                                  <span>正在并行查询</span>
                                  <span>{{ m.activities.filter((a) => a.status === 'done').length }}/{{ m.activities.length }}</span>
                                </div>
                                <div class="h-1 bg-white/10 rounded-full overflow-hidden">
                                  <div
                                    class="h-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-300 ease-out"
                                    :style="{ width: `${(m.activities.filter((a) => a.status === 'done').length / m.activities.length) * 100}%` }"
                                  />
                                </div>
                              </div>

                              <div
                                v-for="(a, ai) in m.activities"
                                :key="ai"
                                class="cmd-activity"
                                :class="[toolColorClass(a.label), a.status, { 'is-error': a.status === 'error', 'is-pending': a.status === 'pending', 'is-expanded': a.expanded }]"
                                @click="store.toggleActivityExpand(i, ai)"
                              >
                                <div class="flex items-center w-full">
                                  <ToolActivityRow :activity="a" />
                                  <svg
                                    v-if="a.result"
                                    class="w-3 h-3 ml-1 text-white/30 transition-transform duration-200"
                                    :class="{ 'rotate-180': a.expanded }"
                                    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                  >
                                    <polyline points="6 9 12 15 18 9" />
                                  </svg>
                                  <button
                                    v-if="a.status === 'error' && !a.approval && !store.streaming"
                                    class="ml-2 px-2 py-0.5 text-[10px] text-rose-300/80 bg-rose-400/10 hover:bg-rose-400/20 rounded transition-colors"
                                    @click.stop="store.retryTool(i, ai)"
                                  >
                                    重试
                                  </button>
                                </div>

                                <!-- 审批卡 -->
                                <div v-if="a.status === 'pending' && a.approval" class="cmd-approval" @click.stop>
                                  <div class="cmd-approval-head">
                                    <span class="cmd-approval-kicker">需要确认</span>
                                    <strong>{{ a.approval.title }}</strong>
                                  </div>
                                  <p class="cmd-approval-desc">{{ a.approval.description }}</p>
                                  <p class="cmd-approval-risk">{{ a.approval.risk }}</p>
                                  <details class="cmd-approval-args">
                                    <summary>查看参数</summary>
                                    <pre>{{ JSON.stringify(a.approval.args, null, 2) }}</pre>
                                  </details>
                                  <div class="cmd-approval-actions">
                                    <button class="cmd-approval-btn is-cancel" :disabled="store.streaming" @click="store.rejectTool(i, ai)">取消</button>
                                    <button class="cmd-approval-btn is-confirm" :disabled="store.streaming" @click="store.approveTool(i, ai)">确认执行</button>
                                  </div>
                                </div>

                                <Transition name="activity-expand">
                                  <div v-if="a.expanded && a.result" class="mt-2 pt-2 border-t border-white/10">
                                    <div class="text-[10px] text-white/40 mb-1.5">返回结果预览</div>
                                    <pre class="text-[11px] text-white/70 bg-black/30 p-2 rounded-md max-h-[220px] overflow-auto whitespace-pre-wrap break-all">{{ formatActivityResult(a) }}</pre>
                                  </div>
                                </Transition>
                              </div>
                            </div>

                            <div v-if="m.ui?.length" class="cmd-ui-stack">
                              <GenerativeUiBlock
                                v-for="block in m.ui"
                                :key="block.id"
                                :block="block"
                              />
                            </div>

                            <!-- 正文（无框全宽，内容为王） -->
                            <div v-if="m.content" class="cmd-md group" @click="onMarkdownClick">
                              <div
                                v-if="usesExternalResearch(m)"
                                class="cmd-ext-badge"
                                :title="`基于 ${externalSourceCount(m)} 个外部公开来源 · 网络信息可能过时或片面，关键结论请核实`"
                              >
                                <IconSearchWeb class="w-3 h-3 shrink-0" />
                                <span>基于公开网络信息 · 请核实</span>
                              </div>
                              <div v-html="renderMd(m, isStreamingAt(i))" class="md-content" />
                              <span v-if="isStreamingAt(i)" class="cmd-caret" />

                              <div v-if="!isStreamingAt(i)" class="cmd-action-bar">
                                <span class="cmd-quality-tag" :title="`反馈归因：${store.categoryLabel(m.qualityCategory)}`">
                                  {{ store.categoryLabel(m.qualityCategory) }}
                                </span>
                                <button class="cmd-action" :title="copiedIdx === i ? '已复制' : copyFailedIdx === i ? '复制失败' : '复制'" @click="copy(m.content, i)">
                                  <IconCheck v-if="copiedIdx === i" class="w-3.5 h-3.5 text-emerald-300/80" />
                                  <IconAlert v-else-if="copyFailedIdx === i" class="w-3.5 h-3.5 text-rose-300/80" />
                                  <IconCopy v-else class="w-3.5 h-3.5" />
                                </button>
                                <button
                                  v-if="isLastAssistant(i) && !store.streaming"
                                  class="cmd-action"
                                  title="重新生成"
                                  @click="store.regenerate()"
                                >
                                  <IconRefresh class="w-3.5 h-3.5" />
                                </button>
                                <button class="cmd-action" :title="m.feedback === 'up' ? '已赞' : '有用'" @click="store.rate(i, 'up')">
                                  <IconThumbUpFill v-if="m.feedback === 'up'" class="w-3.5 h-3.5 text-emerald-300/80" />
                                  <IconThumbUp v-else class="w-3.5 h-3.5" />
                                </button>
                                <button class="cmd-action" :title="m.feedback === 'down' ? '已踩' : '没用'" @click="store.rate(i, 'down')">
                                  <IconThumbDownFill v-if="m.feedback === 'down'" class="w-3.5 h-3.5 text-rose-300/80" />
                                  <IconThumbDown v-else class="w-3.5 h-3.5" />
                                </button>
                                <button class="cmd-action" title="引用回复" @click="startQuote(i)">
                                  <IconQuote class="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <span class="cmd-msg-time">{{ formatMessageTime(m.ts) }}</span>
                            <!-- reach 继续调研 -->
                            <div v-if="showReachFollowUps(m)" class="cmd-followups">
                              <button
                                v-for="fu in REACH_FOLLOW_UPS"
                                :key="fu.label"
                                class="cmd-followup-chip"
                                :title="fu.text"
                                @click="ask(fu.text)"
                              >
                                {{ fu.label }}
                              </button>
                            </div>
                          </div>
                        </div>
                      </template>
                    </div>

                    <!-- 等待首个 token -->
                    <div v-if="awaitingFirstToken" class="cmd-msg cmd-msg-ai">
                      <div class="cmd-ai-rail"><IconRobot class="w-4 h-4" /></div>
                      <div class="cmd-ai-body">
                        <div class="cmd-waiting">
                          <span class="cmd-dot" style="animation-delay: 0ms" />
                          <span class="cmd-dot" style="animation-delay: 160ms" />
                          <span class="cmd-dot" style="animation-delay: 320ms" />
                        </div>
                        <div v-if="isExecutingTools && executingToolLabel" class="cmd-executing-label">
                          {{ executingToolLabel }}
                        </div>
                      </div>
                    </div>
                  </div>
                </Transition>

                <Transition name="cmd-jump">
                  <div
                    v-if="showJumpToLatest"
                    class="cmd-jump-latest relative z-20 flex justify-center px-4"
                  >
                    <button
                      type="button"
                      class="cmd-jump-latest-btn"
                      title="回到最新回复"
                      @click="jumpToLatest"
                    >
                      <IconArrowDown class="w-3.5 h-3.5" />
                      <span>{{ store.streaming ? '正在生成，查看最新' : '查看最新' }}</span>
                    </button>
                  </div>
                </Transition>

                <!-- 统一错误条 -->
                <div
                  v-if="unifiedError.visible"
                  class="cmd-error-bar relative z-10 flex items-start gap-2 mx-4 mb-2 px-3 py-2 rounded-lg text-xs"
                  :class="unifiedError.style"
                >
                  <IconAlert class="w-4 h-4 shrink-0 mt-px" :class="unifiedError.iconClass" />
                  <div class="flex-1 min-w-0 break-words">
                    <p>{{ unifiedError.message }}</p>
                    <div v-if="unifiedError.actions.length" class="flex gap-2 mt-1.5">
                      <button
                        v-for="a in unifiedError.actions"
                        :key="a.label"
                        class="underline underline-offset-2 transition-colors"
                        :class="unifiedError.actionClass"
                        :disabled="a.disabled"
                        @click="a.handler()"
                      >
                        {{ a.label }}
                      </button>
                    </div>
                  </div>
                </div>

                <!-- 待确认操作聚合条（P0：pending 审批常驻可见，解决挂在中间步骤不可达的死锁） -->
                <div v-show="store.pendingApprovals.length" class="cmd-approval-stack relative z-10 mx-4 mb-2">
                    <div
                      v-for="p in store.pendingApprovals"
                      :key="`pa-${p.messageIndex}-${p.activityIndex}`"
                      class="cmd-approval"
                    >
                      <div class="cmd-approval-head">
                        <IconAlert class="w-4 h-4 shrink-0 text-amber-300/80" />
                        <span class="cmd-approval-kicker">需要确认</span>
                        <strong>{{ p.activity.approval?.title }}</strong>
                      </div>
                      <p class="cmd-approval-desc">{{ p.activity.approval?.description }}</p>
                      <p class="cmd-approval-risk">{{ p.activity.approval?.risk }}</p>
                      <div class="cmd-approval-actions">
                        <button class="cmd-approval-btn is-cancel" :disabled="store.streaming" @click="store.rejectTool(p.messageIndex, p.activityIndex)">取消</button>
                        <button class="cmd-approval-btn is-confirm" :disabled="store.streaming" @click="store.approveTool(p.messageIndex, p.activityIndex)">确认执行</button>
                      </div>
                    </div>
                  </div>

                <!-- 空态：助理主页 -->
                <Transition name="content-fade" mode="out-in">
                  <div
                    v-if="store.configured && !store.hasMessages"
                    class="cmd-empty relative z-10 flex-1 min-h-0 flex flex-col justify-center overflow-y-auto px-3 pb-3 pt-3 cmd-scroll"
                  >
                    <div class="cmd-empty-inner">
                      <div class="cmd-empty-layout">
                        <div class="cmd-empty-hero">
                          <div class="cmd-empty-avatar"><IconRobot class="w-8 h-8" /></div>
                          <p class="cmd-empty-greeting">{{ pickGreeting() }}，我是 {{ ASSISTANT_NAME }}</p>
                          <p class="cmd-empty-sub">天气 · 禅道 · 待办 · 知识库 · 调研，直接说就好</p>
                        </div>
                        <div class="cmd-empty-start">
                          <span class="cmd-empty-start-label">从这里开始</span>
                          <div class="cmd-empty-suggestions">
                        <button
                          v-for="s in contextSuggestions"
                          :key="s.text"
                          class="cmd-suggestion group"
                          @click="ask(s.text)"
                        >
                          <component :is="suggestionIconFor(s.icon)" class="w-4 h-4 shrink-0" />
                          <span class="flex-1 text-left">{{ s.text }}</span>
                          <IconSend class="w-3.5 h-3.5 -rotate-90" />
                        </button>
                          </div>
                        </div>
                        <div v-if="recentUserMessages.length" class="cmd-empty-recent">
                          <span class="cmd-empty-start-label">最近提问</span>
                          <div class="cmd-empty-recent-list">
                            <button v-for="(u, ui) in recentUserMessages" :key="ui" class="cmd-empty-recent-item" :title="u" @click="ask(u)">
                              <IconMessageText class="w-3.5 h-3.5 shrink-0" />
                              <span class="flex-1 truncate text-left">{{ u }}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Transition>

                <!-- 引用预览 -->
                <Transition name="quote-fade">
                  <div
                    v-if="quoteMessageIdx !== null"
                    class="quote-preview relative z-10 flex items-start gap-3 px-4 py-2.5"
                  >
                    <IconQuote class="w-4 h-4 shrink-0 mt-0.5" />
                    <div class="flex-1 min-w-0">
                      <div class="text-[11px] font-medium" style="color: rgba(125,211,252,0.8)">
                        引用 {{ getQuoteRole(quoteMessageIdx) }} 的回复
                      </div>
                      <div class="text-[12px] text-white/50 truncate italic">
                        {{ getQuotePreview(quoteMessageIdx) }}
                      </div>
                    </div>
                    <button
                      class="shrink-0 text-white/40 hover:text-white/80 transition-colors"
                      title="取消引用"
                      @click="cancelQuote"
                    >
                      <IconCloseCircle class="w-4 h-4" />
                    </button>
                  </div>
                </Transition>

                <!-- 待发送图片 -->
                <Transition name="quote-fade">
                  <div
                    v-if="pendingImages.length || imageError"
                    class="cmd-pending-bar relative z-10 flex items-center gap-2 px-4 py-2"
                  >
                    <div v-if="pendingImages.length" class="flex items-center gap-2 flex-wrap">
                      <div v-for="p in pendingImages" :key="p.id" class="cmd-pending-thumb group">
                        <img :src="p.url" :alt="p.name" @click="previewImage = p.url">
                        <button class="cmd-pending-x" title="移除" @click.stop="removePendingImage(p.id)">
                          <IconCloseCircle class="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <span v-if="imageError" class="text-[11px] text-rose-300/90 ml-auto">{{ imageError }}</span>
                  </div>
                </Transition>

                <!-- 胶囊合成器 -->
                <div
                  class="cmd-input-wrapper relative z-10 shrink-0"
                  :class="{ 'is-drag-img': isDraggingImage }"
                  @dragover.prevent="isDraggingImage = true"
                  @dragleave.prevent="isDraggingImage = false"
                  @drop.prevent="onImageDrop"
                >
                  <div class="cmd-composer-rail">
                    <div class="cmd-mode-tabs">
                      <button
                        v-for="mode in composerModes"
                        :key="mode.key"
                        class="cmd-mode-tab"
                        :class="{ 'is-active': activeComposerMode === mode.key }"
                        type="button"
                        @click="activeComposerMode = mode.key"
                      >
                        {{ mode.label }}
                      </button>
                    </div>
                    <div class="cmd-context-rail">
                      <button
                        v-for="chip in contextChips"
                        :key="chip.key"
                        class="cmd-context-chip"
                        type="button"
                        :disabled="store.streaming"
                        @click="askContext(chip.prompt)"
                      >
                        {{ chip.label }}
                      </button>
                    </div>
                  </div>
                  <div
                    class="cmd-composer"
                    :class="{
                      'has-text': input.trim(),
                      'has-images': pendingImages.length,
                      'is-disabled': !store.configured,
                    }"
                  >
                    <textarea
                      ref="inputEl"
                      v-model="input"
                      rows="1"
                      :disabled="!store.configured"
                      :placeholder="quoteMessageIdx !== null ? '输入回复内容…' : activeModePlaceholder"
                      class="cmd-input w-full resize-none bg-transparent text-[15px] text-white/95 placeholder:text-white/35 outline-none leading-6 cmd-scroll relative z-10"
                      :style="{ maxHeight: maxInputHeight + 'px' }"
                      @keydown="onEnter"
                      @input="autoGrow"
                      @paste="onImagePaste"
                    />
                    <button
                      v-if="store.streaming"
                      class="cmd-send is-stop"
                      title="停止生成"
                      @click="store.stop()"
                    >
                      <IconStop class="w-4 h-4" />
                    </button>
                    <button
                      v-else
                      class="cmd-send"
                      :disabled="(!input.trim() && !pendingImages.length) || !store.configured"
                      title="发送（Enter）"
                      @click="onSend"
                    >
                      <IconSend class="w-4 h-4" />
                    </button>
                  </div>
                  <div class="cmd-footer relative z-10">
                    <span class="cmd-footer-hint">
                      <kbd>Enter</kbd> 发送 <span class="cmd-footer-sep">·</span> <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行
                    </span>
                    <span v-if="store.hasMessages" class="cmd-footer-stats">{{ conversationStats.total }} 轮 · {{ conversationStats.activities }} 工具</span>
                  </div>
                </div>
              </main>

              <!-- 沉浸式侧栏 -->
              <aside v-if="isImmersive && immersiveSidebarOpen" class="cmd-workspace-side relative z-10">
                <section class="cmd-side-section">
                  <div class="cmd-side-head">
                    <IconMessageText class="w-4 h-4" />
                    <span>会话</span>
                  </div>
                  <div class="cmd-side-title">{{ conversationTitle }}</div>
                  <div class="cmd-side-metrics">
                    <div><strong>{{ conversationStats.user }}</strong><span>提问</span></div>
                    <div><strong>{{ conversationStats.assistant }}</strong><span>回复</span></div>
                    <div><strong>{{ conversationStats.activities }}</strong><span>工具</span></div>
                  </div>
                </section>

                <section class="cmd-side-section">
                  <div class="cmd-side-head">
                    <IconViewDashboard class="w-4 h-4" />
                    <span>上下文</span>
                  </div>
                  <div class="cmd-side-chipgrid">
                    <button
                      v-for="chip in contextChips"
                      :key="chip.key"
                      class="cmd-side-chip"
                      :disabled="store.streaming"
                      @click="askContext(chip.prompt)"
                    >
                      {{ chip.label }}
                    </button>
                  </div>
                </section>

                <section class="cmd-side-section">
                  <div class="cmd-side-head">
                    <IconTimeline class="w-4 h-4" />
                    <span>工具时间线</span>
                  </div>
                  <div v-if="recentActivities.length" class="cmd-side-timeline">
                    <div
                      v-for="(a, ai) in recentActivities"
                      :key="`${a.name}-${ai}`"
                      class="cmd-side-activity"
                      :class="a.status"
                    >
                      <span class="cmd-side-dot" />
                      <div class="min-w-0">
                        <div class="cmd-side-activity-title">{{ a.label }}</div>
                        <div class="cmd-side-activity-sub">
                          {{ a.detail || (a.status === 'running' ? '执行中' : a.status === 'pending' ? '待确认' : a.status === 'error' ? '异常' : '已完成') }}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-else class="cmd-side-empty">还没有工具调用</div>
                </section>
              </aside>
            </div>

            <!-- 右下角拖拽句柄 -->
            <div
              v-if="!isImmersive"
              class="resize-handle absolute right-0 bottom-0 z-20 cursor-se-resize"
              title="拖拽调整大小 · 双击重置"
              @mousedown="onResizeStart"
              @dblclick.stop="onResizeDoubleClick"
            >
              <svg viewBox="0 0 10 10" class="resize-icon">
                <path d="M6 10h2V8H6v2zm-4 0h2V6H2v4zm8-8h-2v2h2V2zm-4 0h2V0H6v2zm8 8h2V8h-2v2zm0-4h2V4h-2v2z" />
              </svg>
            </div>
          </section>
        </Transition>

        <!-- 图片大图预览 -->
        <Transition
          enter-active-class="transition-opacity duration-150 ease-out"
          leave-active-class="transition-opacity duration-100 ease-in"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <div
            v-if="previewImage"
            class="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-950/85 backdrop-blur-sm cursor-zoom-out"
            @click="previewImage = null"
          >
            <img :src="previewImage" class="max-w-[92vw] max-h-[90vh] rounded-lg shadow-2xl" alt="图片预览" @click.stop>
            <button
              class="absolute top-5 right-5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg p-2 transition-colors"
              title="关闭"
              @click="previewImage = null"
            >
              <IconClose class="w-6 h-6" />
            </button>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>

  <!-- 对话参数设置弹窗 -->
  <ChatSettingsModal v-model:open="showSettings" />
</template>

<style scoped>
/* ============================================================
 * 小吴 · 对话中枢 v2 · 重做版
 * 去对话框化：干净玻璃面，无四角/网格/重渐变
 * 信息流：用户右对齐轻染色 · 助手无框全宽 + 头像轨（内容为王）
 * 合成器：胶囊式，圆形发送钮内嵌，聚焦整圈辉光
 * 调色板：电光蓝 --accent / 青柠 --run（紫退役）/ off-black 玻璃
 * 圆角：卡·气泡 16 · 按钮·活动 8 · 标签 4 · 胶囊 ∞
 * 动效：--dur/--ease；顶部条仅流式时流动
 * ============================================================ */

/* ---------- 外壳 / 遮罩 ---------- */
.cmd-shell {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: center;
  padding: 6vh 16px;
}
.cmd-shell.is-immersive { padding: 0; }
.cmd-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 0%, rgba(0, 217, 255, 0.1), transparent 40%),
    rgba(3, 7, 14, 0.72);
  backdrop-filter: blur(18px) saturate(130%);
  -webkit-backdrop-filter: blur(18px) saturate(130%);
}

/* ---------- 卡片（去 chrome：无四角 / 无网格 / 干净玻璃） ---------- */
.cmd-card {
  --cmd-tone: var(--accent);
  --cmd-run: var(--run);
  --cmd-border: rgba(0, 217, 255, 0.14);
  --cmd-text: var(--color-text);
  --cmd-muted: var(--color-text-secondary);
  border: 1px solid var(--cmd-border);
  border-radius: var(--radius-card);
  background: linear-gradient(180deg, rgba(13, 17, 24, 0.92), rgba(7, 10, 16, 0.96));
  color: var(--cmd-text);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.025);
  backdrop-filter: blur(28px) saturate(140%);
  -webkit-backdrop-filter: blur(28px) saturate(140%);
}
.cmd-card.is-immersive {
  border-width: 0;
  border-radius: 0;
  background: linear-gradient(180deg, rgba(9, 12, 18, 0.98), rgba(5, 8, 13, 1));
  box-shadow: none;
}

/* 顶部状态条：仅流式时流动发光，否则一条极淡发丝 */
.cmd-accent {
  position: absolute;
  z-index: 6;
  top: 0;
  right: 0;
  left: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--cmd-tone) 40%, transparent), transparent);
  opacity: 0.5;
  transition: opacity var(--dur) var(--ease), height var(--dur) var(--ease);
}
.cmd-accent.is-streaming {
  height: 2px;
  opacity: 1;
  background: linear-gradient(90deg, var(--cmd-tone), var(--cmd-run), var(--cmd-tone));
  background-size: 200% 100%;
  box-shadow: 0 0 14px color-mix(in srgb, var(--cmd-tone) 45%, transparent);
  animation: cmd-accent-flow 2.6s linear infinite;
}
@keyframes cmd-accent-flow {
  from { background-position: 0% 0; }
  to { background-position: 200% 0; }
}

/* ---------- 极简头部（~44px） ---------- */
.cmd-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--cmd-border);
}
.cmd-card.is-immersive .cmd-header {
  padding: 12px clamp(22px, 4vw, 58px);
  border-bottom-color: rgba(0, 217, 255, 0.1);
  backdrop-filter: blur(20px) saturate(120%);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  background: linear-gradient(180deg, rgba(9, 12, 18, 0.8), rgba(9, 12, 18, 0.4));
}
.cmd-brand-dot {
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--cmd-tone) 34%, rgba(255,255,255,0.06));
  border-radius: 10px;
  background:
    radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--cmd-tone) 30%, transparent), transparent 50%),
    rgba(12, 18, 28, 0.6);
  color: color-mix(in srgb, var(--cmd-tone) 85%, white);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.cmd-brand-dot:hover { border-color: color-mix(in srgb, var(--cmd-tone) 55%, transparent); }
.cmd-status-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  border: 2px solid rgba(7, 10, 16, 0.95);
}
.cmd-status-dot.is-ready { background: var(--cmd-run); box-shadow: 0 0 8px rgba(0, 255, 148, 0.6); }
.cmd-status-dot.is-warn { background: var(--hud-warn); }

/* 模型芯片（可点进设置） */
.cmd-model-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid rgba(0, 217, 255, 0.14);
  border-radius: var(--radius-pill);
  background: rgba(12, 18, 28, 0.5);
  color: rgba(190, 230, 252, 0.7);
  font-size: 11.5px;
  font-weight: 760;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.cmd-model-chip:hover,
.cmd-model-chip:focus-visible {
  border-color: color-mix(in srgb, var(--cmd-tone) 38%, transparent);
  color: #fff;
  background: color-mix(in srgb, var(--cmd-tone) 9%, rgba(12, 18, 28, 0.6));
  outline: 0;
}
.cmd-model-chip.is-unconfigured {
  border-color: rgba(251, 191, 36, 0.26);
  color: rgba(251, 191, 36, 0.85);
}
.cmd-model-provider {
  color: rgba(125, 211, 252, 0.82);
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmd-model-provider::after {
  margin-left: 6px;
  color: rgba(148, 163, 184, 0.4);
  content: '/';
}
.cmd-model-name { overflow: hidden; text-overflow: ellipsis; }
.cmd-head-stats {
  display: inline-flex;
  gap: 6px;
  color: rgba(190, 230, 252, 0.36);
  font-size: 11px;
  font-weight: 760;
}
.cmd-head-stats span {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  padding: 0 8px;
  border: 1px solid rgba(255,255,255,0.055);
  border-radius: var(--radius-pill);
  background: rgba(255,255,255,0.026);
  white-space: nowrap;
}
.cmd-header-spacer { flex: 1; min-width: 0; }
.cmd-session-new { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); color: rgba(190,230,252,0.7); cursor: pointer; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
.cmd-session-new:hover:not(:disabled) { background: color-mix(in srgb, var(--cmd-tone) 14%, rgba(255,255,255,0.06)); color: #fff; }
.cmd-session-new:disabled { cursor: not-allowed; opacity: 0.4; }
.cmd-session-list { display: flex; flex-direction: column; gap: 2px; margin: 8px 0; max-height: 240px; overflow-y: auto; }
.cmd-session-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: rgba(190,230,252,0.7); font-size: 12px; cursor: pointer; transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease); }
.cmd-session-item:hover:not(:disabled) { background: rgba(255,255,255,0.04); color: #fff; }
.cmd-session-item.is-active { background: color-mix(in srgb, var(--cmd-tone) 14%, rgba(255,255,255,0.04)); border-color: color-mix(in srgb, var(--cmd-tone) 30%, transparent); color: #fff; }
.cmd-session-item:disabled { cursor: not-allowed; opacity: 0.5; }
.cmd-session-del { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; border-radius: 5px; color: rgba(190,230,252,0.4); cursor: pointer; transition: color var(--dur) var(--ease), background var(--dur) var(--ease); }
.cmd-session-del:hover { color: rgba(253,164,175,0.95); background: rgba(244,63,94,0.14); }
.cmd-session-switcher-wrap { position: relative; flex: 1; min-width: 0; }
.cmd-session-switcher { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 30px; padding: 0 11px; border: 1px solid rgba(0,217,255,0.1); border-radius: var(--radius-pill); background: rgba(12,18,28,0.4); color: rgba(190,230,252,0.7); font-size: 11.5px; cursor: pointer; transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease); }
.cmd-session-switcher:hover:not(:disabled) { border-color: color-mix(in srgb, var(--cmd-tone) 32%, transparent); color: #fff; }
.cmd-session-switcher:disabled { cursor: not-allowed; opacity: 0.5; }
.cmd-session-switcher span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd-session-menu { position: absolute; top: calc(100% + 4px); left: 0; min-width: 220px; max-width: 100%; max-height: 320px; overflow-y: auto; padding: 5px; border: 1px solid rgba(0,217,255,0.14); border-radius: 12px; background: rgba(13,17,24,0.96); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: 0 20px 50px rgba(0,0,0,0.5); z-index: 30; }
.cmd-session-menu-new, .cmd-session-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border-radius: 7px; border: none; background: transparent; color: rgba(190,230,252,0.8); font-size: 12px; text-align: left; cursor: pointer; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
.cmd-session-menu-new { color: color-mix(in srgb, var(--cmd-tone) 90%, white); font-weight: 600; }
.cmd-session-menu-new:hover:not(:disabled), .cmd-session-menu-item:hover { background: rgba(255,255,255,0.06); color: #fff; }
.cmd-session-menu-new:disabled { cursor: not-allowed; opacity: 0.5; }
.cmd-session-menu-item.is-active { background: color-mix(in srgb, var(--cmd-tone) 14%, rgba(255,255,255,0.04)); color: #fff; }
.cmd-header-actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
}
.cmd-iconbtn {
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: var(--radius-btn);
  background: transparent;
  color: rgba(190, 230, 252, 0.6);
  cursor: pointer;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.cmd-iconbtn:hover,
.cmd-iconbtn:focus-visible {
  color: #fff;
  border-color: color-mix(in srgb, var(--cmd-tone) 28%, transparent);
  background: color-mix(in srgb, var(--cmd-tone) 10%, rgba(255,255,255,0.04));
  outline: 0;
}
.cmd-iconbtn.is-active {
  color: #fff;
  border-color: color-mix(in srgb, var(--cmd-tone) 40%, transparent);
  background: color-mix(in srgb, var(--cmd-tone) 14%, rgba(255,255,255,0.05));
}
.cmd-iconbtn:disabled { cursor: not-allowed; opacity: 0.4; }

/* 滚动条 */
.cmd-scroll { scrollbar-width: thin; scrollbar-color: rgba(0, 217, 255, 0.22) transparent; }
.cmd-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.cmd-scroll::-webkit-scrollbar-thumb { background: rgba(0, 217, 255, 0.22); border-radius: 999px; }

/* ---------- 主体 / 双栏 ---------- */
.cmd-body-shell,
.cmd-main-stage { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.cmd-card.is-immersive .cmd-body-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.cmd-card.is-immersive .cmd-body-shell.has-sidebar {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 316px);
}
.cmd-card.is-immersive .cmd-main-stage {
  min-width: 0;
  border-right: 1px solid rgba(0, 217, 255, 0.08);
}

/* ---------- 信息流 ---------- */
.cmd-stream {
  padding: 18px 16px 8px;
}
.cmd-card.is-immersive .cmd-stream {
  padding: clamp(28px, 4vw, 52px) clamp(18px, 6vw, 80px) 8px;
}
.cmd-setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 56px 20px;
  text-align: center;
  color: rgba(190, 230, 252, 0.5);
}
.cmd-setup svg { color: rgba(251, 191, 36, 0.7); }
.cmd-setup-title { margin: 4px 0 0; color: rgba(248, 250, 252, 0.85); font-size: 15px; font-weight: 700; }
.cmd-setup-hint { margin: 0; max-width: 18rem; font-size: 12px; color: rgba(190, 230, 252, 0.4); line-height: 1.6; }
.cmd-setup-btn { margin-top: 14px; padding: 8px 20px; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--cmd-tone) 18%, rgba(12,18,28,0.6)); border: 1px solid color-mix(in srgb, var(--cmd-tone) 42%, transparent); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease); }
.cmd-setup-btn:hover { background: color-mix(in srgb, var(--cmd-tone) 30%, rgba(12,18,28,0.6)); border-color: color-mix(in srgb, var(--cmd-tone) 60%, transparent); }
.cmd-confirm-clear { display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-bottom: 1px solid var(--cmd-border); background: rgba(244,63,94,0.08); color: rgba(253,164,175,0.92); font-size: 12px; }
.cmd-confirm-clear-btn { padding: 4px 12px; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; transition: background var(--dur) var(--ease); }
.cmd-confirm-clear-btn.is-cancel { border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: rgba(190,230,252,0.7); }
.cmd-confirm-clear-btn.is-cancel:hover { background: rgba(255,255,255,0.1); }
.cmd-confirm-clear-btn.is-ok { background: rgba(244,63,94,0.85); color: #fff; border: 1px solid transparent; }
.cmd-confirm-clear-btn.is-ok:hover:not(:disabled) { background: rgb(244,63,94); }
.cmd-confirm-clear-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.cmd-empty-recent { margin-top: 18px; }
.cmd-empty-recent-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.cmd-empty-recent-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.025); color: rgba(190,230,252,0.7); font-size: 12px; cursor: pointer; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
.cmd-empty-recent-item:hover { background: rgba(255,255,255,0.05); color: #fff; }

.cmd-messages {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.cmd-card.is-immersive .cmd-messages { max-width: 820px; margin: 0 auto; width: 100%; }

.cmd-msg-time {
  display: block;
  margin-top: 4px;
  color: rgba(190, 230, 252, 0.22);
  font-size: 10px;
}
.cmd-msg-user .cmd-msg-time { text-align: right; }

/* 用户消息：右对齐，轻染色，无重边框 */
.cmd-msg-user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
}
.cmd-msg-body {
  max-width: 80%;
  padding: 9px 14px;
  border-radius: 14px 14px 4px 14px;
  background: color-mix(in srgb, var(--cmd-tone) 13%, rgba(255,255,255,0.05));
  color: #fff;
  font-size: 14.5px;
  line-height: 1.6;
  word-break: break-word;
}
.cmd-card.is-immersive .cmd-msg-body { max-width: min(72%, 640px); }
.cmd-msg-text { margin: 0; white-space: pre-wrap; }
.cmd-msg-images { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.cmd-msg-img {
  max-width: 170px;
  max-height: 170px;
  border-radius: 10px;
  background: rgba(0,0,0,0.22);
  cursor: zoom-in;
  object-fit: contain;
}
.cmd-msg-body:has(.cmd-msg-images):not(:has(.cmd-msg-text)) .cmd-msg-images { margin-bottom: 0; }

/* 助手消息：无框全宽 + 左头像轨（内容为王） */
.cmd-msg-ai {
  display: flex;
  gap: 12px;
}
.cmd-ai-rail {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-top: 2px;
  border: 1px solid color-mix(in srgb, var(--cmd-tone) 30%, rgba(255,255,255,0.05));
  border-radius: 9px;
  background:
    radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--cmd-tone) 26%, transparent), transparent 55%),
    rgba(12, 18, 28, 0.5);
  color: color-mix(in srgb, var(--cmd-tone) 85%, white);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.cmd-ai-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cmd-md {
  position: relative;
  font-size: 14.5px;
  line-height: 1.72;
  color: rgba(255, 255, 255, 0.9);
}
.cmd-card.is-immersive .cmd-md { font-size: 15px; max-width: 760px; }

/* 中间步骤 */
.cmd-msg-step { display: flex; gap: 12px; }
.cmd-step-rail {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-top: 2px;
  opacity: 0.4;
  color: rgba(190, 230, 252, 0.5);
}
.cmd-step-body { flex: 1; min-width: 0; }
.cmd-loop-intermediate {
  display: block;
  padding: 6px 10px;
  border: 1px solid rgba(0, 217, 255, 0.09);
  border-radius: var(--radius-btn);
  background: rgba(255,255,255,0.02);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.cmd-loop-intermediate:hover { border-color: rgba(0, 217, 255, 0.16); background: rgba(255,255,255,0.04); }
.cmd-loop-intermediate.is-expanded { border-color: rgba(0, 217, 255, 0.14); background: rgba(255,255,255,0.03); }
.cmd-loop-step-num {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border: 1px solid rgba(0, 217, 255, 0.12);
  border-radius: var(--radius-tag);
  background: rgba(255,255,255,0.03);
  color: rgba(255,255,255,0.4);
  font: 700 9.5px/1 var(--hud-font-data, ui-monospace, monospace);
  white-space: nowrap;
}
.cmd-loop-step-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- 工具活动（纤薄行） ---------- */
.cmd-activities { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; }
.cmd-activities-progress { margin-bottom: 4px; }
.cmd-activity {
  --tool-tone: var(--cmd-tone);
  position: relative;
  display: block;
  padding: 7px 11px 7px 14px;
  border: 1px solid color-mix(in srgb, var(--tool-tone) 18%, rgba(0, 217, 255, 0.08));
  border-radius: var(--radius-btn);
  background: color-mix(in srgb, var(--tool-tone) 5%, rgba(12, 18, 28, 0.4));
  font-size: 12px;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.cmd-activity::before {
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 2px;
  content: '';
  background: var(--tool-tone);
  opacity: 0.4;
  transition: opacity var(--dur) var(--ease);
}
.cmd-activity:hover::before,
.cmd-activity.running::before { opacity: 0.9; }
.cmd-activity.running {
  border-color: color-mix(in srgb, var(--tool-tone) 34%, transparent);
  box-shadow: 0 0 16px color-mix(in srgb, var(--tool-tone) 9%, transparent);
}
.cmd-activity.running::before { animation: activity-pulse 1.4s ease-in-out infinite; }
@keyframes activity-pulse {
  0%, 100% { opacity: 0.42; }
  50% { opacity: 1; }
}
.cmd-activity.is-compact { padding: 6px 10px; background: rgba(12,18,28,0.3); cursor: default; }
.cmd-activity.is-error { --tool-tone: var(--hud-danger); }
.cmd-activity.is-pending { --tool-tone: var(--hud-warn); }
.cmd-activity.tool-weather { --tool-tone: #38bdf8; }
.cmd-activity.tool-task { --tool-tone: var(--cmd-run); }
.cmd-activity.tool-bug { --tool-tone: var(--hud-danger); }
.cmd-activity.tool-kb { --tool-tone: var(--hud-warn); }
.cmd-activity.tool-local { --tool-tone: #2dd4bf; }
.cmd-activity pre {
  margin: 7px 0 0;
  max-height: 160px;
  overflow: auto;
  padding: 9px;
  border: 1px solid rgba(0, 217, 255, 0.12);
  border-radius: var(--radius-btn);
  background: rgba(2, 6, 16, 0.56);
  color: rgba(190, 230, 252, 0.7);
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 11px;
}

/* 审批卡 */
.cmd-approval {
  margin-top: 8px;
  padding: 11px;
  border: 1px solid rgba(251, 191, 36, 0.22);
  border-radius: var(--radius-btn);
  background: rgba(5, 8, 15, 0.38);
}
.cmd-approval-head { display: flex; align-items: center; gap: 8px; }
.cmd-approval-head strong { color: rgba(248, 250, 252, 0.92); font-size: 12.5px; font-weight: 850; }
.cmd-approval-kicker {
  flex-shrink: 0;
  padding: 2px 7px;
  border: 1px solid rgba(251, 191, 36, 0.22);
  border-radius: var(--radius-pill);
  background: rgba(251, 191, 36, 0.1);
  color: #fde68a;
  font: 850 10px/1.35 var(--hud-font-data, ui-monospace, monospace);
}
.cmd-approval-desc, .cmd-approval-risk { margin: 7px 0 0; font-size: 11.5px; line-height: 1.55; }
.cmd-approval-desc { color: rgba(190, 230, 252, 0.66); }
.cmd-approval-risk { color: rgba(253, 230, 138, 0.86); }
.cmd-approval-args { margin-top: 8px; color: rgba(190, 230, 252, 0.44); font-size: 11px; }
.cmd-approval-args summary { width: fit-content; cursor: pointer; }
.cmd-approval-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.cmd-approval-stack { display: flex; flex-direction: column; gap: 8px; }
.cmd-approval-btn {
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-btn);
  font-size: 11.5px;
  font-weight: 800;
  cursor: pointer;
  transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease);
}
.cmd-approval-btn:hover:not(:disabled) { transform: translateY(-1px); }
.cmd-approval-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.cmd-approval-btn.is-cancel { border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.055); color: rgba(190, 230, 252, 0.66); }
.cmd-approval-btn.is-confirm { background: var(--hud-warn); color: #281705; box-shadow: 0 0 16px rgba(251, 191, 36, 0.2); }

.cmd-ui-stack { display: grid; gap: 10px; }

/* 流式光标 */
.cmd-caret {
  display: inline-block;
  width: 7px;
  height: 16px;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: color-mix(in srgb, var(--cmd-tone) 90%, white);
  border-radius: 1px;
  box-shadow: 0 0 8px color-mix(in srgb, var(--cmd-tone) 45%, transparent);
  animation: cmd-blink 1s steps(2, start) infinite;
}
@keyframes cmd-blink { 50% { opacity: 0; } }

/* 外部调研徽标 */
.cmd-ext-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0 0 10px;
  padding: 3px 9px;
  border: 1px solid rgba(251, 191, 36, 0.28);
  border-radius: var(--radius-pill);
  background: linear-gradient(180deg, rgba(251, 191, 36, 0.13), rgba(251, 191, 36, 0.06));
  color: rgba(253, 230, 138, 0.92);
  font-size: 10.5px;
  font-weight: 750;
}

/* 浮起操作条（hover 胶囊） */
.cmd-action-bar {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin-top: 8px;
  padding: 3px;
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: var(--radius-btn);
  background: rgba(12, 18, 28, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  opacity: 0;
  transform: translateY(2px);
  transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.cmd-md:hover .cmd-action-bar,
.cmd-md:focus-within .cmd-action-bar { opacity: 1; transform: none; }
.cmd-action {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.cmd-action:hover, .cmd-action:focus-visible { color: #fff; background: rgba(255,255,255,0.1); outline: 0; }
.cmd-quality-tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  margin-right: 4px;
  padding: 0 7px;
  border: 1px solid color-mix(in srgb, var(--cmd-run) 22%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--cmd-run) 9%, transparent);
  color: rgba(125, 240, 180, 0.8);
  font-size: 10.5px;
  font-weight: 750;
}

/* 继续调研 chip */
.cmd-followups { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.cmd-followup-chip {
  padding: 4px 10px;
  border: 1px solid rgba(0, 217, 255, 0.16);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(190, 230, 252, 0.72);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.cmd-followup-chip:hover {
  border-color: color-mix(in srgb, var(--cmd-tone) 34%, transparent);
  background: color-mix(in srgb, var(--cmd-tone) 12%, rgba(255, 255, 255, 0.05));
  color: #fff;
  transform: translateY(-1px);
}

/* 等待三点 */
.cmd-waiting { display: inline-flex; align-items: center; gap: 5px; padding: 6px 0; }
.cmd-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--cmd-tone) 82%, white);
  box-shadow: 0 0 8px color-mix(in srgb, var(--cmd-tone) 40%, transparent);
  animation: cmd-bounce 1.2s infinite ease-in-out;
}
@keyframes cmd-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-4px); opacity: 1; }
}
.cmd-executing-label { margin-top: 2px; color: rgba(190, 230, 252, 0.35); font-size: 11px; }

/* jump-to-latest */
.cmd-jump-latest { margin-top: -40px; margin-bottom: 8px; pointer-events: none; }
.cmd-jump-latest-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  max-width: min(100%, 220px);
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--cmd-tone) 32%, rgba(255,255,255,0.08));
  border-radius: var(--radius-pill);
  background: rgba(10, 14, 22, 0.88);
  color: rgba(190, 230, 252, 0.88);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 10px 28px rgba(2, 6, 16, 0.32);
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.cmd-jump-latest-btn:hover, .cmd-jump-latest-btn:focus-visible {
  color: #fff;
  border-color: color-mix(in srgb, var(--cmd-tone) 52%, rgba(255,255,255,0.18));
  outline: 0;
  transform: translateY(-1px);
}

/* 错误条 */
.cmd-error-bar { backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }

/* ---------- 空态：助理主页 ---------- */
.cmd-empty { padding: 18px 16px; }
.cmd-card.is-immersive .cmd-empty { padding: clamp(36px, 6vw, 72px) clamp(18px, 6vw, 80px); }
.cmd-empty-inner { width: 100%; max-width: 560px; margin: 0 auto; }
.cmd-empty-hero { text-align: center; margin-bottom: 30px; }
.cmd-empty-avatar {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  border: 1px solid color-mix(in srgb, var(--cmd-tone) 34%, rgba(255,255,255,0.06));
  border-radius: 18px;
  background:
    radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--cmd-tone) 34%, transparent), transparent 55%),
    rgba(12, 18, 28, 0.6);
  color: color-mix(in srgb, var(--cmd-tone) 88%, white);
  box-shadow: 0 0 32px color-mix(in srgb, var(--cmd-tone) 18%, transparent), inset 0 1px 0 rgba(255,255,255,0.08);
  animation: empty-pulse 3s ease-in-out infinite;
}
@keyframes empty-pulse {
  0%, 100% { box-shadow: 0 0 28px color-mix(in srgb, var(--cmd-tone) 14%, transparent), inset 0 1px 0 rgba(255,255,255,0.08); }
  50% { box-shadow: 0 0 40px color-mix(in srgb, var(--cmd-tone) 26%, transparent), inset 0 1px 0 rgba(255,255,255,0.1); }
}
.cmd-empty-greeting { margin: 0; color: rgba(248, 250, 252, 0.95); font-size: 18px; font-weight: 700; }
.cmd-empty-sub { margin: 7px 0 0; color: rgba(190, 230, 252, 0.42); font-size: 12.5px; }
.cmd-empty-suggestions { display: grid; gap: 8px; }
.cmd-suggestion {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 13px;
  border: 1px solid rgba(0, 217, 255, 0.1);
  border-radius: var(--radius-btn);
  background: rgba(255,255,255,0.022);
  color: rgba(255,255,255,0.78);
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease), background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.cmd-suggestion svg { color: color-mix(in srgb, var(--cmd-tone) 75%, white); }
.cmd-suggestion:last-child svg { color: rgba(190, 230, 252, 0.3); }
.cmd-suggestion:hover, .cmd-suggestion:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--cmd-tone) 32%, transparent);
  background: color-mix(in srgb, var(--cmd-tone) 9%, rgba(12, 18, 28, 0.46));
  color: #fff;
  outline: 0;
}

/* ---------- 引用 / 待发图片 ---------- */
.quote-preview {
  border-left: 3px solid color-mix(in srgb, var(--cmd-tone) 68%, transparent);
  background: rgba(12, 18, 28, 0.5);
}
.cmd-pending-bar { border-top: 1px solid var(--cmd-border); background: rgba(12, 18, 28, 0.4); min-height: 0; padding: 8px 16px; }
.cmd-pending-thumb {
  position: relative;
  width: 50px;
  height: 50px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: var(--radius-btn);
  background: rgba(0,0,0,0.24);
}
.cmd-pending-thumb img { width: 100%; height: 100%; object-fit: cover; cursor: zoom-in; }
.cmd-pending-x {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  color: rgba(255,255,255,0.9);
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.65));
  opacity: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  transition: opacity var(--dur) var(--ease);
}
.cmd-pending-thumb:hover .cmd-pending-x { opacity: 1; }

/* ---------- 胶囊合成器 ---------- */
.cmd-input-wrapper {
  padding: 10px 14px 6px;
  transition: background var(--dur) var(--ease);
}
.cmd-card.is-immersive .cmd-input-wrapper {
  padding: 12px clamp(16px, 6vw, 80px) max(14px, env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(5, 9, 18, 0), rgba(5, 9, 18, 0.5) 30%, rgba(5, 9, 18, 0.9));
}
.cmd-input-wrapper.is-drag-img { background: color-mix(in srgb, var(--cmd-tone) 7%, rgba(5, 8, 15, 0.34)); }
.cmd-composer-rail {
  display: flex;
  max-width: 820px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 auto 8px;
}
.cmd-mode-tabs, .cmd-context-rail { display: inline-flex; min-width: 0; align-items: center; gap: 6px; }
.cmd-context-rail { overflow-x: auto; padding-bottom: 1px; }
.cmd-mode-tab, .cmd-context-chip {
  display: inline-flex;
  min-height: 28px;
  flex-shrink: 0;
  align-items: center;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: rgba(190, 230, 252, 0.52);
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.cmd-mode-tab.is-active {
  border-color: rgba(125, 211, 252, 0.2);
  background: rgba(0, 217, 255, 0.09);
  color: rgba(186, 230, 253, 0.92);
}
.cmd-context-chip:hover:not(:disabled), .cmd-context-chip:focus-visible, .cmd-mode-tab:hover, .cmd-mode-tab:focus-visible {
  color: #fff;
  border-color: color-mix(in srgb, var(--cmd-tone) 30%, transparent);
  background: color-mix(in srgb, var(--cmd-tone) 9%, rgba(255,255,255,0.06));
  outline: 0;
}
.cmd-context-chip:disabled { cursor: not-allowed; opacity: 0.45; }

.cmd-composer {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 8px 8px 16px;
  border: 1px solid rgba(0, 217, 255, 0.16);
  border-radius: var(--radius-card);
  background: rgba(12, 18, 28, 0.62);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), background var(--dur) var(--ease);
}
.cmd-card.is-immersive .cmd-composer { max-width: 820px; margin: 0 auto; min-height: 56px; }
.cmd-input-wrapper:focus-within .cmd-composer {
  border-color: color-mix(in srgb, var(--cmd-tone) 46%, transparent);
  background: rgba(12, 18, 28, 0.7);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cmd-tone) 14%, transparent), inset 0 1px 0 rgba(255,255,255,0.05);
}
.cmd-input-wrapper.is-drag-img .cmd-composer {
  border-color: color-mix(in srgb, var(--cmd-tone) 56%, rgba(255,255,255,0.18));
  background: color-mix(in srgb, var(--cmd-tone) 8%, rgba(12, 18, 28, 0.68));
}
.cmd-composer.is-disabled { opacity: 0.7; }
.cmd-input {
  appearance: none;
  -webkit-appearance: none;
  flex: 1;
  min-height: 30px;
  border: 0;
  resize: none;
  overflow-y: auto;
  padding: 6px 0;
  box-shadow: none;
  font: inherit;
  transition: height 0.15s ease-out;
}
.cmd-input:focus, .cmd-input:focus-visible { background: transparent; box-shadow: none; outline: 0; }
.cmd-input::placeholder { color: rgba(190, 230, 252, 0.34); }
.cmd-input:disabled { cursor: not-allowed; }

.cmd-send {
  display: grid;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: var(--cmd-tone);
  color: rgba(5, 8, 15, 0.95);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--cmd-tone) 22%, transparent), inset 0 1px 0 rgba(255,255,255,0.25);
  cursor: pointer;
  transition: transform var(--dur) var(--ease), background var(--dur) var(--ease), opacity var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.cmd-send:hover:not(:disabled), .cmd-send:focus-visible:not(:disabled) {
  transform: translateY(-1px) scale(1.04);
  background: color-mix(in srgb, var(--cmd-tone) 92%, white 8%);
  outline: 0;
}
.cmd-send:active:not(:disabled) { transform: scale(0.96); }
.cmd-send:disabled {
  cursor: not-allowed;
  opacity: 0.35;
  background: rgba(148, 163, 184, 0.2);
  color: rgba(190, 230, 252, 0.5);
  box-shadow: none;
}
.cmd-send.is-stop {
  background: linear-gradient(180deg, rgba(251,113,133,0.96), rgba(225,29,72,0.92));
  color: white;
  box-shadow: 0 8px 20px rgba(244,63,94,0.24), inset 0 1px 0 rgba(255,255,255,0.2);
}

/* 底部快捷键提示 */
.cmd-footer {
  display: flex;
  justify-content: center;
  padding: 6px 0 2px;
  color: rgba(190, 230, 252, 0.28);
  font-size: 10.5px;
}
.cmd-footer-hint { display: inline-flex; align-items: center; gap: 4px; }
.cmd-footer-hint kbd {
  padding: 1px 5px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: var(--radius-tag);
  background: rgba(255,255,255,0.05);
  color: rgba(190, 230, 252, 0.5);
  font: 600 10px/1.4 var(--hud-font-data, ui-monospace, monospace);
}
.cmd-footer-sep { color: rgba(255,255,255,0.16); margin: 0 2px; }
.cmd-footer-stats { margin-left: auto; color: rgba(190,230,252,0.3); font-size: 11px; white-space: nowrap; }

/* ---------- 沉浸式侧栏 ---------- */
.cmd-workspace-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 20px 20px 20px 16px;
  background: linear-gradient(180deg, rgba(9, 12, 18, 0.7), rgba(6, 9, 16, 0.82));
}
.cmd-side-section { padding: 2px 0 16px; border-bottom: 1px solid rgba(0, 217, 255, 0.09); }
.cmd-side-section:last-child { border-bottom: 0; }
.cmd-side-head { display: flex; align-items: center; gap: 7px; color: rgba(125, 211, 252, 0.7); font-size: 11px; font-weight: 850; }
.cmd-side-title { margin-top: 9px; color: rgba(248, 250, 252, 0.92); font-size: 13px; font-weight: 800; line-height: 1.45; }
.cmd-side-metrics { display: flex; margin-top: 14px; padding: 10px 0; border-top: 1px solid rgba(0, 217, 255, 0.08); border-bottom: 1px solid rgba(0, 217, 255, 0.08); }
.cmd-side-metrics div { flex: 1; min-width: 0; padding: 0 8px; border-right: 1px solid rgba(0, 217, 255, 0.08); }
.cmd-side-metrics div:last-child { border-right: 0; }
.cmd-side-metrics strong { display: block; color: rgba(255,255,255,0.94); font-size: 15px; line-height: 1; }
.cmd-side-metrics span { display: block; margin-top: 4px; color: rgba(190, 230, 252, 0.38); font-size: 10px; }
.cmd-side-chipgrid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 11px; }
.cmd-side-chip {
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid rgba(0, 217, 255, 0.075);
  border-radius: var(--radius-pill);
  background: transparent;
  color: rgba(190, 230, 252, 0.54);
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.cmd-side-chip:hover:not(:disabled), .cmd-side-chip:focus-visible {
  color: #fff;
  border-color: color-mix(in srgb, var(--cmd-tone) 34%, transparent);
  background: color-mix(in srgb, var(--cmd-tone) 10%, rgba(255,255,255,0.05));
  outline: 0;
}
.cmd-side-chip:disabled { cursor: not-allowed; opacity: 0.46; }
.cmd-side-timeline { display: grid; gap: 10px; margin-top: 13px; }
.cmd-side-activity { display: grid; grid-template-columns: 11px minmax(0, 1fr); gap: 8px; align-items: start; }
.cmd-side-dot { width: 8px; height: 8px; margin-top: 5px; border-radius: 999px; background: rgba(148, 163, 184, 0.5); box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.08); }
.cmd-side-activity.running .cmd-side-dot { background: var(--cmd-tone); box-shadow: 0 0 0 3px rgba(0, 217, 255, 0.12), 0 0 12px rgba(0, 217, 255, 0.28); }
.cmd-side-activity.done .cmd-side-dot { background: var(--cmd-run); }
.cmd-side-activity.error .cmd-side-dot { background: var(--hud-danger); }
.cmd-side-activity.pending .cmd-side-dot { background: var(--hud-warn); }
.cmd-side-activity-title { overflow: hidden; color: rgba(248, 250, 252, 0.76); font-size: 12px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.cmd-side-activity-sub, .cmd-side-empty { margin-top: 2px; color: rgba(190, 230, 252, 0.36); font-size: 11px; line-height: 1.4; }

/* ---------- 拖拽缩放 ---------- */
.resize-handle {
  display: flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-bottom-right-radius: var(--radius-card);
  opacity: 0.5;
  cursor: se-resize;
  transition: opacity var(--dur) var(--ease);
}
.resize-handle:hover { opacity: 0.95; }
.resize-icon { width: 10px; height: 10px; fill: rgba(255,255,255,0.5); }
.resize-handle:hover .resize-icon { fill: color-mix(in srgb, var(--cmd-tone) 86%, white); }
.is-resizing, .is-resizing * { cursor: se-resize !important; user-select: none; -webkit-user-select: none; }

/* ---------- 过渡 ---------- */
.content-fade-enter-active, .content-fade-leave-active,
.quote-fade-enter-active, .quote-fade-leave-active,
.activity-expand-enter-active, .activity-expand-leave-active { transition: all var(--dur) var(--ease); }
.content-fade-enter-from, .content-fade-leave-to,
.quote-fade-enter-from, .quote-fade-leave-to,
.activity-expand-enter-from, .activity-expand-leave-to { opacity: 0; transform: translateY(-4px); }
.activity-expand-enter-active, .activity-expand-leave-active { overflow: hidden; }
.activity-expand-enter-from, .activity-expand-leave-to { max-height: 0; margin-top: 0; padding-top: 0; }
.activity-expand-enter-to, .activity-expand-leave-from { max-height: 220px; }
.cmd-fade-enter-active, .cmd-fade-leave-active { transition: opacity var(--dur) var(--ease); }
.cmd-fade-enter-from, .cmd-fade-leave-to { opacity: 0; }
.cmd-pop-enter-active { transition: opacity var(--dur) var(--ease), transform var(--dur) cubic-bezier(0.22, 1, 0.36, 1); }
.cmd-pop-leave-active { transition: opacity 0.16s var(--ease), transform 0.16s var(--ease); }
.cmd-pop-enter-from { opacity: 0; transform: translateY(-12px) scale(0.96); }
.cmd-pop-leave-to { opacity: 0; transform: translateY(-8px) scale(0.98); }
.cmd-jump-enter-active, .cmd-jump-leave-active { transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease); }
.cmd-jump-enter-from, .cmd-jump-leave-to { opacity: 0; transform: translateY(6px); }

/* ---------- Markdown（无框，仅内容） ---------- */
.cmd-md :deep(.md-content > :first-child) { margin-top: 0; }
.cmd-md :deep(.md-content > :last-child) { margin-bottom: 0; }
.cmd-md :deep(p) { margin: 0.5em 0; }
.cmd-md :deep(h1), .cmd-md :deep(h2), .cmd-md :deep(h3), .cmd-md :deep(h4) {
  margin: 0.8em 0 0.35em; color: rgba(255,255,255,0.97); font-weight: 700; line-height: 1.3;
}
.cmd-md :deep(h1) { font-size: 1.2em; }
.cmd-md :deep(h2) { font-size: 1.12em; }
.cmd-md :deep(h3) { font-size: 1.05em; }
.cmd-md :deep(ul), .cmd-md :deep(ol) { margin: 0.5em 0; padding-left: 1.4em; }
.cmd-md :deep(ul) { list-style: disc; }
.cmd-md :deep(ol) { list-style: decimal; }
.cmd-md :deep(li) { margin: 0.26em 0; }
.cmd-md :deep(li::marker) { color: color-mix(in srgb, var(--cmd-tone) 72%, transparent); }
.cmd-md :deep(a) { color: rgb(125 211 252); text-decoration: underline; text-underline-offset: 2px; }
.cmd-md :deep(strong) { color: rgba(255,255,255,0.98); font-weight: 700; }
.cmd-md :deep(em) { font-style: italic; }
.cmd-md :deep(code) {
  padding: 0.1em 0.36em;
  border-radius: var(--radius-tag);
  background: color-mix(in srgb, var(--cmd-tone) 12%, rgba(255,255,255,0.08));
  color: color-mix(in srgb, var(--cmd-tone) 85%, white);
  font-family: var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 0.86em;
}
.cmd-md :deep(.code-block-wrapper) { position: relative; margin: 0.7em 0; }
.cmd-md :deep(.code-block-header) {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  border: 1px solid rgba(0, 217, 255, 0.12);
  border-bottom: none;
  border-radius: var(--radius-btn) var(--radius-btn) 0 0;
  background: rgba(2, 6, 16, 0.5);
  color: rgba(255,255,255,0.52);
  font-size: 12px;
}
.cmd-md :deep(.code-lang) { color: color-mix(in srgb, var(--cmd-tone) 84%, white); font-weight: 700; }
.cmd-md :deep(.code-line-count) { opacity: 0.5; font-size: 11px; }
.cmd-md :deep(.code-copy-btn) {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: var(--radius-tag);
  background: rgba(255,255,255,0.07);
  color: rgba(255,255,255,0.62);
  cursor: pointer;
  font-size: 11px;
  transition: all var(--dur) var(--ease);
}
.cmd-md :deep(.code-copy-btn:hover) { background: color-mix(in srgb, var(--cmd-tone) 16%, transparent); color: rgba(255,255,255,0.92); }
.cmd-md :deep(.code-copy-btn:disabled) { cursor: not-allowed; border-color: rgba(0, 217, 255, 0.08); background: rgba(0, 217, 255, 0.07); color: rgba(190, 230, 252, 0.34); }
.cmd-md :deep(.code-copy-btn:disabled:hover) { background: rgba(0, 217, 255, 0.07); color: rgba(190, 230, 252, 0.34); }
.cmd-md :deep(.code-copy-btn.copied) { background: rgba(0,255,148,0.14); color: rgb(125 240 180); }
.cmd-md :deep(.code-copy-btn.copy-failed) { background: rgba(251,113,133,0.14); color: rgb(253 164 175); }
.cmd-md :deep(pre) {
  margin: 0; overflow-x: auto;
  padding: 0.8em 0.9em;
  border: 1px solid rgba(0, 217, 255, 0.12);
  border-top: none;
  border-radius: 0 0 var(--radius-btn) var(--radius-btn);
  background: rgba(0,0,0,0.4);
}
.cmd-md :deep(pre code) { display: block; padding: 0; background: transparent; color: rgba(255,255,255,0.86); white-space: pre; }
.cmd-md :deep(blockquote) {
  margin: 0.55em 0; padding: 0.25em 0.9em;
  border-left: 3px solid color-mix(in srgb, var(--cmd-tone) 48%, transparent);
  color: rgba(255,255,255,0.72);
}
.cmd-md :deep(hr) { margin: 0.8em 0; border: none; border-top: 1px solid rgba(255,255,255,0.12); }
.cmd-md :deep(table) { width: 100%; margin: 0.6em 0; overflow: hidden; border-collapse: collapse; border-radius: var(--radius-btn); font-size: 0.92em; }
.cmd-md :deep(th), .cmd-md :deep(td) { border: 1px solid rgba(255,255,255,0.1); padding: 0.45em 0.7em; text-align: left; }
.cmd-md :deep(th) { position: sticky; z-index: 1; top: 0; background: color-mix(in srgb, var(--cmd-tone) 15%, rgba(2,6,16,0.6)); color: rgba(255,255,255,0.95); font-weight: 700; }
.cmd-md :deep(tr:nth-child(even)) { background: rgba(255,255,255,0.03); }
.cmd-md :deep(tr:nth-child(odd)) { background: rgba(255,255,255,0.01); }
.cmd-md :deep(tr:hover) { background: color-mix(in srgb, var(--cmd-tone) 8%, transparent); }

/* ---------- 响应式 ---------- */
@media (max-width: 760px) {
  .cmd-shell { padding: 0; }
  .cmd-shell.is-immersive { padding: 0; }
  .cmd-card { border-radius: 0; border: 0; min-height: 100dvh; }
  .cmd-header { padding: 10px 12px; gap: 8px; }
  .cmd-model-chip { max-width: 44vw; }
  .cmd-head-stats { display: none; }
  .cmd-iconbtn { width: 30px; height: 30px; }
  .cmd-card.is-immersive .cmd-body-shell.has-sidebar { grid-template-columns: minmax(0, 1fr); }
  .cmd-workspace-side { display: none; }
  .cmd-stream, .cmd-card.is-immersive .cmd-stream { padding: 14px 12px 8px; }
  .cmd-msg-body { max-width: 88%; }
  .cmd-composer-rail { flex-direction: column; align-items: stretch; gap: 7px; }
  .cmd-mode-tabs, .cmd-context-rail { width: 100%; overflow-x: auto; }
  .cmd-input-wrapper, .cmd-card.is-immersive .cmd-input-wrapper { padding: 8px 12px 6px; }
  .cmd-footer-hint { display: none; }
}

/* ---------- reduced motion ---------- */
@media (prefers-reduced-motion: reduce) {
  .cmd-accent, .cmd-accent.is-streaming, .cmd-dot, .cmd-caret, .cmd-empty-avatar,
  .cmd-activity.running::before,
  .cmd-fade-enter-active, .cmd-fade-leave-active, .cmd-pop-enter-active, .cmd-pop-leave-active,
  .quote-fade-enter-active, .quote-fade-leave-active, .content-fade-enter-active, .content-fade-leave-active,
  .activity-expand-enter-active, .activity-expand-leave-active,
  .cmd-jump-enter-active, .cmd-jump-leave-active {
    animation: none !important;
    transition: none !important;
  }
  .cmd-suggestion:hover, .cmd-send:hover:not(:disabled), .cmd-followup-chip:hover,
  .cmd-jump-latest-btn:hover, .cmd-action-bar { transform: none; }
}

/* v3 layout: preserve the electric HUD language, rebuild modal and immersive composition. */
.cmd-header {
  min-height: 56px;
  padding: 10px 16px;
}
.cmd-model-chip { max-width: min(320px, 42vw); }
.cmd-card:not(.is-immersive) .cmd-stream,
.cmd-card:not(.is-immersive) .cmd-empty { padding-inline: 24px; }
.cmd-card:not(.is-immersive) .cmd-input-wrapper { padding-inline: 20px; }

.cmd-session-rail { display: none; }
.cmd-card.is-immersive .cmd-body-shell {
  grid-template-columns: 232px minmax(0, 1fr);
}
.cmd-card.is-immersive .cmd-body-shell.has-sidebar {
  grid-template-columns: 232px minmax(0, 1fr) minmax(280px, 316px);
}
.cmd-card.is-immersive .cmd-session-rail {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  padding: 20px 14px;
  border-right: 1px solid rgba(0, 217, 255, .1);
  background:
    radial-gradient(circle at 20% 0%, rgba(0, 217, 255, .07), transparent 36%),
    linear-gradient(180deg, rgba(8, 12, 19, .86), rgba(5, 8, 14, .92));
}
.cmd-session-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 6px;
  color: rgba(190, 230, 252, .44);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: .04em;
}
.cmd-session-head strong {
  color: rgba(125, 211, 252, .72);
  font: 800 10px/1 var(--font-mono);
}
.cmd-session-item {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 46px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 217, 255, .1);
  border-radius: var(--radius-btn);
  background: rgba(255, 255, 255, .025);
  color: rgba(230, 246, 255, .72);
  text-align: left;
}
.cmd-session-item.is-active {
  border-color: rgba(0, 217, 255, .26);
  background: rgba(0, 217, 255, .08);
  box-shadow: inset 2px 0 0 var(--cmd-tone);
}
.cmd-session-item svg { color: rgba(0, 217, 255, .8); }
.cmd-session-item span { overflow: hidden; font-size: 11.5px; font-weight: 760; text-overflow: ellipsis; white-space: nowrap; }
.cmd-session-meta { display: grid; gap: 5px; padding: 2px 11px 10px; color: rgba(190, 230, 252, .32); font-size: 10px; }
.cmd-session-context { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
.cmd-session-context > span { grid-column: 1 / -1; margin-bottom: 2px; padding-inline: 4px; color: rgba(190, 230, 252, .38); font-size: 10px; font-weight: 760; }
.cmd-session-context button {
  min-height: 30px;
  border: 1px solid rgba(0, 217, 255, .075);
  border-radius: var(--radius-btn);
  background: rgba(255, 255, 255, .018);
  color: rgba(190, 230, 252, .5);
  font-size: 10.5px;
  font-weight: 760;
  cursor: pointer;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.cmd-session-context button:hover:not(:disabled),
.cmd-session-context button:focus-visible {
  border-color: rgba(0, 217, 255, .28);
  background: rgba(0, 217, 255, .07);
  color: #fff;
}
.cmd-session-context button:disabled { cursor: not-allowed; opacity: .42; }

.cmd-empty-inner { max-width: 720px; }
.cmd-empty-layout {
  display: grid;
  grid-template-columns: minmax(230px, .82fr) minmax(300px, 1.18fr);
  align-items: center;
  gap: 34px;
}
.cmd-empty-hero {
  margin: 0;
  padding-right: 30px;
  border-right: 1px solid rgba(0, 217, 255, .1);
  text-align: left;
}
.cmd-empty-avatar { margin: 0 0 18px; }
.cmd-empty-greeting { font-size: 20px; line-height: 1.35; }
.cmd-empty-sub { max-width: 25ch; line-height: 1.65; }
.cmd-empty-start { min-width: 0; }
.cmd-empty-start-label {
  display: block;
  margin-bottom: 9px;
  color: rgba(190, 230, 252, .38);
  font-size: 10.5px;
  font-weight: 760;
}
.cmd-empty-suggestions { gap: 7px; }
.cmd-suggestion { min-height: 44px; padding: 10px 12px; }

.cmd-card.is-immersive .cmd-stream,
.cmd-card.is-immersive .cmd-empty { padding-left: clamp(24px, 5vw, 70px); padding-right: clamp(24px, 5vw, 70px); }
.cmd-card.is-immersive .cmd-input-wrapper { padding-left: clamp(24px, 5vw, 70px); padding-right: clamp(24px, 5vw, 70px); }

@media (max-width: 1100px) {
  .cmd-card.is-immersive .cmd-body-shell,
  .cmd-card.is-immersive .cmd-body-shell.has-sidebar { grid-template-columns: minmax(0, 1fr) minmax(280px, 304px); }
  .cmd-card.is-immersive .cmd-session-rail { display: none; }
}
@media (max-width: 760px) {
  .cmd-card {
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100dvh !important;
    max-height: 100dvh !important;
  }
  .cmd-card.is-immersive .cmd-body-shell,
  .cmd-card.is-immersive .cmd-body-shell.has-sidebar { grid-template-columns: minmax(0, 1fr); }
  .cmd-session-rail, .cmd-workspace-side { display: none !important; }
  .cmd-empty-layout { grid-template-columns: 1fr; gap: 20px; }
  .cmd-empty-hero { padding: 0 0 20px; border-right: 0; border-bottom: 1px solid rgba(0, 217, 255, .1); }
  .cmd-empty-avatar { width: 52px; height: 52px; }
}


/* v4 surface calibration: align with GitDashboard / ModelConfigModal. */
.cmd-backdrop {
  background: rgba(2, 6, 23, .58);
  backdrop-filter: blur(10px) saturate(120%);
  -webkit-backdrop-filter: blur(10px) saturate(120%);
}
.cmd-card {
  --cmd-tone: #2dd4bf;
  --cmd-run: #34d399;
  --cmd-border: rgba(255, 255, 255, .1);
  --cmd-text: rgba(226, 232, 240, .78);
  --cmd-muted: rgba(203, 213, 225, .46);
  border-color: rgba(255, 255, 255, .12);
  border-radius: 20px;
  background:
    linear-gradient(160deg, rgba(30, 58, 95, .92) 0%, rgba(15, 23, 42, .94) 55%, rgba(13, 64, 64, .92) 100%),
    repeating-linear-gradient(0deg, rgba(255,255,255,.018) 0 1px, transparent 1px 28px),
    repeating-linear-gradient(90deg, rgba(255,255,255,.018) 0 1px, transparent 1px 28px);
  color: rgba(226, 232, 240, .78);
  box-shadow:
    0 24px 70px -12px rgba(0,0,0,.48),
    0 0 0 1px rgba(45,212,191,.12),
    0 0 28px -6px rgba(45,212,191,.16),
    inset 0 1px 0 rgba(255,255,255,.07);
  backdrop-filter: blur(20px) saturate(132%);
  -webkit-backdrop-filter: blur(20px) saturate(132%);
}
.cmd-card.is-immersive {
  border-radius: 0;
  background:
    linear-gradient(155deg, rgba(26, 50, 82, .97), rgba(15, 23, 42, .98) 54%, rgba(12, 57, 58, .96));
}
.cmd-accent { height: 3px; background: linear-gradient(90deg, transparent, rgba(45,212,191,.7), transparent); opacity: .62; }
.cmd-accent.is-streaming { background: linear-gradient(90deg, #14b8a6, #2dd4bf, #5eead4, #2dd4bf, #14b8a6); box-shadow: 0 0 10px rgba(45,212,191,.36); }

.cmd-header {
  border-bottom-color: rgba(255,255,255,.09);
  background:
    radial-gradient(circle at 12% 0, rgba(45,212,191,.1), transparent 35%),
    rgba(15,23,42,.38);
}
.cmd-card.is-immersive .cmd-header {
  border-bottom-color: rgba(255,255,255,.08);
  background: rgba(15,23,42,.44);
}
.cmd-brand-dot,
.cmd-ai-rail,
.cmd-empty-avatar {
  border-color: rgba(45,212,191,.28);
  background:
    radial-gradient(circle at 30% 18%, rgba(45,212,191,.22), transparent 48%),
    rgba(15,23,42,.42);
  color: rgba(94,234,212,.82);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 0 20px rgba(45,212,191,.1);
}
.cmd-status-dot { border-color: rgba(15,23,42,.92); }
.cmd-model-chip,
.cmd-head-stats span,
.cmd-iconbtn:hover,
.cmd-iconbtn:focus-visible,
.cmd-iconbtn.is-active {
  border-color: rgba(255,255,255,.09);
  background: rgba(255,255,255,.045);
}
.cmd-model-chip { color: rgba(226,232,240,.62); }
.cmd-model-chip:hover, .cmd-model-chip:focus-visible { border-color: rgba(45,212,191,.24); background: rgba(45,212,191,.08); color: rgba(241,245,249,.82); }
.cmd-model-provider { color: rgba(94,234,212,.7); }
.cmd-model-provider::after, .cmd-head-stats { color: rgba(203,213,225,.36); }
.cmd-iconbtn { color: rgba(226,232,240,.48); }
.cmd-iconbtn:hover, .cmd-iconbtn:focus-visible, .cmd-iconbtn.is-active { color: rgba(241,245,249,.82); border-color: rgba(45,212,191,.2); background: rgba(45,212,191,.075); }

.cmd-card.is-immersive .cmd-main-stage { border-right-color: rgba(255,255,255,.075); }
.cmd-card.is-immersive .cmd-session-rail {
  border-right-color: rgba(255,255,255,.08);
  background:
    radial-gradient(circle at 18% 0, rgba(45,212,191,.09), transparent 48%),
    linear-gradient(180deg, rgba(15,23,42,.62), rgba(2,6,23,.3));
}
.cmd-session-head,
.cmd-session-meta,
.cmd-session-context > span { color: rgba(203,213,225,.42); }
.cmd-session-head strong { color: rgba(94,234,212,.68); }
.cmd-session-item { border-color: rgba(255,255,255,.07); background: rgba(255,255,255,.025); color: rgba(226,232,240,.6); }
.cmd-session-item.is-active { border-color: rgba(45,212,191,.22); background: rgba(45,212,191,.07); box-shadow: inset 2px 0 0 rgba(45,212,191,.72); }
.cmd-session-item svg { color: rgba(94,234,212,.72); }
.cmd-session-context button { border-color: rgba(255,255,255,.065); background: rgba(255,255,255,.025); color: rgba(226,232,240,.48); }
.cmd-session-context button:hover:not(:disabled), .cmd-session-context button:focus-visible { border-color: rgba(45,212,191,.2); background: rgba(45,212,191,.07); color: rgba(241,245,249,.8); }
.cmd-workspace-side {
  background:
    linear-gradient(180deg, rgba(15,23,42,.54), rgba(2,6,23,.28)),
    rgba(45,212,191,.018);
}
.cmd-side-section { border-bottom-color: rgba(255,255,255,.075); }
.cmd-side-head { color: rgba(94,234,212,.62); }
.cmd-side-title, .cmd-side-activity-title { color: rgba(226,232,240,.7); }
.cmd-side-metrics { border-color: rgba(255,255,255,.075); }
.cmd-side-metrics div { border-right-color: rgba(255,255,255,.075); }
.cmd-side-metrics strong { color: rgba(241,245,249,.78); }
.cmd-side-metrics span, .cmd-side-activity-sub, .cmd-side-empty { color: rgba(203,213,225,.38); }
.cmd-side-chip { border-color: rgba(255,255,255,.065); color: rgba(226,232,240,.48); }
.cmd-side-chip:hover:not(:disabled), .cmd-side-chip:focus-visible { border-color: rgba(45,212,191,.22); background: rgba(45,212,191,.07); color: rgba(241,245,249,.8); }

.cmd-setup-title,
.cmd-empty-greeting { color: rgba(241,245,249,.84); }
.cmd-setup,
.cmd-empty-sub { color: rgba(203,213,225,.48); }
.cmd-empty-hero { border-right-color: rgba(255,255,255,.08); }
.cmd-empty-start-label { color: rgba(203,213,225,.4); }
.cmd-suggestion {
  border-color: rgba(255,255,255,.075);
  background: rgba(255,255,255,.028);
  color: rgba(226,232,240,.66);
}
.cmd-suggestion:hover, .cmd-suggestion:focus-visible { border-color: rgba(45,212,191,.22); background: rgba(45,212,191,.07); color: rgba(241,245,249,.82); }
.cmd-suggestion svg { color: rgba(94,234,212,.7); }

.cmd-msg-body {
  border: 1px solid rgba(125,211,252,.12);
  background: rgba(30,58,95,.42);
  color: rgba(226,232,240,.76);
}
.cmd-msg-time { color: rgba(203,213,225,.3); }
.cmd-md { color: rgba(226,232,240,.72); }
.cmd-md :deep(h1), .cmd-md :deep(h2), .cmd-md :deep(h3), .cmd-md :deep(h4), .cmd-md :deep(strong) { color: rgba(241,245,249,.86); }
.cmd-md :deep(p), .cmd-md :deep(li), .cmd-md :deep(blockquote) { color: rgba(226,232,240,.7); }
.cmd-md :deep(a), .cmd-md :deep(li::marker) { color: rgba(94,234,212,.78); }
.cmd-md :deep(code) { background: rgba(2,6,23,.3); color: rgba(125,211,252,.76); }
.cmd-md :deep(.code-block-header), .cmd-md :deep(pre) { border-color: rgba(255,255,255,.08); }
.cmd-md :deep(.code-block-header) { background: rgba(15,23,42,.58); color: rgba(203,213,225,.48); }
.cmd-md :deep(pre) { background: rgba(2,6,23,.4); }
.cmd-md :deep(pre code) { color: rgba(226,232,240,.72); }
.cmd-md :deep(th) { background: rgba(30,58,95,.52); color: rgba(241,245,249,.8); }
.cmd-md :deep(th), .cmd-md :deep(td) { border-color: rgba(255,255,255,.08); }
.cmd-md :deep(tr:nth-child(even)) { background: rgba(255,255,255,.025); }
.cmd-md :deep(tr:hover) { background: rgba(45,212,191,.055); }

.cmd-loop-intermediate,
.cmd-activity,
.cmd-activity.is-compact {
  border-color: rgba(255,255,255,.075);
  background: rgba(15,23,42,.3);
}
.cmd-loop-intermediate:hover,
.cmd-loop-intermediate.is-expanded,
.cmd-activity[role="button"]:hover,
.cmd-activity[role="button"]:focus-visible,
.cmd-activity.is-expanded { border-color: rgba(45,212,191,.18); background: rgba(45,212,191,.055); }
.cmd-loop-step-num { border-color: rgba(45,212,191,.14); background: rgba(255,255,255,.035); color: rgba(203,213,225,.46); }
.cmd-activity pre,
.cmd-result-preview { border-color: rgba(255,255,255,.08); background: rgba(2,6,23,.36); color: rgba(226,232,240,.62); }
.cmd-approval { background: rgba(15,23,42,.34); }
.cmd-approval-head strong { color: rgba(241,245,249,.78); }
.cmd-approval-desc { color: rgba(226,232,240,.58); }
.cmd-action-bar { border-color: rgba(255,255,255,.075); background: rgba(15,23,42,.44); }
.cmd-action { color: rgba(226,232,240,.42); }
.cmd-action:hover, .cmd-action:focus-visible { background: rgba(255,255,255,.07); color: rgba(241,245,249,.78); }
.cmd-quality-tag { color: rgba(110,231,183,.66); }
.cmd-followup-chip,
.cmd-jump-latest-btn { border-color: rgba(255,255,255,.08); background: rgba(15,23,42,.58); color: rgba(226,232,240,.58); }
.cmd-followup-chip:hover, .cmd-jump-latest-btn:hover { border-color: rgba(45,212,191,.2); background: rgba(45,212,191,.07); color: rgba(241,245,249,.8); }

.quote-preview,
.cmd-pending-bar { background: rgba(15,23,42,.38); border-color: rgba(255,255,255,.08); }
.cmd-input-wrapper { background: rgba(15,23,42,.28); }
.cmd-card.is-immersive .cmd-input-wrapper { background: linear-gradient(180deg, rgba(15,23,42,0), rgba(15,23,42,.38) 28%, rgba(15,23,42,.68)); }
.cmd-composer {
  border-color: rgba(255,255,255,.1);
  background: rgba(6,13,28,.62);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
}
.cmd-input-wrapper:focus-within .cmd-composer { border-color: rgba(45,212,191,.34); background: rgba(8,17,36,.74); box-shadow: 0 0 0 3px rgba(45,212,191,.1), inset 0 1px 0 rgba(255,255,255,.055); }
.cmd-input { color: rgba(241,245,249,.78) !important; }
.cmd-input::placeholder { color: rgba(203,213,225,.34) !important; }
.cmd-send { background: linear-gradient(180deg, #5eead4, #2dd4bf); color: rgba(4,20,22,.9); box-shadow: 0 7px 18px rgba(45,212,191,.18); }
.cmd-footer { color: rgba(203,213,225,.3); }
.cmd-footer-hint kbd { border-color: rgba(255,255,255,.08); background: rgba(255,255,255,.045); color: rgba(226,232,240,.48); }

/* Lower the remaining utility-white text without muting semantic statuses. */
.cmd-card .text-white\/25, .cmd-card .text-white\/30, .cmd-card .text-white\/35, .cmd-card .text-white\/40 { color: rgba(203,213,225,.36) !important; }
.cmd-card .text-white\/45, .cmd-card .text-white\/50, .cmd-card .text-white\/55 { color: rgba(203,213,225,.48) !important; }
.cmd-card .text-white\/70 { color: rgba(226,232,240,.64) !important; }

/* Normalize secondary copy to the ModelConfig slate scale instead of cyan-white. */
.cmd-setup-hint,
.cmd-empty-sub,
.cmd-loop-step-label,
.cmd-executing-label,
.cmd-side-activity-sub,
.cmd-side-empty,
.cmd-msg-time { color: rgba(226,232,240,.44) !important; }
.cmd-setup-title,
.cmd-empty-greeting { color: rgba(248,250,252,.84); }
.quote-preview .text-white\/50,
.quote-preview .text-white\/40 { color: rgba(226,232,240,.48) !important; }

</style>
