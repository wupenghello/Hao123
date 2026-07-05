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
import { reachEnabled } from '@/features/reach'
import { ASSISTANT_NAME } from '../config'
import { renderMarkdown } from '../markdown'
import { useStorage } from '@/composables/useStorage'
import { useChatSettings } from '../settings'
import GenerativeUiBlock from './GenerativeUiBlock.vue'
import ChatSettingsModal from './ChatSettingsModal.vue'
import { useConnectivity } from '../connectivity'
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

const store = useChatStore()
const { settings } = useChatSettings()

const input = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const copiedIdx = ref(-1)
const showSettings = ref(false)

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

/** 工具执行中的进度描述 */
const executingToolLabel = computed(() => {
  const last = store.messages[store.messages.length - 1]
  if (!last?.activities?.length) return ''
  const running = last.activities.filter((a) => a.status === 'running')
  const done = last.activities.filter((a) => a.status === 'done')
  const error = last.activities.filter((a) => a.status === 'error')
  const pending = last.activities.filter((a) => a.status === 'pending')
  if (running.length > 1) return `正在并行查询（${done.length}/${last.activities.length}）…`
  if (running.length === 1) return `正在查询${running[0].label}…`
  if (pending.length) return `等待确认（${pending.length} 项）…`
  if (error.length === last.activities.length) return '查询遇到问题，可点击下方活动卡重试'
  if (error.length) return `部分查询失败（${error.length}/${last.activities.length}），可点击重试`
  if (done.length === last.activities.length) return '正在组织回答…'
  return ''
})

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
  // 每分钟检查小时变化，驱动 contextSuggestions 刷新（Fix 3）
  hourTimer = setInterval(() => {
    const h = new Date().getHours()
    if (h !== currentHour.value) currentHour.value = h
  }, 60_000)
})

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.removeEventListener('mouseleave', onResizeEnd)
  if (codeCopyHandler) document.removeEventListener('click', codeCopyHandler)
  if (hourTimer) { clearInterval(hourTimer); hourTimer = null }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="cmd-fade">
      <div
        v-if="store.open"
        class="cmd-shell"
      >
        <!-- 遮罩 -->
        <div class="cmd-backdrop" @click="store.close()" />

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

            <header class="cmd-header relative z-10">
              <div class="cmd-brand-mark">
                <IconRobot class="w-5 h-5" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="cmd-eyebrow">Assistant Operations</p>
                <h2 class="cmd-title">{{ ASSISTANT_NAME }} 对话中枢</h2>
                <p class="cmd-subtitle">把天气、禅道、待办和知识库串成一次工作流。</p>
              </div>
              <div class="cmd-header-actions">
                <span class="cmd-live-pill" :class="{ 'is-ready': store.configured }">
                  <IconSpark class="w-3.5 h-3.5" />
                  {{ store.configured ? '线路就绪' : '等待配置' }}
                </span>
                <button
                  class="cmd-iconbtn"
                  title="对话参数设置"
                  @click="showSettings = true"
                >
                  <IconCog class="w-4 h-4" />
                </button>
                <button
                  v-if="store.hasMessages"
                  class="cmd-header-btn"
                  :disabled="store.streaming"
                  title="清空对话"
                  @click="store.clear()"
                >
                  <IconBroom class="w-3.5 h-3.5" />
                  清空
                </button>
                <button class="cmd-iconbtn" title="关闭（Esc）" @click="store.close()">
                  <IconClose class="w-4 h-4" />
                </button>
              </div>
            </header>

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
                  <p class="text-xs text-white/40 max-w-[18rem]">点击状态栏「未配置」打开模型配置面板，填写 API Key 后即可对话</p>
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

              <!-- 等待首个 token（工具执行中也保持显示，下方附加执行进度） -->
              <div v-if="awaitingFirstToken" class="flex gap-2.5">
                <div class="cmd-avatar-sm shrink-0 mt-0.5">
                  <IconRobot class="w-4 h-4" />
                </div>
                <div class="flex flex-col gap-1.5">
                  <div class="cmd-bubble-ai inline-flex items-center gap-1 py-3">
                    <span class="cmd-dot" style="animation-delay: 0ms" />
                    <span class="cmd-dot" style="animation-delay: 160ms" />
                    <span class="cmd-dot" style="animation-delay: 320ms" />
                  </div>
                  <!-- 工具执行进度提示（方案B：区分阶段） -->
                  <div
                    v-if="isExecutingTools && executingToolLabel"
                    class="text-[11px] text-white/35 px-1"
                  >
                    {{ executingToolLabel }}
                  </div>
                </div>
              </div>

              </div>
            </Transition>

            <!-- 统一错误条：合并业务错误 + 连通性问题。放在两个 Transition 块之间，
                 确保在消息态和问候空态下都可见（与旧 ConnectivityBanner 位置一致）。 -->
            <div
              v-if="unifiedError.visible"
              class="relative z-10 flex items-start gap-2 mx-4 mb-2 px-3 py-2 rounded-lg text-xs"
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

            <!-- 空态：对话式问候 + 上下文引导（撑满中间区域，把输入栏顶到底） -->
            <Transition name="content-fade" mode="out-in">
              <div
                v-if="store.configured && !store.hasMessages"
                class="relative z-10 flex-1 min-h-0 flex flex-col justify-center overflow-y-auto px-3 pb-3 pt-3 cmd-scroll"
              >
                <!-- 对话式问候 -->
                <div class="mb-4 px-1">
                  <p class="text-[13px] text-white/55 leading-relaxed">
                    {{ pickGreeting() }}，我是 {{ ASSISTANT_NAME }}。<br>
                    <span class="text-white/35">天气、禅道、待办、知识库——直接跟我说就好。</span>
                  </p>
                </div>

                <!-- 上下文感知的快捷提问 -->
                <div>
                  <p class="px-1 pb-1.5 text-[11px] text-white/35">或者从这里开始 ——</p>
                  <div class="grid gap-1.5">
                    <button
                      v-for="s in contextSuggestions"
                      :key="s.text"
                      class="cmd-suggestion group"
                      @click="ask(s.text)"
                    >
                      <component :is="suggestionIconFor(s.icon)" class="w-4 h-4 text-sky-300/70 shrink-0 group-hover:text-sky-200" />
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
              class="cmd-input-wrapper relative z-10 shrink-0"
              :class="{ 'is-drag-img': isDraggingImage }"
              @dragover.prevent="isDraggingImage = true"
              @dragleave.prevent="isDraggingImage = false"
              @drop.prevent="onImageDrop"
            >
              <div
                class="cmd-composer"
                :class="{
                  'has-text': input.trim(),
                  'has-images': pendingImages.length,
                  'is-disabled': !store.configured,
                }"
              >
                <div class="cmd-composer-main relative flex-1 min-w-0">
                  <textarea
                    ref="inputEl"
                    v-model="input"
                    rows="1"
                    :disabled="!store.configured"
                    :placeholder="quoteMessageIdx !== null ? '输入回复内容…' : `直接跟我说就好…`"
                    class="cmd-input w-full resize-none bg-transparent text-[15px] text-white/95 placeholder:text-white/35 outline-none leading-6 cmd-scroll relative z-10"
                    :style="{ maxHeight: maxInputHeight + 'px' }"
                    @keydown="onEnter"
                    @input="autoGrow"
                    @paste="onImagePaste"
                  />
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
              </div>
            </div>

            <!-- 底部状态条（精简：只保留身份标识，去掉质量关注和快捷键提示） -->
            <div class="cmd-footer relative z-10">
              <div class="cmd-footer-left">
                <IconSpark class="w-3 h-3" />
                <span>{{ ASSISTANT_NAME }} · 天气 / 禅道 / 待办</span>
              </div>
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

  <!-- 对话参数设置弹窗 -->
  <ChatSettingsModal v-model:open="showSettings" />
