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
import { useWelcomeGuide } from '../welcome-guide'
import { kbEnabled } from '../tools'
import { ASSISTANT_NAME } from '../config'
import { renderMarkdown } from '../markdown'
import { useStorage } from '@/composables/useStorage'
import GenerativeUiBlock from './GenerativeUiBlock.vue'
import ConnectivityBanner from './ConnectivityBanner.vue'
import type { ChatMessage, ToolActivity } from '../types'
import IconRobot from '~icons/mdi/robot-happy-outline'
import IconClose from '~icons/mdi/close'
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
import IconSpark from '~icons/mdi/star-four-points'
import IconClip from '~icons/mdi/clipboard-list-outline'
import IconThumbUp from '~icons/mdi/thumb-up-outline'
import IconThumbDown from '~icons/mdi/thumb-down-outline'
import IconThumbUpFill from '~icons/mdi/thumb-up'
import IconThumbDownFill from '~icons/mdi/thumb-down'
import IconQuote from '~icons/mdi/format-quote-close'
import IconCloseCircle from '~icons/mdi/close-circle'

const store = useChatStore()
const { suggestions } = useWelcomeGuide()

const input = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const copiedIdx = ref(-1)

// ============ 能力标签云 ============
// 知识库标签仅在已配置时出现——未配置时点击会让用户撞上「搜不了」的尴尬。
const abilityTags = [
  { icon: IconWeather, label: '查天气', text: '北京今天的天气怎么样', color: 'tag-weather' },
  { icon: IconTask, label: '看任务', text: '看看我的待办任务', color: 'tag-task' },
  { icon: IconBug, label: '查 Bug', text: '看看我有哪些 bug', color: 'tag-bug' },
  { icon: IconClip, label: '记待办', text: '记一下明天要交周报', color: 'tag-local' },
  ...(kbEnabled
    ? [{ icon: IconSpark, label: '知识库', text: '搜索知识库：环境配置', color: 'tag-kb' }]
    : []),
]

// ============ 输入联想相关 ============
/** 联想提示词库（知识库相关词条仅在已配置时给出，避免引导用户搜不到） */
const suggestionTemplates = [
  { prefix: '查天气', full: '查一下北京今天的天气', icon: 'weather' },
  { prefix: '查一下', full: '查一下北京今天的天气', icon: 'weather' },
  { prefix: '天气', full: '北京今天的天气怎么样', icon: 'weather' },
  { prefix: '今天', full: '今天北京的天气怎么样', icon: 'weather' },
  { prefix: '明天', full: '明天北京的天气预报', icon: 'weather' },
  { prefix: '一周', full: '北京未来一周的天气预报', icon: 'weather' },
  { prefix: '我的任务', full: '看看我的待办任务', icon: 'task' },
  { prefix: '看任务', full: '看看我的待办任务', icon: 'task' },
  { prefix: '任务', full: '查看我的任务列表', icon: 'task' },
  { prefix: '待办', full: '查看我的待办任务', icon: 'task' },
  { prefix: 'bug', full: '看看我有哪些 bug', icon: 'bug' },
  { prefix: '缺陷', full: '查看我分配的缺陷', icon: 'bug' },
  ...(kbEnabled
    ? [
        { prefix: '知识库', full: '搜索知识库：环境配置', icon: 'kb' },
        { prefix: '搜一下', full: '搜索知识库：部署流程', icon: 'kb' },
        { prefix: '搜索', full: '搜索知识库：环境域名', icon: 'kb' },
        { prefix: '怎么', full: '怎么配置开发环境？请搜索知识库', icon: 'kb' },
      ]
    : []),
  { prefix: '记一下', full: '记一下明天要交周报', icon: 'local' },
  { prefix: '提醒我', full: '提醒我下午三点开会', icon: 'local' },
  { prefix: '加个待办', full: '加个待办：周报改完发群里', icon: 'local' },
  { prefix: '我的待办', full: '看看我的本地待办', icon: 'local' },
]

/** 当前的联想提示 */
const autocompleteSuggestion = ref('')
/** 是否显示联想提示 */
const showAutocomplete = ref(false)
/** 过滤后的联想列表（预留，未来可扩展下拉列表） */
const filteredSuggestions = ref<typeof suggestionTemplates>([])

/** 根据输入过滤联想 */
function filterSuggestions(input: string) {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) {
    filteredSuggestions.value = []
    autocompleteSuggestion.value = ''
    showAutocomplete.value = false
    return
  }

  const matched = suggestionTemplates.filter(s =>
    s.prefix.toLowerCase().includes(trimmed) ||
    s.full.toLowerCase().includes(trimmed)
  )
  filteredSuggestions.value = matched.slice(0, 5)

  // 幽灵补全显示的是 suggestion.slice(输入长度)，因此只有当建议
  // 确实以当前输入开头时才能拼出连贯的句子；否则会错位成乱码。
  const startMatch = matched.find(s => s.full.toLowerCase().startsWith(trimmed))
  autocompleteSuggestion.value = startMatch ? startMatch.full : ''
  showAutocomplete.value = matched.length > 0 && !!startMatch
}

/** 应用联想内容 */
function applySuggestion(suggestion?: string) {
  const text = suggestion || autocompleteSuggestion.value
  if (text) {
    input.value = text
    autoGrow()
    showAutocomplete.value = false
    nextTick(() => {
      inputEl.value?.focus()
    })
  }
}

/** 输入框失焦时延迟隐藏联想 */
function onInputBlur() {
  setTimeout(() => {
    showAutocomplete.value = false
  }, 200)
}

