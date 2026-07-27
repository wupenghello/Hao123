/**
 * 小吴 · 常驻 AI 伙伴（桌宠）类型定义
 *
 * 渲染引擎（Live2D / Rive / Lottie / 占位）与行为引擎（mood / speech / 交互）通过
 * CompanionRenderer 接口解耦——换引擎只换一个 renderer 文件，行为层零改动。
 */
export type CompanionMood =
  | 'sleeping' // 未配置 LLM：休息
  | 'offline' // 配置了但连不上：掉线
  | 'thinking' // 正在生成：思考
  | 'celebrating' // 近期完成事件：庆祝（瞬态）
  | 'attentive' // 面板关时收到新回复：有新消息
  | 'concerned' // 逾期 / 临期：需留意
  | 'greeting' // 当日首见：问候（瞬态）
  | 'idle' // 默认：待命

export type CompanionRendererKind = 'live2d' | 'rive' | 'lottie'

export interface CompanionGrowth {
  /** git 提交计数（成功 push / commit 时 +1，展示用，非精确统计） */
  commits: number
  /** 本地任务完成计数 */
  tasksDone: number
}

export interface CompanionState {
  /** 拖拽后的绝对位置（null = CSS 默认右下角） */
  position: { left: number; top: number } | null
  /** 静音到某时刻（时间戳 ms）；null = 未静音 */
  mutedUntil: number | null
  /** 免打扰到某时刻（如明早 8 点）；null = 无 */
  sleepUntil: number | null
  /** 最近一次问候日期 yyyy-MM-dd（同日不重复问候） */
  lastGreetDate: string | null
  /** 已开口过的洞察签名（签名不变不重弹） */
  shownInsightSig: string | null
  /** 已手动关闭的气泡 id（cap 20，防膨胀） */
  dismissedBubbles: string[]
  /** 渲染器（默认 live2d） */
  renderer: CompanionRendererKind
  /** 模型源 URL（默认 Senko） */
  modelSource: string | null
  /** codepet 式成长计数（展示用） */
  growth: CompanionGrowth
}

export type BubbleKind = 'greeting' | 'insight' | 'recovery' | 'celebration'

export interface BubblePayload {
  id: string
  kind: BubbleKind
  text: string
  /** 可选 hand-off 按钮文案 */
  actionLabel?: string
  /** 点击按钮的回调（带上下文交给小吴深聊） */
  handoff?: () => void
}

export interface RendererOpts {
  modelSource: string
  reducedMotion: boolean
  parentMood: CompanionMood
  /** 模型就绪回调 */
  onReady?: () => void
  /** 加载 / 运行出错回调（触发降级到占位） */
  onError?: (e: unknown) => void
}

/** 渲染器抽象：与行为引擎解耦，可换 Live2D / Rive / Lottie / 占位 */
export interface CompanionRenderer {
  mount(container: HTMLElement, opts: RendererOpts): Promise<void>
  setMood(mood: CompanionMood): void
  /** 鼠标跟随（模型支持才实现） */
  lookAt?(x: number, y: number): void
  /** 一次性动作（挥手 / 欢呼），模型支持才实现 */
  playOnce?(motion: string): void
  /** 切后台 / reduced-motion / 静默 → 停 ticker 省电 */
  setPaused(paused: boolean): void
  /** 口型同步（接 TTS 才用，当前留接口） */
  speak?(active: boolean): void
  destroy(): void
}