</template>

<style scoped>
.cmd-shell {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: center;
  padding: 6vh 16px;
}
.cmd-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 20% 12%, rgba(34, 211, 238, 0.18), transparent 34%),
    radial-gradient(circle at 82% 86%, rgba(167, 139, 250, 0.14), transparent 32%),
    rgba(2, 6, 23, 0.78);
  backdrop-filter: blur(16px) saturate(140%);
}
.cmd-card {
  --cmd-tone: #22d3ee;
  --cmd-tone-2: #a78bfa;
  --cmd-panel: rgba(6, 13, 28, 0.78);
  --cmd-border: rgba(148, 163, 184, 0.16);
  --cmd-text: rgba(248, 250, 252, 0.92);
  --cmd-muted: rgba(226, 232, 240, 0.52);
  border: 1px solid color-mix(in srgb, var(--cmd-tone) 20%, rgba(148, 163, 184, 0.24));
  border-radius: 14px;
  background:
    radial-gradient(circle at 14% 0, color-mix(in srgb, var(--cmd-tone) 14%, transparent), transparent 34%),
    linear-gradient(135deg, color-mix(in srgb, var(--cmd-tone) 8%, transparent), transparent 30%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(2, 6, 23, 0.98));
  color: var(--cmd-text);
  box-shadow:
    0 34px 110px rgba(0, 0, 0, 0.66),
    0 0 0 1px rgba(255, 255, 255, 0.035),
    0 0 70px color-mix(in srgb, var(--cmd-tone) 12%, transparent);
  backdrop-filter: blur(24px) saturate(145%);
  -webkit-backdrop-filter: blur(24px) saturate(145%);
}
.cmd-card::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255,255,255,0.026) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: linear-gradient(135deg, rgba(0,0,0,0.55), transparent 58%);
}
.cmd-card::after {
  position: absolute;
  inset: auto 20px 0;
  height: 1px;
  content: '';
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--cmd-tone) 52%, transparent), transparent);
  opacity: 0.75;
}
.cmd-corners {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  border-radius: 14px;
  overflow: hidden;
}
.cmd-corners::before,
.cmd-corners::after {
  position: absolute;
  width: 18px;
  height: 18px;
  border-color: color-mix(in srgb, var(--cmd-tone) 58%, transparent);
  border-style: solid;
  content: '';
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--cmd-tone) 38%, transparent));
}
.cmd-corners::before {
  top: 9px;
  left: 9px;
  border-width: 2px 0 0 2px;
  border-top-left-radius: 6px;
}
.cmd-corners::after {
  right: 9px;
  bottom: 9px;
  border-width: 0 2px 2px 0;
  border-bottom-right-radius: 6px;
}
.cmd-accent {
  position: absolute;
  z-index: 6;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--cmd-tone), var(--cmd-tone-2), var(--cmd-tone));
  background-size: 200% 100%;
  box-shadow: 0 0 18px color-mix(in srgb, var(--cmd-tone) 45%, transparent);
  animation: cmd-accent-flow 3.5s linear infinite;
}
@keyframes cmd-accent-flow {
  from { background-position: 0% 0; }
  to { background-position: 200% 0; }
}
.cmd-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--cmd-border);
  background:
    radial-gradient(circle at 12% 0, color-mix(in srgb, var(--cmd-tone) 15%, transparent), transparent 34%),
    rgba(15, 23, 42, 0.34);
}
.cmd-brand-mark,
.cmd-avatar,
.cmd-avatar-sm {
  display: grid;
  place-items: center;
  color: color-mix(in srgb, var(--cmd-tone) 82%, white);
  background:
    radial-gradient(circle at 30% 18%, color-mix(in srgb, var(--cmd-tone) 42%, transparent), transparent 45%),
    color-mix(in srgb, var(--cmd-tone) 11%, rgba(255,255,255,0.04));
  border: 1px solid color-mix(in srgb, var(--cmd-tone) 42%, rgba(255,255,255,0.08));
  box-shadow:
    0 0 24px color-mix(in srgb, var(--cmd-tone) 18%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.1);
}
.cmd-brand-mark {
  width: 46px;
  height: 46px;
  border-radius: 12px;
}
.cmd-avatar {
  width: 38px;
  height: 38px;
  border-radius: 12px;
}
.cmd-avatar-sm {
  width: 31px;
  height: 31px;
  border-radius: 10px;
}
.cmd-eyebrow {
  margin: 0 0 3px;
  color: color-mix(in srgb, var(--cmd-tone) 72%, white 8%);
  font: 850 10px/1 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.cmd-title {
  margin: 0;
  color: rgba(248, 250, 252, 0.96);
  font-size: 21px;
  font-weight: 850;
  letter-spacing: -0.01em;
}
.cmd-subtitle {
  margin: 5px 0 0;
  overflow: hidden;
  color: var(--cmd-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmd-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 9px;
}
.cmd-live-pill,
.cmd-header-btn,
.cmd-iconbtn,
.cmd-send,
.cmd-action,
.cmd-approval-btn,
.cmd-suggestion,
.resize-handle,
.cmd-pending-x,
.cmd-row-btn {
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  cursor: pointer;
}
.cmd-live-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid rgba(251, 191, 36, 0.22);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(251, 191, 36, 0.13), rgba(251, 191, 36, 0.06));
  color: #fbbf24;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.07);
}
.cmd-live-pill.is-ready {
  border-color: color-mix(in srgb, var(--cmd-tone) 34%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--cmd-tone) 16%, transparent), color-mix(in srgb, var(--cmd-tone) 7%, transparent));
  color: color-mix(in srgb, var(--cmd-tone) 80%, white);
}
.cmd-header-btn,
.cmd-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255,255,255,0.085);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.035));
  color: rgba(226, 232, 240, 0.66);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055);
}
.cmd-header-btn {
  gap: 5px;
  min-height: 32px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 800;
}
.cmd-iconbtn {
  width: 32px;
  height: 32px;
}
.cmd-header-btn:hover:not(:disabled),
.cmd-header-btn:focus-visible,
.cmd-iconbtn:hover,
.cmd-iconbtn:focus-visible {
  color: white;
  border-color: color-mix(in srgb, var(--cmd-tone) 30%, transparent);
  background: color-mix(in srgb, var(--cmd-tone) 9%, rgba(255,255,255,0.07));
  outline: 0;
}
.cmd-header-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.cmd-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.24) transparent;
}
.cmd-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.cmd-scroll::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.24);
  border-radius: 999px;
}
.cmd-bubble-user,
.cmd-bubble-ai,
.cmd-activity,
.cmd-suggestion,
.ability-tag,
.quote-preview,
.cmd-pending-bar,
.cmd-input-wrapper,
.cmd-footer {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.045);
}
.cmd-bubble-user {
  position: relative;
  overflow: hidden;
  padding: 11px 14px;
  border: 1px solid color-mix(in srgb, var(--cmd-tone) 38%, transparent);
  border-radius: 16px 16px 7px 16px;
  background:
    radial-gradient(circle at 16px 12px, color-mix(in srgb, var(--cmd-tone) 25%, transparent), transparent 46px),
    linear-gradient(135deg, color-mix(in srgb, var(--cmd-tone) 38%, rgba(15, 23, 42, 0.58)), color-mix(in srgb, var(--cmd-tone-2) 18%, rgba(2, 6, 23, 0.4)));
  color: #fff;
  font-size: 14px;
  line-height: 1.62;
  white-space: pre-wrap;
  word-break: break-word;
}
.cmd-bubble-user::before,
.cmd-bubble-ai::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--cmd-tone), transparent);
  opacity: 0.72;
}
.cmd-bubble-ai {
  position: relative;
  max-width: min(100%, 680px);
  overflow: hidden;
  padding: 13px 16px;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 7px 16px 16px 16px;
  background:
    radial-gradient(circle at 18px 14px, color-mix(in srgb, var(--cmd-tone) 12%, transparent), transparent 58px),
    linear-gradient(180deg, rgba(15, 23, 42, 0.58), rgba(2, 6, 23, 0.34));
  color: rgba(255, 255, 255, 0.92);
  font-size: 14px;
  word-break: break-word;
}
.cmd-ui-stack {
  display: grid;
  gap: 10px;
  max-width: min(100%, 680px);
}
.cmd-caret {
  display: inline-block;
  width: 6px;
  height: 15px;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: color-mix(in srgb, var(--cmd-tone) 90%, white);
  border-radius: 1px;
  box-shadow: 0 0 10px color-mix(in srgb, var(--cmd-tone) 45%, transparent);
  animation: cmd-blink 1s steps(2, start) infinite;
}
@keyframes cmd-blink { 50% { opacity: 0; } }
.cmd-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--cmd-tone) 82%, white);
  box-shadow: 0 0 10px color-mix(in srgb, var(--cmd-tone) 45%, transparent);
  animation: cmd-bounce 1.2s infinite ease-in-out;
}
@keyframes cmd-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-4px); opacity: 1; }
}
.cmd-activity {
  --tool-tone: var(--cmd-tone);
  position: relative;
  display: block;
  overflow: hidden;
  padding: 9px 12px 9px 10px;
  border: 1px solid color-mix(in srgb, var(--tool-tone) 22%, rgba(148, 163, 184, 0.12));
  border-radius: 10px;
  background:
    radial-gradient(circle at 12px 10px, color-mix(in srgb, var(--tool-tone) 16%, transparent), transparent 48px),
    linear-gradient(180deg, color-mix(in srgb, var(--tool-tone) 6%, rgba(15, 23, 42, 0.55)), rgba(2, 6, 23, 0.28));
  font-size: 12px;
}
.cmd-activity::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--tool-tone), transparent);
  opacity: 0.7;
}
.cmd-activity::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 24px 24px;
  mask-image: linear-gradient(110deg, rgba(0,0,0,0.46), transparent 66%);
}
.cmd-activity > * { position: relative; z-index: 1; }
.cmd-activity.running {
  box-shadow:
    0 0 24px color-mix(in srgb, var(--tool-tone) 10%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.055);
}
.cmd-activity.running::before { animation: activity-pulse 1.4s ease-in-out infinite; }
@keyframes activity-pulse {
  0%, 100% { opacity: 0.42; filter: saturate(1); }
  50% { opacity: 1; filter: saturate(1.4); }
}
.cmd-activity.is-error { --tool-tone: #fb7185; }
.cmd-activity.is-pending { --tool-tone: #fbbf24; }
.cmd-activity.tool-weather { --tool-tone: #38bdf8; }
.cmd-activity.tool-task { --tool-tone: #34d399; }
.cmd-activity.tool-bug { --tool-tone: #fb7185; }
.cmd-activity.tool-kb { --tool-tone: #fbbf24; }
.cmd-activity.tool-local { --tool-tone: #2dd4bf; }
.cmd-approval {
  position: relative;
  margin-top: 10px;
  padding: 12px;
  overflow: hidden;
  border: 1px solid rgba(251, 191, 36, 0.22);
  border-radius: 10px;
  background:
    radial-gradient(circle at 18px 14px, rgba(251, 191, 36, 0.14), transparent 70px),
    rgba(2, 6, 23, 0.38);
}
.cmd-approval-head,
.cmd-approval-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cmd-approval-head strong {
  color: rgba(248, 250, 252, 0.92);
  font-size: 12.5px;
  font-weight: 850;
}
.cmd-approval-kicker {
  flex-shrink: 0;
  padding: 2px 7px;
  border: 1px solid rgba(251, 191, 36, 0.22);
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.1);
  color: #fde68a;
  font: 850 10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cmd-approval-desc,
.cmd-approval-risk {
  margin: 8px 0 0;
  font-size: 11.5px;
  line-height: 1.55;
}
.cmd-approval-desc { color: rgba(226, 232, 240, 0.66); }
.cmd-approval-risk { color: rgba(253, 230, 138, 0.86); }
.cmd-approval-args {
  margin-top: 9px;
  color: rgba(226, 232, 240, 0.44);
  font-size: 11px;
}
.cmd-approval-args summary {
  width: fit-content;
  cursor: pointer;
}
.cmd-approval-args pre,
.cmd-activity pre {
  margin: 7px 0 0;
  max-height: 160px;
  overflow: auto;
  padding: 9px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.56);
  color: rgba(226, 232, 240, 0.7);
  white-space: pre-wrap;
  word-break: break-all;
}
.cmd-approval-actions {
  justify-content: flex-end;
  margin-top: 11px;
}
.cmd-approval-btn {
  height: 31px;
  padding: 0 12px;
  border-radius: 9px;
  font-size: 11.5px;
  font-weight: 800;
  transition: transform 0.15s, filter 0.15s, opacity 0.15s;
}
.cmd-approval-btn:hover:not(:disabled) { transform: translateY(-1px); }
.cmd-approval-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.cmd-approval-btn.is-cancel {
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.055);
  color: rgba(226, 232, 240, 0.66);
}
.cmd-approval-btn.is-confirm {
  background: #fbbf24;
  color: #281705;
  box-shadow: 0 0 18px rgba(251, 191, 36, 0.22);
}
.cmd-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 8px;
  opacity: 0;
  transition: opacity 0.15s;
}
.cmd-bubble-ai:hover .cmd-actions,
.cmd-bubble-ai:focus-within .cmd-actions { opacity: 1; }
.cmd-action {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.42);
  transition: background 0.15s, color 0.15s;
}
.cmd-action:hover,
.cmd-action:focus-visible {
  color: rgba(255,255,255,0.9);
  background: rgba(255,255,255,0.1);
  outline: 0;
}
.cmd-quality-tag {
  display: inline-flex;
  align-items: center;
  height: 23px;
  padding: 0 7px;
  border: 1px solid color-mix(in srgb, var(--cmd-tone-2) 20%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--cmd-tone-2) 9%, transparent);
  color: rgba(199, 210, 254, 0.78);
  font-size: 10.5px;
  font-weight: 750;
}
.cmd-suggestion {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
  padding: 11px 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.018)),
    rgba(2, 6, 23, 0.3);
  color: rgba(255,255,255,0.8);
  font-size: 13.5px;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}