/** 输入框聚焦时显示联想（如果有内容） */
function onInputFocus() {
  if (input.value.trim()) {
    filterSuggestions(input.value)
  }
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
/** 单张图片上限 5MB（base64 进 HTTP 请求，过大慢且贵）；一次最多 4 张 */
const MAX_CHAT_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_CHAT_IMAGES = 4
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
  for (const file of files) {
    if (!isImage(file.type)) continue
    if (pendingImages.value.length >= MAX_CHAT_IMAGES) {
      flashImageError(`最多 ${MAX_CHAT_IMAGES} 张`)
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
  store.send(finalText, imgs)
}

// ============ 拖拽缩放相关 ============
/** 面板尺寸持久化存储 */
const panelSize = useStorage<{ width: number; height: number }>('hao123-chat-panel-size', {
  width: 680,
  height: 0, // 0 表示用默认满高（视口 70%），由 initSize 折算为具体像素
})
const isResizing = ref(false)
const startPos = ref({ x: 0, y: 0 })
const startSize = ref({ width: 680, height: 0 })
const currentSize = ref({ width: 680, height: 0 })

const MIN_WIDTH = 480
const MIN_HEIGHT = 320
// 最大宽度为视口宽度的 90%，最大高度为视口高度的 85%。
// 必须是 ref：computed 读 window.innerWidth 不产生响应式依赖，永远不会重算，
// 窗口缩放后钳制就会失效。这里在 onWindowResize 里手动刷新。
const viewportMaxWidth = () => (typeof window !== 'undefined' ? window.innerWidth * 0.9 : 900)
const viewportMaxHeight = () => (typeof window !== 'undefined' ? window.innerHeight * 0.85 : 700)
const maxWidth = ref(viewportMaxWidth())
const maxHeight = ref(viewportMaxHeight())

/** 默认面板高度：视口的 70%，限制在 [MIN_HEIGHT, maxHeight] 之间。
 * 用固定高度而非 auto，是为了让输入框始终钉在面板底部（中间对话区/空态区 flex-1 撑开、
 * 各自滚动），不会内容少时浮到中间。 */
function defaultPanelHeight() {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1000
  return Math.min(Math.max(Math.round(vh * 0.7), MIN_HEIGHT), maxHeight.value)
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
  currentSize.value = { width: 680, height: defaultPanelHeight() }
  panelSize.value = { ...currentSize.value }
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
 * Markdown 渲染缓存：历史消息按 content 命中；流式中的消息限频解析。
 * 这样既避免结束时从纯文本跳到富文本，也不会每个 token 都跑一次 markdown-it。
 */
const STREAM_MD_RENDER_INTERVAL = 80
const mdCache = new WeakMap<ChatMessage, { content: string; html: string; renderedAt: number }>()
function renderMd(m: ChatMessage, streaming = false): string {
  const cached = mdCache.get(m)
  if (cached && cached.content === m.content) return cached.html
  const now = Date.now()
  if (streaming && cached && now - cached.renderedAt < STREAM_MD_RENDER_INTERVAL) {
    return cached.html
  }
  const html = renderMarkdown(m.content)
  mdCache.set(m, { content: m.content, html, renderedAt: now })
  return html
}

// 代码块复制：markdown 经 v-html 注入的「复制」按钮不归 Vue 管事件，
// 用 document 上的事件委托处理。代码内容从相邻 <pre> 的 textContent 读回，
// 避免把代码内联进 HTML 属性（会触发换行/引号语法错误与注入）。
let codeCopyHandler: ((e: MouseEvent) => void) | null = null
function setupCodeBlockCopy() {
  codeCopyHandler = (e: MouseEvent) => {
    const btn = (e.target as HTMLElement)?.closest<HTMLButtonElement>('.code-copy-btn')
    if (!btn) return
    const code = btn.closest('.code-block-wrapper')?.querySelector('pre')?.textContent ?? ''
    const originalText = btn.textContent
    btn.textContent = '已复制'
    btn.classList.add('copied')
    navigator.clipboard.writeText(code)
      .catch(() => {
        btn.textContent = '复制失败'
        btn.classList.remove('copied')
      })
      .finally(() => {
        setTimeout(() => {
          btn.textContent = originalText
          btn.classList.remove('copied')
        }, 1500)
      })
  }
  document.addEventListener('click', codeCopyHandler)
}
/** 当前是否正在流式生成第 i 条消息（该条 content 仍在增长，用纯文本渲染避免每 token 重解析） */
function isStreamingAt(i: number): boolean {
  return !!store.streaming && i === store.messages.length - 1
}

const awaitingFirstToken = computed(() => {
  if (!store.streaming) return false
  const last = store.messages[store.messages.length - 1]
  return last?.role === 'assistant' && !last.content && !last.activities?.length && !last.ui?.length
})

const suggestionIcon = (kind: string) =>
  kind === 'weather' ? IconWeather : kind === 'task' ? IconTask : kind === 'bug' ? IconBug : kind === 'local' ? IconClip : IconSpark

// 工具类型对应的颜色类
const toolColorClass = (toolName: string) => {
  if (toolName.includes('本地待办')) return 'tool-local'
  if (toolName.includes('天气') || toolName.includes('weather')) return 'tool-weather'
  if (toolName.includes('任务') || toolName.includes('task')) return 'tool-task'
  if (toolName.includes('Bug') || toolName.includes('bug') || toolName.includes('缺陷')) return 'tool-bug'
  if (toolName.includes('知识库') || toolName.includes('kb') || toolName.includes('检索')) return 'tool-kb'
  return ''
}

function scrollToBottom(smooth = false) {
  const done = () => {
    const el = scrollEl.value
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
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

// 内容变化时滚到底。用「最后一条消息内容长度 + 活动状态 + 消息总数」作廉价信号，
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
  () => scrollToBottom(),
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

/** 输入框最大高度（面板高度的 40%，最小 160px） */
const maxInputHeight = computed(() => {
  const panelHeight = currentSize.value.height > 0
    ? currentSize.value.height
    : Math.min(600, maxHeight.value) // 默认自适应高度下用 600px 作基准
  return Math.max(panelHeight * 0.4, 160)
})

function autoGrow() {
  const el = inputEl.value
  if (!el) return

  // 先重置高度以获取真实 scrollHeight
  el.style.height = 'auto'
  const scrollH = el.scrollHeight
  const maxH = maxInputHeight.value

  // 小于等于 3 行时（约 66px），保持 1 行
  // 超过 3 行时平滑扩展到最大高度
  if (scrollH <= 66) {
    el.style.height = 'auto'
  } else {
    el.style.height = Math.min(scrollH, maxH) + 'px'
  }
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

function onEnter(e: KeyboardEvent) {
  // Tab = 应用联想补全
  if (e.key === 'Tab' && showAutocomplete.value && autocompleteSuggestion.value) {
    e.preventDefault()
    applySuggestion()
    return
  }

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
  try {
    await navigator.clipboard.writeText(text)
    copiedIdx.value = idx
    setTimeout(() => {
      if (copiedIdx.value === idx) copiedIdx.value = -1
    }, 1600)
  } catch {
    /* 忽略剪贴板失败 */
  }
}

function isLastAssistant(idx: number): boolean {
  for (let i = store.messages.length - 1; i >= 0; i--) {
    const m = store.messages[i]
    if (m.role === 'assistant') return i === idx
    if (m.role === 'user') return false
  }
  return false
}

const activityIcon = (s: ToolActivity['status']) =>
  s === 'running' ? IconLoading : s === 'pending' ? IconAlert : s === 'error' ? IconAlert : IconCheck

// 初始化尺寸监听
onMounted(() => {
  initSize()
  window.addEventListener('resize', onWindowResize)
  setupCodeBlockCopy()
})

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.removeEventListener('mouseleave', onResizeEnd)
  if (codeCopyHandler) document.removeEventListener('click', codeCopyHandler)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="cmd-fade">
      <div
        v-if="store.open"
        class="fixed inset-0 z-[60] flex justify-center px-4 pt-[8vh] pb-[6vh]"
      >
        <!-- 遮罩 -->
        <div class="absolute inset-0 bg-slate-950/55 backdrop-blur-[3px]" @click="store.close()" />

        <!-- 命令面板卡片 -->
        <Transition name="cmd-pop" appear>
          <section
            v-if="store.open"
            ref="panelEl"
            class="cmd-card relative z-10 flex flex-col overflow-hidden"
            :class="{ 'is-resizing': isResizing }"
            :style="{
              width: currentSize.width + 'px',
              maxWidth: maxWidth + 'px',
              height: currentSize.height > 0 ? currentSize.height + 'px' : 'auto',
              maxHeight: maxHeight + 'px',
            }"
            @click.stop
          >
            <div class="cmd-corners" aria-hidden="true" />
            <div class="cmd-accent" />

            <!-- 对话流 / 空态 -->
            <Transition name="content-fade" mode="out-in">
              <div
                v-if="store.hasMessages || store.error || !store.configured"
                ref="scrollEl"
                class="relative z-10 flex-1 min-h-0 overflow-y-auto px-4 py-5 cmd-scroll"
              >
                <!-- 未配置 -->
                <div v-if="!store.configured" class="flex flex-col items-center gap-2 py-10 text-center text-white/55">
                  <IconAlert class="w-8 h-8 text-amber-300/70" />
                  <p class="text-sm text-white/75">尚未接入 LLM</p>
                  <p class="text-xs text-white/40 max-w-[18rem]">在项目 .env 中配置 VITE_DEEPSEEK_API_KEY 并重启开发服务后即可对话</p>
                </div>

                <!-- 消息列表 -->
                <div class="space-y-5">
                  <template v-for="(m, i) in store.messages" :key="i">
                <!-- 用户 -->
                <div v-if="m.role === 'user'" class="flex flex-col items-end gap-1">
                  <div class="cmd-bubble-user max-w-[80%]">
                    <div v-if="m.images?.length" class="cmd-user-images">
                      <img
                        v-for="(img, ii) in m.images"
                        :key="ii"
                        :src="img"
                        class="cmd-user-img"
                        alt="发送的图片"
                        @click="previewImage = img"
                      >
                    </div>
                    <span v-if="m.content" class="whitespace-pre-wrap">{{ m.content }}</span>
                  </div>
                  <span class="text-[10px] text-white/25 pr-1">{{ formatMessageTime(m.ts) }}</span>
                </div>

                <!-- 助手 -->
                <div v-else-if="m.role === 'assistant' && (m.content || m.activities?.length || m.ui?.length)" class="flex gap-2.5">
                  <div class="flex flex-col items-center gap-1">
                    <div class="cmd-avatar-sm shrink-0 mt-0.5">
                      <IconRobot class="w-4 h-4" />
                    </div>
                  </div>
                  <div class="flex-1 min-w-0 space-y-2">
                    <!-- 工具活动卡 -->
                    <div v-if="m.activities?.length" class="space-y-1.5">
                      <!-- 整体进度条（多工具并行时显示） -->
                      <div v-if="m.activities.filter((a) => a.status === 'running').length > 1" class="mb-2">
                        <div class="flex items-center justify-between text-[10px] text-white/40 mb-1">
                          <span>正在并行查询</span>
                          <span>{{ m.activities.filter((a) => a.status === 'done').length }}/{{ m.activities.length }}</span>
                        </div>
                        <div class="h-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            class="h-full bg-gradient-to-r from-teal-400 to-sky-400 transition-all duration-300 ease-out"
                            :style="{ width: `${(m.activities.filter((a) => a.status === 'done').length / m.activities.length) * 100}%` }"
                          />
                        </div>
                      </div>

                      <div
                        v-for="(a, ai) in m.activities"
                        :key="ai"
                        class="cmd-activity cursor-pointer"
                        :class="[toolColorClass(a.label), a.status, { 'is-error': a.status === 'error', 'is-pending': a.status === 'pending', 'is-expanded': a.expanded }]"
                        @click="store.toggleActivityExpand(i, ai)"
                      >
                        <div class="flex items-center w-full">
                          <component
                            :is="activityIcon(a.status)"
                            class="w-3.5 h-3.5 shrink-0"
                            :class="{
                              'animate-spin text-teal-300/80': a.status === 'running',
                              'text-amber-300/90': a.status === 'pending',
                              'text-emerald-300/80': a.status === 'done',
                              'text-rose-300/80': a.status === 'error',
                            }"
                          />
                          <span class="text-white/70">{{ a.label }}</span>
                          <span v-if="a.detail" class="text-white/35 truncate">· {{ a.detail }}</span>
                          <span class="ml-auto text-[10px] text-white/30 shrink-0 flex items-center gap-1">
                            <span v-if="a.status === 'running'">查询中</span>
                            <span v-else-if="a.status === 'pending'" class="text-amber-300/80">待确认</span>
                            <span v-else-if="a.status === 'error'">{{ a.approval?.decision === 'rejected' ? '已取消' : '失败' }}</span>
                            <template v-else>
                              <span class="text-emerald-300/60">✓</span>
                              <span v-if="a.duration">{{ formatDuration(a.duration) }}</span>
                              <span v-else>完成</span>
                            </template>
                          </span>
                          <!-- 展开/收起箭头 -->
                          <svg
                            v-if="a.result"
                            class="w-3 h-3 ml-1 text-white/30 transition-transform duration-200"
                            :class="{ 'rotate-180': a.expanded }"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                          <!-- 重试按钮（失败时显示） -->
                          <button
                            v-if="a.status === 'error' && !a.approval && !store.streaming"
                            class="ml-2 px-2 py-0.5 text-[10px] text-rose-300/80 bg-rose-400/10 hover:bg-rose-400/20 rounded transition-colors"
                            @click.stop="store.retryTool(i, ai)"
                          >
                            重试
                          </button>
                        </div>

                        <!-- 产品级审批卡：危险工具只有用户确认后才真正执行 -->
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
                            <button
                              class="cmd-approval-btn is-cancel"
                              :disabled="store.streaming"
                              @click="store.rejectTool(i, ai)"
                            >
                              取消
                            </button>
                            <button
                              class="cmd-approval-btn is-confirm"
                              :disabled="store.streaming"
                              @click="store.approveTool(i, ai)"
                            >
                              确认执行
                            </button>
                          </div>
                        </div>

                        <!-- 展开的结果预览 -->
                        <Transition name="activity-expand">
                          <div v-if="a.expanded && a.result" class="mt-2 pt-2 border-t border-white/10">
                            <div class="text-[10px] text-white/40 mb-1.5">返回结果预览</div>
                            <pre class="text-[11px] text-white/70 bg-black/30 p-2 rounded-md max-h-[180px] overflow-auto whitespace-pre-wrap break-all">{{ formatJsonPreview(a.result) }}</pre>
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

                    <!-- 正文：流式中也走 Markdown 渲染，避免结束时从纯文本跳变到富文本 -->
                    <div v-if="m.content" class="cmd-bubble-ai cmd-md group">
                      <span v-html="renderMd(m, isStreamingAt(i))" class="md-content" />
                      <span v-if="isStreamingAt(i)" class="cmd-caret" />

                      <div
                        v-if="!isStreamingAt(i)"
                        class="cmd-actions"
                      >
                        <span class="cmd-quality-tag" :title="`反馈归因：${store.categoryLabel(m.qualityCategory)}`">
                          {{ store.categoryLabel(m.qualityCategory) }}
                        </span>
                        <button class="cmd-action" :title="copiedIdx === i ? '已复制' : '复制'" @click="copy(m.content, i)">
                          <IconCheck v-if="copiedIdx === i" class="w-3.5 h-3.5 text-emerald-300/80" />
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
                        <button
                          class="cmd-action"
                          :title="m.feedback === 'up' ? '已赞' : '有用'"
                          @click="store.rate(i, 'up')"
                        >
                          <IconThumbUpFill v-if="m.feedback === 'up'" class="w-3.5 h-3.5 text-emerald-300/80" />
                          <IconThumbUp v-else class="w-3.5 h-3.5" />
                        </button>
                        <button
                          class="cmd-action"
                          :title="m.feedback === 'down' ? '已踩' : '没用'"
                          @click="store.rate(i, 'down')"
                        >
                          <IconThumbDownFill v-if="m.feedback === 'down'" class="w-3.5 h-3.5 text-rose-300/80" />
                          <IconThumbDown v-else class="w-3.5 h-3.5" />
                        </button>
                        <button
                          class="cmd-action"
                          title="引用回复"
                          @click="startQuote(i)"
                        >
                          <IconQuote class="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <span class="text-[10px] text-white/25">{{ formatMessageTime(m.ts) }}</span>
                  </div>
                </div>
                  </template>
                </div>

              <!-- 等待首个 token -->
              <div v-if="awaitingFirstToken" class="flex gap-2.5">
                <div class="cmd-avatar-sm shrink-0 mt-0.5">
                  <IconRobot class="w-4 h-4" />
                </div>
                <div class="cmd-bubble-ai inline-flex items-center gap-1 py-3">
                  <span class="cmd-dot" style="animation-delay: 0ms" />
                  <span class="cmd-dot" style="animation-delay: 160ms" />
                  <span class="cmd-dot" style="animation-delay: 320ms" />
                </div>
              </div>

              <!-- 错误条 -->
              <div v-if="store.error" class="flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-400/10 ring-1 ring-rose-300/25 text-xs text-rose-100/90">
                <IconAlert class="w-4 h-4 shrink-0 mt-px text-rose-300/80" />
                <div class="flex-1 break-words">
                  <p>{{ store.error }}</p>
                  <button class="mt-1 text-rose-200/80 hover:text-rose-100 underline underline-offset-2" @click="store.regenerate()">
                    重试
                  </button>
                </div>
              </div>
              </div>
            </Transition>

            <!-- 空态：能力标签云 + 推荐问题（撑满中间区域，把输入栏顶到底） -->
            <Transition name="content-fade" mode="out-in">
              <div
                v-if="store.configured && !store.hasMessages"
                class="relative z-10 flex-1 min-h-0 flex flex-col justify-center overflow-y-auto px-3 pb-3 pt-3 cmd-scroll"
              >
                <!-- 能力标签云 -->
                <div class="mb-3">
                  <p class="px-1 pb-2 text-[11px] text-white/35">我能帮你做这些 ——</p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="tag in abilityTags"
                      :key="tag.text"
                      class="ability-tag group"
                      :class="[tag.color]"
                      @click="ask(tag.text)"
                    >
                      <component :is="tag.icon" class="w-3.5 h-3.5 shrink-0 opacity-80" />
                      <span class="text-[12px]">{{ tag.label }}</span>
                    </button>
                  </div>
                </div>

                <!-- 推荐问题 -->
                <div>
                  <p class="px-1 pb-1.5 text-[11px] text-white/35">或者直接问 ——</p>
                  <div class="grid gap-1.5">
                    <button
                      v-for="s in suggestions"
                      :key="s.text"
                      class="cmd-suggestion group"
                      @click="ask(s.text)"
                    >
                      <component :is="suggestionIcon(s.icon)" class="w-4 h-4 text-sky-300/70 shrink-0 group-hover:text-sky-200" />
                      <span class="flex-1 text-left">{{ s.text }}</span>
                      <IconSend class="w-3.5 h-3.5 text-white/20 group-hover:text-white/50 -rotate-90" />
                    </button>
                  </div>
                </div>
              </div>
            </Transition>

            <!-- 引用预览（选中引用时显示，紧贴输入框上方） -->
            <Transition name="quote-fade">
              <div
                v-if="quoteMessageIdx !== null"
                class="quote-preview relative z-10 flex items-start gap-3 px-4 py-2.5 bg-teal-900/20"
              >
                <IconQuote class="w-4 h-4 text-teal-400/70 shrink-0 mt-0.5" />
                <div class="flex-1 min-w-0">
                  <div class="text-[11px] text-teal-300/80 font-medium">
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

            <!-- 连通性状态条（连不上大模型时的统一琥珀提示，区别于红条业务错误） -->
            <ConnectivityBanner v-if="store.configured" />

            <!-- 待发送图片预览（多模态输入；粘贴 / 拖入的图片在发送前列在这里） -->
            <Transition name="quote-fade">
              <div
                v-if="pendingImages.length || imageError"
                class="cmd-pending-bar relative z-10 flex items-center gap-2 px-4 py-2 border-t border-white/8"
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

            <!-- 底部输入栏 -->
            <div
              class="cmd-input-wrapper relative z-10 flex items-center gap-3 px-4 py-3.5 border-t border-white/10 shrink-0"
              :class="{ 'is-drag-img': isDraggingImage }"
              @dragover.prevent="isDraggingImage = true"
              @dragleave.prevent="isDraggingImage = false"
              @drop.prevent="onImageDrop"
            >
              <div class="cmd-avatar shrink-0" :class="{ 'has-content': input.trim() }">
                <IconRobot class="w-5 h-5" />
              </div>
              <div class="relative flex-1 min-w-0">
                <textarea
                  ref="inputEl"
                  v-model="input"
                  rows="1"
                  :disabled="!store.configured"
                  :placeholder="quoteMessageIdx !== null ? '输入回复内容…' : `问${ASSISTANT_NAME}任何事，或输入指令…`"
                  class="cmd-input w-full resize-none bg-transparent text-[15px] text-white/95 placeholder:text-white/35 outline-none leading-6 py-0.5 cmd-scroll relative z-10"
                  :style="{ maxHeight: maxInputHeight + 'px' }"
                  @keydown="onEnter"
                  @input="autoGrow(); filterSuggestions(input)"
                  @blur="onInputBlur"
                  @focus="onInputFocus"
                  @paste="onImagePaste"
                />
                <!-- 输入联想提示（幽灵文字） -->
                <Transition name="autocomplete-fade">
                  <div
                    v-if="showAutocomplete && autocompleteSuggestion && input.trim()"
                    class="absolute inset-0 flex items-center pointer-events-none text-[15px] leading-6 py-0.5"
                    aria-hidden="true"
                  >
                    <span class="invisible whitespace-pre-wrap">{{ input }}</span>
                    <span class="text-teal-400/50 whitespace-nowrap overflow-hidden text-ellipsis">
                      {{ autocompleteSuggestion.slice(input.trim().length) }}
                    </span>
                  </div>
                </Transition>
              </div>
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
              <button class="cmd-iconbtn shrink-0" title="关闭（Esc）" @click="store.close()">
                <IconClose class="w-4 h-4" />
              </button>
            </div>

            <!-- 底部状态条 -->
            <div class="relative z-10 flex items-center gap-3 px-4 h-9 border-t border-white/8 shrink-0 text-[11px] text-white/30">
              <div class="flex items-center gap-1">
                <IconSpark class="w-3 h-3 text-teal-300/60" />
                <span>{{ ASSISTANT_NAME }} · 天气 / 禅道 / 待办</span>
              </div>
              <span v-if="store.feedbackStats.up + store.feedbackStats.down > 0" class="flex items-center gap-1.5 text-white/25">
                <span class="flex items-center gap-0.5">
                  <IconThumbUpFill class="w-2.5 h-2.5 text-emerald-400/50" />{{ store.feedbackStats.up }}
                </span>
                <span class="flex items-center gap-0.5">
                  <IconThumbDownFill class="w-2.5 h-2.5 text-rose-400/50" />{{ store.feedbackStats.down }}
                </span>
              </span>
              <span v-if="store.feedbackCategoryRows.length" class="cmd-quality-summary">
                <span>质量关注</span>
                <span
                  v-for="row in store.feedbackCategoryRows.slice(0, 3)"
                  :key="row.key"
                  class="cmd-quality-pill"
                  :title="`${row.label}: 赞 ${row.up} / 踩 ${row.down} / 重答 ${row.regenerations}`"
                >
                  {{ row.label }} {{ row.down + row.regenerations }}
                </span>
              </span>
              <span class="ml-auto flex items-center gap-2.5">
                <span><kbd class="cmd-kbd">Enter</kbd> 发送</span>
                <span><kbd class="cmd-kbd">Alt+Enter</kbd> 换行</span>
                <span><kbd class="cmd-kbd">Esc</kbd> 关闭</span>
                <button
                  v-if="store.hasMessages"
                  class="flex items-center gap-1 hover:text-white/70 transition-colors"
                  :disabled="store.streaming"
                  @click="store.clear()"
                >
                  <IconBroom class="w-3 h-3" />清空
                </button>
              </span>
            </div>

            <!-- 右下角拖拽句柄 -->
            <div
              class="resize-handle absolute right-0 bottom-0 z-20 cursor-se-resize"
              :title="'拖拽调整大小 · 双击重置'"
              @mousedown="onResizeStart"
              @dblclick.stop="onResizeDoubleClick"
            >
              <svg viewBox="0 0 10 10" class="resize-icon">
                <path d="M6 10h2V8H6v2zm-4 0h2V6H2v4zm8-8h-2v2h2V2zm-4 0h2V0H6v2zm8 8h2V8h-2v2zm0-4h2V4h-2v2z" />
              </svg>
            </div>
          </section>
        </Transition>

        <!-- 图片大图预览（点用户消息缩略图 / 待发送缩略图展开，点任意处关闭） -->
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
</template>

<style scoped>
/* ============ HUD 玻璃卡（呼应 DetailModal）============ */
.cmd-card {
  border-radius: 18px;
  background:
    linear-gradient(160deg, rgba(30, 58, 95, 0.95) 0%, rgba(15, 23, 42, 0.97) 55%, rgba(13, 64, 64, 0.95) 100%),
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.022) 0 1px, transparent 1px 28px),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.022) 0 1px, transparent 1px 28px);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.13);
  box-shadow:
    0 32px 80px -16px rgba(0, 0, 0, 0.7),
    0 0 0 1px rgba(45, 212, 191, 0.16),
    0 0 40px -6px rgba(45, 212, 191, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.cmd-corners {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  border-radius: 18px;
  overflow: hidden;
}
.cmd-corners::before,
.cmd-corners::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border-color: rgba(94, 234, 212, 0.5);
  border-style: solid;
  filter: drop-shadow(0 0 4px rgba(94, 234, 212, 0.45));
}
.cmd-corners::before {
  top: 8px;
  left: 8px;
  border-width: 2px 0 0 2px;
  border-top-left-radius: 6px;
}
.cmd-corners::after {
  bottom: 8px;
  right: 8px;
  border-width: 0 2px 2px 0;
  border-bottom-right-radius: 6px;
}

.cmd-accent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 6;
  background: linear-gradient(90deg, #38bdf8, #2dd4bf, #38bdf8);
  background-size: 200% 100%;
  box-shadow: 0 0 12px rgba(45, 212, 191, 0.5);
  animation: cmd-accent-flow 3.5s linear infinite;
}
@keyframes cmd-accent-flow {
  from { background-position: 0% 0; }
  to { background-position: 200% 0; }
}

/* ============ 头像 ============ */
.cmd-avatar,
.cmd-avatar-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(150deg, rgba(56, 189, 248, 0.88), rgba(20, 184, 166, 0.88));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 2px 8px -2px rgba(20, 184, 166, 0.5);
}
.cmd-avatar {
  width: 36px;
  height: 36px;
  border-radius: 11px;
}
.cmd-avatar-sm {
  width: 30px;
  height: 30px;
  border-radius: 9px;
}

/* ============ 按钮 ============ */
.cmd-iconbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: rgba(255, 255, 255, 0.5);
  transition: background 0.15s, color 0.15s;
}
.cmd-iconbtn:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.1);
}
.cmd-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  color: #fff;
  flex-shrink: 0;
  background: linear-gradient(150deg, #38bdf8, #2dd4bf);
  box-shadow: 0 2px 10px -2px rgba(20, 184, 166, 0.5);
  transition: opacity 0.15s, transform 0.12s;
}
.cmd-send:hover:not(:disabled) {
  transform: scale(1.06);
}
.cmd-send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: none;
}
.cmd-send.is-stop {
  background: linear-gradient(150deg, rgba(244, 63, 94, 0.85), rgba(225, 29, 72, 0.85));
  box-shadow: 0 2px 10px -2px rgba(244, 63, 94, 0.5);
}