.cmd-suggestion::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--cmd-tone), transparent);
  opacity: 0;
}
.cmd-suggestion:hover,
.cmd-suggestion:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--cmd-tone) 34%, transparent);
  background:
    radial-gradient(circle at 14px 12px, color-mix(in srgb, var(--cmd-tone) 12%, transparent), transparent 42px),
    rgba(15, 23, 42, 0.46);
  color: #fff;
  outline: 0;
}
.cmd-suggestion:hover::before,
.cmd-suggestion:focus-visible::before { opacity: 0.8; }
.quote-preview,
.cmd-pending-bar,
.cmd-input-wrapper,
.cmd-footer {
  border-top: 1px solid var(--cmd-border);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.52), rgba(2, 6, 23, 0.34));
}
.quote-preview {
  border-left: 3px solid color-mix(in srgb, var(--cmd-tone) 70%, transparent);
}
.cmd-pending-bar {
  min-height: 68px;
}
.cmd-pending-thumb {
  position: relative;
  width: 54px;
  height: 54px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px;
  background: rgba(0,0,0,0.24);
}
.cmd-pending-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
}
.cmd-pending-x {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  place-items: center;
  color: rgba(255,255,255,0.9);
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.65));
  opacity: 0;
  transition: opacity 0.15s;
}
.cmd-pending-thumb:hover .cmd-pending-x { opacity: 1; }
.cmd-input-wrapper {
  padding: 13px 16px 12px;
  transition: background 0.2s;
}
.cmd-input-wrapper:focus-within {
  background: transparent;
}
.cmd-input-wrapper.is-drag-img {
  background: color-mix(in srgb, var(--cmd-tone) 7%, rgba(2, 6, 23, 0.34));
}
.cmd-composer {
  position: relative;
  display: flex;
  min-height: 56px;
  align-items: flex-end;
  gap: 12px;
  overflow: hidden;
  padding: 13px 12px 12px 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.58);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055);
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}
.cmd-composer::before {
  position: absolute;
  inset: 0 0 auto;
  height: 1px;
  pointer-events: none;
  content: '';
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--cmd-tone) 55%, transparent), transparent);
  opacity: 0;
  transition: opacity 0.2s ease;
}
.cmd-input-wrapper:focus-within .cmd-composer {
  border-color: color-mix(in srgb, var(--cmd-tone) 38%, rgba(148, 163, 184, 0.24));
  background: rgba(15, 23, 42, 0.64);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.065);
}
.cmd-input-wrapper.is-drag-img .cmd-composer::before,
.cmd-composer.has-images::before {
  opacity: 0.22;
}
.cmd-input-wrapper.is-drag-img .cmd-composer {
  border-color: color-mix(in srgb, var(--cmd-tone) 58%, rgba(255,255,255,0.18));
  background: color-mix(in srgb, var(--cmd-tone) 8%, rgba(15, 23, 42, 0.68));
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--cmd-tone) 12%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--cmd-tone) 18%, transparent);
}
.cmd-composer.is-disabled {
  opacity: 0.72;
}
.cmd-composer-main,
.cmd-composer > .cmd-send {
  position: relative;
  z-index: 1;
}
.cmd-composer-main {
  display: flex;
  min-height: 30px;
  align-items: flex-start;
  padding: 2px 0 3px;
}
.cmd-input {
  appearance: none;
  -webkit-appearance: none;
  min-height: 28px;
  border: 0;
  resize: none;
  overflow-y: auto;
  padding: 0;
  box-shadow: none;
  font: inherit;
  transition: height 0.15s ease-out;
}
.cmd-input:focus,
.cmd-input:focus-visible {
  background: transparent;
  box-shadow: none;
  outline: 0;
}
.cmd-input::placeholder {
  color: rgba(226, 232, 240, 0.34);
}
.cmd-input:disabled {
  cursor: not-allowed;
}
.cmd-avatar.has-content {
  animation: avatar-glow 2s ease-in-out infinite;
}
@keyframes avatar-glow {
  0%, 100% { box-shadow: 0 0 18px color-mix(in srgb, var(--cmd-tone) 18%, transparent), inset 0 1px 0 rgba(255,255,255,0.1); }
  50% { box-shadow: 0 0 28px color-mix(in srgb, var(--cmd-tone) 34%, transparent), inset 0 1px 0 rgba(255,255,255,0.16); }
}
.cmd-send {
  display: grid;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--cmd-tone) 42%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--cmd-tone) 82%, rgba(255,255,255,0.08));
  color: rgba(2, 6, 23, 0.92);
  box-shadow:
    0 8px 18px color-mix(in srgb, var(--cmd-tone) 16%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.22);
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.cmd-send:hover:not(:disabled),
.cmd-send:focus-visible:not(:disabled) {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--cmd-tone) 58%, rgba(255,255,255,0.2));
  background: color-mix(in srgb, var(--cmd-tone) 92%, white 4%);
  outline: 0;
}
.cmd-send:disabled {
  cursor: not-allowed;
  opacity: 0.42;
  background: rgba(148, 163, 184, 0.12);
  border-color: rgba(148, 163, 184, 0.12);
  color: rgba(226, 232, 240, 0.48);
  box-shadow: none;
}
.cmd-send.is-stop {
  background: linear-gradient(180deg, rgba(251,113,133,0.95), rgba(225,29,72,0.9));
  color: white;
  box-shadow: 0 10px 26px rgba(244,63,94,0.22), inset 0 1px 0 rgba(255,255,255,0.18);
}
.cmd-footer {
  display: flex;
  min-height: 38px;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  color: rgba(226, 232, 240, 0.34);
  font-size: 11px;
}
.cmd-footer-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cmd-footer-left svg { color: color-mix(in srgb, var(--cmd-tone) 70%, transparent); }
.resize-handle {
  display: flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border-bottom-right-radius: 14px;
  opacity: 0.35;
  transition: opacity 0.2s, background 0.2s;
}
.resize-handle:hover {
  background: rgba(255,255,255,0.05);
  opacity: 0.85;
}
.resize-icon {
  width: 10px;
  height: 10px;
  fill: rgba(255,255,255,0.5);
}
.resize-handle:hover .resize-icon { fill: color-mix(in srgb, var(--cmd-tone) 86%, white); }
.is-resizing,
.is-resizing * {
  cursor: se-resize !important;
  user-select: none;
  -webkit-user-select: none;
}
.cmd-user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 7px;
}
.cmd-user-img {
  max-width: 180px;
  max-height: 180px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  background: rgba(0,0,0,0.22);
  cursor: zoom-in;
  object-fit: contain;
}
.cmd-bubble-user .cmd-user-images:last-child { margin-bottom: 0; }
.content-fade-enter-active,
.content-fade-leave-active,
.quote-fade-enter-active,
.quote-fade-leave-active,
.activity-expand-enter-active,
.activity-expand-leave-active {
  transition: all 0.2s ease;
}
.content-fade-enter-from,
.content-fade-leave-to,
.quote-fade-enter-from,
.quote-fade-leave-to,
.activity-expand-enter-from,
.activity-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.activity-expand-enter-active,
.activity-expand-leave-active { overflow: hidden; }
.activity-expand-enter-from,
.activity-expand-leave-to {
  max-height: 0;
  margin-top: 0;
  padding-top: 0;
}
.activity-expand-enter-to,
.activity-expand-leave-from { max-height: 220px; }
.cmd-fade-enter-active,
.cmd-fade-leave-active { transition: opacity 0.2s ease; }
.cmd-fade-enter-from,
.cmd-fade-leave-to { opacity: 0; }
.cmd-pop-enter-active { transition: opacity 0.24s ease, transform 0.24s cubic-bezier(0.22, 1, 0.36, 1); }
.cmd-pop-leave-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.cmd-pop-enter-from { opacity: 0; transform: translateY(-12px) scale(0.96); }
.cmd-pop-leave-to { opacity: 0; transform: translateY(-8px) scale(0.98); }
.cmd-md { line-height: 1.65; position: relative; }
.cmd-md-raw { white-space: pre-wrap; word-break: break-word; }
.cmd-md :deep(> span > :first-child) { margin-top: 0; }
.cmd-md :deep(> span > :last-child) { margin-bottom: 0; }
.cmd-md :deep(p) { margin: 0.45em 0; }
.cmd-md :deep(h1),
.cmd-md :deep(h2),
.cmd-md :deep(h3),
.cmd-md :deep(h4) {
  margin: 0.7em 0 0.35em;
  color: rgba(255,255,255,0.96);
  font-weight: 700;
  line-height: 1.3;
}
.cmd-md :deep(h1) { font-size: 1.18em; }
.cmd-md :deep(h2) { font-size: 1.1em; }
.cmd-md :deep(h3) { font-size: 1.04em; }
.cmd-md :deep(ul),
.cmd-md :deep(ol) { margin: 0.45em 0; padding-left: 1.4em; }
.cmd-md :deep(ul) { list-style: disc; }
.cmd-md :deep(ol) { list-style: decimal; }
.cmd-md :deep(li) { margin: 0.24em 0; }
.cmd-md :deep(li::marker) { color: color-mix(in srgb, var(--cmd-tone) 72%, transparent); }
.cmd-md :deep(a) { color: rgb(125 211 252); text-decoration: underline; text-underline-offset: 2px; }
.cmd-md :deep(strong) { color: rgba(255,255,255,0.98); font-weight: 700; }
.cmd-md :deep(em) { font-style: italic; }
.cmd-md :deep(code) {
  padding: 0.1em 0.36em;
  border-radius: 5px;
  background: color-mix(in srgb, var(--cmd-tone) 10%, rgba(255,255,255,0.07));
  color: color-mix(in srgb, var(--cmd-tone) 82%, white);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.86em;
}
.cmd-md :deep(.code-block-wrapper) {
  position: relative;
  margin: 0.65em 0;
}
.cmd-md :deep(.code-block-header) {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-bottom: none;
  border-radius: 10px 10px 0 0;
  background: rgba(2, 6, 23, 0.5);
  color: rgba(255,255,255,0.52);
  font-size: 12px;
}
.cmd-md :deep(.code-lang) {
  color: color-mix(in srgb, var(--cmd-tone) 84%, white);
  font-weight: 700;
}
.cmd-md :deep(.code-line-count) { opacity: 0.5; font-size: 11px; }
.cmd-md :deep(.code-copy-btn) {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  background: rgba(255,255,255,0.07);
  color: rgba(255,255,255,0.62);
  cursor: pointer;
  font-size: 11px;
  transition: all 0.15s;
}
.cmd-md :deep(.code-copy-btn:hover) {
  background: color-mix(in srgb, var(--cmd-tone) 16%, transparent);
  color: rgba(255,255,255,0.92);
}
.cmd-md :deep(.code-copy-btn.copied) {
  background: rgba(74,222,128,0.15);
  color: rgb(74 222 128);
}
.cmd-md :deep(pre) {
  margin: 0;
  overflow-x: auto;
  padding: 0.75em 0.9em;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-top: none;
  border-radius: 0 0 10px 10px;
  background: rgba(0,0,0,0.42);
}
.cmd-md :deep(pre code) {
  display: block;
  padding: 0;
  background: transparent;
  color: rgba(255,255,255,0.86);
  white-space: pre;
}
.cmd-md :deep(blockquote) {
  margin: 0.55em 0;
  padding: 0.25em 0.9em;
  border-left: 3px solid color-mix(in srgb, var(--cmd-tone) 48%, transparent);
  color: rgba(255,255,255,0.72);
}
.cmd-md :deep(hr) { margin: 0.75em 0; border: none; border-top: 1px solid rgba(255,255,255,0.12); }
.cmd-md :deep(table) {
  width: 100%;
  margin: 0.6em 0;
  overflow: hidden;
  border-collapse: collapse;
  border-radius: 9px;
  font-size: 0.92em;
}
.cmd-md :deep(th),
.cmd-md :deep(td) {
  border: 1px solid rgba(255,255,255,0.1);
  padding: 0.45em 0.7em;
  text-align: left;
}
.cmd-md :deep(th) {
  position: sticky;
  z-index: 1;
  top: 0;
  background: color-mix(in srgb, var(--cmd-tone) 15%, rgba(2,6,23,0.6));
  color: rgba(255,255,255,0.95);
  font-weight: 700;
}
.cmd-md :deep(tr:nth-child(even)) { background: rgba(255,255,255,0.03); }
.cmd-md :deep(tr:nth-child(odd)) { background: rgba(255,255,255,0.01); }
.cmd-md :deep(tr:hover) { background: color-mix(in srgb, var(--cmd-tone) 8%, transparent); }
@media (max-width: 760px) {
  .cmd-shell { padding: 14px 10px; }
  .cmd-header { padding: 16px; flex-wrap: wrap; }
  .cmd-header-actions { width: 100%; justify-content: space-between; }
  .cmd-subtitle { white-space: normal; }
  .cmd-footer { flex-wrap: wrap; min-height: auto; padding: 9px 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .cmd-accent,
  .cmd-dot,
  .cmd-caret,
  .cmd-avatar.has-content,
  .cmd-activity.running::before,
  .cmd-fade-enter-active,
  .cmd-fade-leave-active,
  .cmd-pop-enter-active,
  .cmd-pop-leave-active,
  .quote-fade-enter-active,
  .quote-fade-leave-active,
  .content-fade-enter-active,
  .content-fade-leave-active,
  .activity-expand-enter-active,
  .activity-expand-leave-active {
    animation: none;
    transition: none;
  }
  .cmd-suggestion:hover,
  .cmd-send:hover:not(:disabled) { transform: none; }
}
</style>