/* ============ 内容过渡动画 ============ */
.content-fade-enter-active,
.content-fade-leave-active {
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.content-fade-enter-from,
.content-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ============ 气泡 ============ */
.cmd-bubble-user {
  padding: 10px 14px;
  border-radius: 16px 16px 6px 16px;
  font-size: 14px;
  line-height: 1.6;
  color: #fff;
  white-space: pre-wrap;
  word-break: break-word;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.5), rgba(20, 184, 166, 0.45));
  border: 1px solid rgba(125, 211, 252, 0.4);
  box-shadow:
    0 4px 16px -4px rgba(20, 184, 166, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
}
.cmd-bubble-ai {
  position: relative;
  padding: 12px 16px;
  border-radius: 6px 18px 18px 18px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  word-break: break-word;
  border-left: 3px solid rgba(94, 234, 212, 0.6);
}
.cmd-ui-stack {
  display: grid;
  gap: 8px;
  max-width: min(100%, 620px);
}

.cmd-caret {
  display: inline-block;
  width: 6px;
  height: 15px;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: rgba(94, 234, 212, 0.9);
  border-radius: 1px;
  animation: cmd-blink 1s steps(2, start) infinite;
}
@keyframes cmd-blink {
  50% { opacity: 0; }
}

.cmd-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(94, 234, 212, 0.75);
  animation: cmd-bounce 1.2s infinite ease-in-out;
}
@keyframes cmd-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* ============ 输入框聚焦视觉 ============ */
.cmd-input-wrapper {
  transition: background 0.2s, box-shadow 0.2s;
}
.cmd-input-wrapper:focus-within {
  background: rgba(45, 212, 191, 0.04);
  box-shadow:
    inset 0 1px 0 rgba(45, 212, 191, 0.15),
    inset 0 -1px 0 rgba(45, 212, 191, 0.1),
    0 0 16px rgba(45, 212, 191, 0.15);
}
.cmd-input-wrapper:focus-within .cmd-avatar {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 0 12px rgba(45, 212, 191, 0.5);
}
.cmd-input {
  transition: background 0.2s, height 0.15s ease-out;
  resize: none;
  overflow-y: auto;
}
.cmd-input:focus {
  background: transparent;
}
/* 输入框滚动条美化 */
.cmd-input::-webkit-scrollbar {
  width: 4px;
}
.cmd-input::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}
.cmd-input::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.35);
}
/* 头像呼吸灯（有内容时） */
.cmd-avatar.has-content {
  animation: avatar-glow 2s ease-in-out infinite;
}
@keyframes avatar-glow {
  0%, 100% {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 2px 8px -2px rgba(20, 184, 166, 0.5);
  }
  50% {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 0 16px rgba(45, 212, 191, 0.6);
  }
}

/* ============ 工具活动卡 ============ */
.cmd-activity {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px 7px 8px;
  border-radius: 10px;
  font-size: 12px;
  background: rgba(45, 212, 191, 0.06);
  border: 1px solid rgba(45, 212, 191, 0.18);
  position: relative;
  overflow: hidden;
  border-left: 3px solid rgba(45, 212, 191, 0.5);
}
.cmd-activity::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  transition: left 0.5s;
}
.cmd-activity.running::after {
  left: 100%;
  animation: activity-sweep 1.5s ease-in-out infinite;
}
@keyframes activity-sweep {
  0% { left: -100%; }
  100% { left: 100%; }
}
.cmd-activity.is-error {
  background: rgba(244, 63, 94, 0.07);
  border-color: rgba(244, 63, 94, 0.2);
  border-left-color: rgba(244, 63, 94, 0.5);
}
.cmd-activity.is-pending {
  display: block;
  background: rgba(251, 191, 36, 0.08);
  border-color: rgba(251, 191, 36, 0.24);
  border-left-color: rgba(251, 191, 36, 0.62);
}
.cmd-approval {
  margin-top: 9px;
  padding: 10px;
  border-radius: 9px;
  background: rgba(2, 6, 23, 0.34);
  border: 1px solid rgba(251, 191, 36, 0.18);
}
.cmd-approval-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.cmd-approval-head strong {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.9);
}
.cmd-approval-kicker {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 650;
  color: #fde68a;
  background: rgba(251, 191, 36, 0.14);
}
.cmd-approval-desc,
.cmd-approval-risk {
  margin: 7px 0 0;
  font-size: 11.5px;
  line-height: 1.55;
}
.cmd-approval-desc {
  color: rgba(255, 255, 255, 0.66);
}
.cmd-approval-risk {
  color: rgba(253, 230, 138, 0.86);
}
.cmd-approval-args {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.42);
}
.cmd-approval-args summary {
  cursor: pointer;
  width: fit-content;
}
.cmd-approval-args pre {
  margin: 6px 0 0;
  padding: 8px;
  max-height: 140px;
  overflow: auto;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.68);
  white-space: pre-wrap;
  word-break: break-all;
}
.cmd-approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.cmd-approval-btn {
  height: 27px;
  padding: 0 11px;
  border-radius: 7px;
  font-size: 11.5px;
  font-weight: 600;
  transition: background 0.15s, color 0.15s, opacity 0.15s;
}
.cmd-approval-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cmd-approval-btn.is-cancel {
  color: rgba(255, 255, 255, 0.58);
  background: rgba(255, 255, 255, 0.07);
}
.cmd-approval-btn.is-cancel:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.86);
  background: rgba(255, 255, 255, 0.11);
}
.cmd-approval-btn.is-confirm {
  color: #fff7ed;
  background: rgba(245, 158, 11, 0.72);
}
.cmd-approval-btn.is-confirm:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.9);
}
/* 工具类型色标 + 左侧色条强化 */
.cmd-activity.tool-weather {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.3);
  border-left-color: rgba(56, 189, 248, 0.6);
}
.cmd-activity.tool-weather :deep(.animate-spin) {
  color: rgba(125, 211, 252, 0.9) !important;
}
.cmd-activity.tool-task {
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.3);
  border-left-color: rgba(52, 211, 153, 0.6);
}
.cmd-activity.tool-task :deep(.animate-spin) {
  color: rgba(110, 231, 183, 0.9) !important;
}
.cmd-activity.tool-bug {
  background: rgba(251, 113, 133, 0.1);
  border-color: rgba(251, 113, 133, 0.3);
  border-left-color: rgba(251, 113, 133, 0.6);
}
.cmd-activity.tool-bug :deep(.animate-spin) {
  color: rgba(251, 113, 133, 0.9) !important;
}
.cmd-activity.tool-kb {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.3);
  border-left-color: rgba(251, 191, 36, 0.6);
}
.cmd-activity.tool-kb :deep(.animate-spin) {
  color: rgba(252, 211, 77, 0.9) !important;
}
.cmd-activity.tool-local {
  background: rgba(94, 234, 212, 0.1);
  border-color: rgba(94, 234, 212, 0.3);
  border-left-color: rgba(94, 234, 212, 0.6);
}
.cmd-activity.tool-local :deep(.animate-spin) {
  color: rgba(94, 234, 212, 0.9) !important;
}
.cmd-activity.is-pending {
  background: rgba(251, 191, 36, 0.08);
  border-color: rgba(251, 191, 36, 0.24);
  border-left-color: rgba(251, 191, 36, 0.62);
}

/* ============ 消息操作 ============ */
.cmd-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 7px;
  opacity: 0;
  transition: opacity 0.15s;
}
.cmd-bubble-ai:hover .cmd-actions {
  opacity: 1;
}
.cmd-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.4);
  transition: background 0.15s, color 0.15s;
}
.cmd-action:hover {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.1);
}
.cmd-quality-tag {
  height: 22px;
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  color: rgba(199, 210, 254, 0.76);
  background: rgba(129, 140, 248, 0.1);
  border: 1px solid rgba(165, 180, 252, 0.14);
}
.cmd-quality-summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: rgba(255, 255, 255, 0.25);
}
.cmd-quality-pill {
  display: inline-flex;
  align-items: center;
  max-width: 84px;
  padding: 1px 6px;
  border-radius: 999px;
  color: rgba(253, 230, 138, 0.72);
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.12);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============ 推荐问题 ============ */
.cmd-suggestion {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 11px;
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: all 0.16s;
}
.cmd-suggestion:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(94, 234, 212, 0.35);
}

/* ============ 能力标签 ============ */
.ability-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  transition: all 0.2s ease;
}
.ability-tag:hover {
  transform: translateY(-1px);
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.ability-tag.tag-weather {
  border-color: rgba(56, 189, 248, 0.3);
}
.ability-tag.tag-weather:hover {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.5);
}
.ability-tag.tag-task {
  border-color: rgba(52, 211, 153, 0.3);
}
.ability-tag.tag-task:hover {
  background: rgba(52, 211, 153, 0.15);
  border-color: rgba(52, 211, 153, 0.5);
}
.ability-tag.tag-bug {
  border-color: rgba(251, 113, 133, 0.3);
}
.ability-tag.tag-bug:hover {
  background: rgba(251, 113, 133, 0.15);
  border-color: rgba(251, 113, 133, 0.5);
}
.ability-tag.tag-kb {
  border-color: rgba(251, 191, 36, 0.3);
}
.ability-tag.tag-kb:hover {
  background: rgba(251, 191, 36, 0.15);
  border-color: rgba(251, 191, 36, 0.5);
}
.ability-tag.tag-local {
  border-color: rgba(94, 234, 212, 0.3);
}
.ability-tag.tag-local:hover {
  background: rgba(94, 234, 212, 0.15);
  border-color: rgba(94, 234, 212, 0.5);
}

/* ============ 输入联想过渡动画 ============ */
.autocomplete-fade-enter-active,
.autocomplete-fade-leave-active {
  transition: opacity 0.15s ease;
}
.autocomplete-fade-enter-from,
.autocomplete-fade-leave-to {
  opacity: 0;
}

/* ============ 键帽 ============ */
.cmd-kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* 滚动条 */
.cmd-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
.cmd-scroll::-webkit-scrollbar {
  width: 6px;
}
.cmd-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

/* ============ 进出场动画 ============ */
.cmd-fade-enter-active,
.cmd-fade-leave-active {
  transition: opacity 0.2s ease;
}
.cmd-fade-enter-from,
.cmd-fade-leave-to {
  opacity: 0;
}
.cmd-pop-enter-active {
  transition: opacity 0.24s ease, transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.cmd-pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.cmd-pop-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.96);
}
.cmd-pop-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

/* ============ 拖拽缩放句柄 ============ */
.resize-handle {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.35;
  transition: opacity 0.2s;
  border-bottom-right-radius: 17px;
}
.resize-handle:hover {
  opacity: 0.8;
  background: rgba(255, 255, 255, 0.05);
}
.resize-icon {
  width: 10px;
  height: 10px;
  fill: rgba(255, 255, 255, 0.5);
}
.resize-handle:hover .resize-icon {
  fill: rgba(94, 234, 212, 0.9);
}

/* 拖拽中禁用文本选择 */
.is-resizing,
.is-resizing * {
  user-select: none;
  -webkit-user-select: none;
  cursor: se-resize !important;
}

/* 引用预览过渡动画 */
.quote-fade-enter-active,
.quote-fade-leave-active {
  transition: all 0.2s ease;
  max-height: 60px;
}
.quote-fade-enter-from,
.quote-fade-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

/* 工具活动卡展开过渡 */
.activity-expand-enter-active,
.activity-expand-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}
.activity-expand-enter-from,
.activity-expand-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
  padding-top: 0;
}
.activity-expand-enter-to,
.activity-expand-leave-from {
  max-height: 220px;
}

/* 活动卡展开状态样式 */
.cmd-activity.is-expanded {
  border-radius: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .cmd-accent,
  .cmd-dot,
  .cmd-caret,
  .cmd-fade-enter-active,
  .cmd-fade-leave-active,
  .cmd-pop-enter-active,
  .cmd-pop-leave-active,
  .quote-fade-enter-active,
  .quote-fade-leave-active,
  .content-fade-enter-active,
  .content-fade-leave-active { animation: none; transition: none; }
}

/* ===== Markdown 正文样式（v-html 注入，需 :deep 命中）===== */
.cmd-md { line-height: 1.65; position: relative; }
/* 流式中的纯文本渲染（未走 markdown 解析，保留换行与空白） */
.cmd-md-raw { white-space: pre-wrap; word-break: break-word; }

.cmd-md :deep(> span > :first-child) { margin-top: 0; }
.cmd-md :deep(> span > :last-child) { margin-bottom: 0; }
.cmd-md :deep(p) { margin: 0.45em 0; }
.cmd-md :deep(h1),
.cmd-md :deep(h2),
.cmd-md :deep(h3),
.cmd-md :deep(h4) { margin: 0.7em 0 0.35em; font-weight: 600; line-height: 1.3; color: rgba(255,255,255,0.96); }
.cmd-md :deep(h1) { font-size: 1.18em; }
.cmd-md :deep(h2) { font-size: 1.1em; }
.cmd-md :deep(h3) { font-size: 1.04em; }
.cmd-md :deep(ul),
.cmd-md :deep(ol) { margin: 0.45em 0; padding-left: 1.4em; }
.cmd-md :deep(ul) { list-style: disc; }
.cmd-md :deep(ol) { list-style: decimal; }
.cmd-md :deep(li) { margin: 0.24em 0; }
.cmd-md :deep(li::marker) { color: rgba(94, 234, 212, 0.7); }
.cmd-md :deep(a) { color: rgb(125 211 252); text-decoration: underline; text-underline-offset: 2px; }
.cmd-md :deep(strong) { font-weight: 600; color: rgba(255, 255, 255, 0.98); }
.cmd-md :deep(em) { font-style: italic; }
.cmd-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.86em; padding: 0.1em 0.36em; border-radius: 4px;
  background: rgba(255, 255, 255, 0.09); color: rgb(94 234 212);
}

/* 代码块样式 */
.cmd-md :deep(.code-block-wrapper) {
  position: relative;
  margin: 0.55em 0;
}
.cmd-md :deep(.code-block-header) {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-bottom: none;
  border-radius: 10px 10px 0 0;
}
.cmd-md :deep(.code-lang) {
  color: rgb(94 234 212);
  font-weight: 500;
}
.cmd-md :deep(.code-line-count) {
  opacity: 0.5;
  font-size: 11px;
}
.cmd-md :deep(.code-copy-btn) {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.cmd-md :deep(.code-copy-btn:hover) {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(94, 234, 212, 0.2);
}
.cmd-md :deep(.code-copy-btn.copied) {
  color: rgb(74 222 128);
  background: rgba(74, 222, 128, 0.15);
}

.cmd-md :deep(pre) {
  margin: 0; padding: 0.7em 0.9em; border-radius: 0 0 10px 10px;
  background: rgba(0, 0, 0, 0.4); overflow-x: auto;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-top: none;
}
.cmd-md :deep(pre code) { display: block; padding: 0; background: transparent; color: rgba(255, 255, 255, 0.86); white-space: pre; }

.cmd-md :deep(blockquote) {
  margin: 0.55em 0; padding: 0.2em 0.9em;
  border-left: 3px solid rgba(94, 234, 212, 0.45); color: rgba(255, 255, 255, 0.72);
}
.cmd-md :deep(hr) { margin: 0.75em 0; border: none; border-top: 1px solid rgba(255, 255, 255, 0.12); }
.cmd-md :deep(table) { margin: 0.55em 0; border-collapse: collapse; font-size: 0.92em; width: 100%; border-radius: 8px; overflow: hidden; }
.cmd-md :deep(th),
.cmd-md :deep(td) { border: 1px solid rgba(255, 255, 255, 0.1); padding: 0.4em 0.7em; text-align: left; }
.cmd-md :deep(th) {
  background: rgba(94, 234, 212, 0.15);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  position: sticky;
  top: 0;
  z-index: 1;
}
/* 表格斑马纹 */
.cmd-md :deep(tr:nth-child(even)) {
  background: rgba(255, 255, 255, 0.03);
}
.cmd-md :deep(tr:nth-child(odd)) {
  background: rgba(255, 255, 255, 0.01);
}
.cmd-md :deep(tr:hover) {
  background: rgba(94, 234, 212, 0.08);
}

/* ============ 用户消息里的图片 ============ */
.cmd-user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.cmd-user-img {
  max-width: 180px;
  max-height: 180px;
  border-radius: 8px;
  object-fit: contain;
  cursor: zoom-in;
  background: rgba(0, 0, 0, 0.2);
}
/* 气泡里只有图、没有文字时，去掉底部多余间距 */
.cmd-bubble-user .cmd-user-images:last-child {
  margin-bottom: 0;
}

/* ============ 待发送图片预览条 ============ */
.cmd-pending-bar {
  background: rgba(45, 212, 191, 0.04);
}
.cmd-input-wrapper.is-drag-img {
  background: rgba(45, 212, 191, 0.08);
  box-shadow: inset 0 0 0 1px rgba(94, 234, 212, 0.5);
}
.cmd-pending-thumb {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.2);
}
.cmd-pending-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
}
.cmd-pending-x {
  position: absolute;
  top: 2px;
  right: 2px;
  color: rgba(255, 255, 255, 0.9);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  opacity: 0;
  transition: opacity 0.15s;
}
.cmd-pending-thumb:hover .cmd-pending-x {
  opacity: 1;
}
</style>
