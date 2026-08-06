/**
 * Avatar 模块 · 渲染器核心
 *
 * 封装 PIXI.Application + pixi-live2d-display 的 Live2DModel，
 * 提供高层语义 API（说话/表情/视线），把 Live2D 参数细节藏起来。
 *
 * 设计要点：
 *  - 渲染器不知道 AI 是谁，只暴露 setSpeaking / setExpression / focus 等语义接口
 *  - idle 动画（眨眼/呼吸/视线平滑）由内部 Ticker 自驱，上层不用管
 *  - 所有参数写入都走 lerp 平滑，避免跳变
 *
 * 兼容性：
 *  - pixi-live2d-display 0.4.0 在模块顶层检查 Cubism 运行时是否存在，
 *    因此本模块不静态 import 它，而是在 start() 里先加载运行时再动态 import，
 *    避免模块加载时报 "Could not find Cubism runtime"。
 *  - PIXI v7 类型下 Live2DModel 的 DisplayObject 接口有差异，内部用 any 转型兼容。
 */
import type { AvatarExpression, AvatarModelConfig } from './types'
import {
  EXPRESSION_MAPPINGS,
  PARAM,
  BLINK_INTERVAL_MIN,
  BLINK_INTERVAL_MAX,
  BREATH_CYCLE_MS,
  FOCUS_SMOOTHING,
  SPEAK_MOUTH_MAX,
  SPEAK_MOUTH_FREQ,
  clampScaleFactor,
} from './config'

/** 内部平滑参数状态 */
interface SmoothParam {
  current: number
  target: number
}

export class AvatarRenderer {
  private app: any = null // PIXI.Application（动态 import 后赋值，避免顶层依赖）
  private model: any = null // Live2DModel
  private container: any = null // PIXI.Container
  private canvas: HTMLCanvasElement

  // —— 动画状态 ——
  private speaking = false
  private expression: AvatarExpression = 'neutral'
  private mouthOpenBase = 0

  // 平滑参数
  private params: Record<string, SmoothParam> = {}
  private focusX = 0
  private focusY = 0

  // 缩放：fitScale = 自适应基准；scaleFactor = 用户倍数（边界限定）
  private fitScale = 1
  private scaleFactor = 1

  // 计时
  private blinkTimer = 0
  private nextBlinkAt = 0
  private elapsed = 0

  private onReadyCb: (() => void) | null = null
  private onErrorCb: ((e: Error) => void) | null = null
  private readonly cfg: AvatarModelConfig

  constructor(canvas: HTMLCanvasElement, cfg: AvatarModelConfig) {
    this.canvas = canvas
    this.cfg = cfg
    this.resetBlinkTimer()
  }

  /** 加载运行时 + 动态 import 模块 + 创建模型 + 启动渲染循环 */
  async start(): Promise<void> {
    try {
      // 动态 import（避免顶层 import 触发运行时检查）
      // 使用 /cubism4 入口：只检查 Cubism 4 运行时；index.js 会同时检查 Cubism 2 + 4
      const [{ Application, Container }, { Live2DModel, config: live2dConfig }] = await Promise.all([
        import('pixi.js'),
        import('pixi-live2d-display/cubism4'),
      ])

      // 关闭 Live2D 内部日志
      live2dConfig.logLevel = live2dConfig.LOG_LEVEL_NONE

      this.app = new Application({
        view: this.canvas,
        width: this.canvas.clientWidth || 300,
        height: this.canvas.clientHeight || 400,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        // 形象纯展示、不参与 PIXI 命中检测（交互都在外层 DOM 上）。
        // PIXI 的 EventSystem 会在 document（pointermove，capture）与
        // globalThis（pointerup，capture）上挂全局监听，页面上任何指针动作都会
        // 触发对舞台的 hitTest；而 pixi-live2d-display（为 PIXI v6 设计）挂进场景的
        // 子节点不全是标准 DisplayObject，hitTestMoveRecursive 调 isInteractive()
        // 直接抛 "currentTarget.isInteractive is not a function"，鼠标一动就刷屏报错。
        // 通过 eventFeatures 关闭 move/click/wheel：每个 handler 在 hitTest 之前有
        // `if (!this.features.X) return;` 早返回，根本不做命中检测，从根源消除报错。
        // 渲染与 ticker 不受影响（形象不需要任何 PIXI 交互）。
        eventFeatures: { move: false, click: false, wheel: false },
      })
      this.container = new Container()
      this.app.stage.addChild(this.container)

      const model = await Live2DModel.from(this.cfg.url, { autoInteract: false })
      this.model = model

      const canvasW = this.app.renderer.width
      const canvasH = this.app.renderer.height

      // 自适应缩放：根据模型原始画布尺寸算出"恰好填充 canvas"的 scale。
      // 固定 scale 会因模型画布尺寸差异而严重过大/过小（Hiyori 画布约 1280×1380）。
      // cfg.scale 显式给定则覆盖（手工微调用），否则自动 fit。
      const im: any = model.internalModel
      const origW: number = im?.originalWidth || model.width
      const origH: number = im?.originalHeight || model.height
      const fitScale = Math.min(canvasW / origW, canvasH / origH) * 1.0
      this.fitScale = fitScale
      this.scaleFactor = clampScaleFactor(this.cfg.scaleFactor ?? 1)
      // cfg.scale 手动覆盖优先；否则用 fitScale * 用户倍数
      const scale = this.cfg.scale ?? fitScale * this.scaleFactor
      model.scale.set(scale)

      // 居中显示：anchor 到模型画布中心，对齐 canvas 中心
      model.anchor.set(0.5, 0.5)
      model.position.set(canvasW / 2, canvasH / 2)

      this.container.addChild(model as any)

      // 双保险：把舞台与模型都设为非交互，避免 hitTest 递归进非标准子节点。
      this.app.stage.eventMode = 'none'
      this.app.stage.interactiveChildren = false
      ;(model as any).eventMode = 'none'
      ;(model as any).interactiveChildren = false

      // 初始化平滑参数
      this.initParam(PARAM.ANGLE_X)
      this.initParam(PARAM.ANGLE_Y)
      this.initParam(PARAM.ANGLE_Z)
      this.initParam(PARAM.EYE_L_OPEN)
      this.initParam(PARAM.EYE_R_OPEN)
      this.initParam(PARAM.MOUTH_OPEN_Y)
      this.initParam(PARAM.BODY_ANGLE_X)
      this.initParam(PARAM.BREATH)

      this.app.ticker.add(this.tick)

      this.onReadyCb?.()
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      this.onErrorCb?.(err)
    }
  }

  // —— 对外语义 API ——

  setSpeaking(on: boolean): void {
    this.speaking = on
  }

  setExpression(expr: AvatarExpression): void {
    this.expression = expr
    const mapping = EXPRESSION_MAPPINGS[expr]
    if (!mapping) return

    if (mapping.motionGroup) {
      this.model?.motion(mapping.motionGroup, mapping.motionIndex)
    }
    if (mapping.params) {
      for (const [id, val] of Object.entries(mapping.params)) {
        this.setTargetParam(id, val)
      }
    }
    this.mouthOpenBase = mapping.params?.[PARAM.MOUTH_OPEN_Y] ?? 0
  }

  focus(x: number, y: number): void {
    if (!this.model) return
    const rect = this.canvas.getBoundingClientRect()
    const localX = x - rect.left
    const localY = y - rect.top
    this.focusX = (localX / rect.width) * 2 - 1
    this.focusY = (localY / rect.height) * 2 - 1
  }

  focusReset(): void {
    this.focusX = 0
    this.focusY = 0
  }

  tap(x: number, y: number): void {
    if (!this.model) return
    const rect = this.canvas.getBoundingClientRect()
    const localX = x - rect.left
    const localY = y - rect.top
    const hit = this.model.hitTest(localX, localY)
    if (hit.length) {
      this.model.motion('tap_body')
    } else {
      this.model.motion('idle')
    }
  }

  reset(): void {
    this.setExpression('neutral')
    this.setSpeaking(false)
    this.focusReset()
  }

  /** 设置缩放倍数（相对自适应 fit，边界限定）；立即应用到当前模型 */
  setScaleFactor(f: number): void {
    this.scaleFactor = clampScaleFactor(f)
    if (this.model) {
      const scale = this.cfg.scale ?? this.fitScale * this.scaleFactor
      this.model.scale.set(scale)
    }
  }

  /** 读取当前缩放倍数 */
  getScaleFactor(): number {
    return this.scaleFactor
  }

  onReady(cb: () => void): void {
    this.onReadyCb = cb
  }
  onError(cb: (e: Error) => void): void {
    this.onErrorCb = cb
  }

  // —— 内部方法 ——

  private initParam(id: string): void {
    const v = this.getParamCurrent(id)
    this.params[id] = { current: v, target: v }
  }

  private setTargetParam(id: string, target: number): void {
    const p = this.params[id]
    if (p) p.target = target
    else this.params[id] = { current: target, target }
  }

  private getParamCurrent(id: string): number {
    if (!this.model?.internalModel) return 0
    try {
      const core = (this.model.internalModel as any).coreModel
      if (core?.getParamFloat) return Number(core.getParamFloat(id)) || 0
    } catch {
      // 忽略
    }
    return 0
  }

  private applyParam(id: string, value: number): void {
    if (!this.model?.internalModel) return
    try {
      const core = (this.model.internalModel as any).coreModel
      if (core?.setParamFloat) core.setParamFloat(id, value)
    } catch {
      // 忽略
    }
  }

  private resetBlinkTimer(): void {
    this.blinkTimer = 0
    this.nextBlinkAt = BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN)
  }

  private tick = (): void => {
    if (!this.model?.internalModel) return
    const dt = this.app.ticker.deltaMS
    this.elapsed += dt

    // 1. 呼吸
    const breath = (Math.sin(this.elapsed / BREATH_CYCLE_MS * Math.PI * 2) + 1) / 2
    this.setTargetParam(PARAM.BREATH, breath)
    this.setTargetParam(PARAM.BODY_ANGLE_X, breath * 2 - 1)

    // 2. 视线追随
    const maxAngle = 15
    this.setTargetParam(PARAM.ANGLE_Y, this.focusX * maxAngle)
    this.setTargetParam(PARAM.ANGLE_X, -this.focusY * maxAngle * 0.5)
    this.setTargetParam(PARAM.ANGLE_Z, this.focusX * maxAngle * 0.3)

    // 3. 眨眼
    this.blinkTimer += dt
    let blinkValue = 1
    if (this.blinkTimer >= this.nextBlinkAt) {
      const blinkPhase = this.blinkTimer - this.nextBlinkAt
      const blinkDuration = 150
      if (blinkPhase < blinkDuration) {
        const t = blinkPhase / blinkDuration
        blinkValue = Math.abs(Math.cos(t * Math.PI))
      } else {
        this.resetBlinkTimer()
      }
    }
    if (this.expression !== 'surprised') {
      const eyeL = this.params[PARAM.EYE_L_OPEN]?.target ?? 1
      const eyeR = this.params[PARAM.EYE_R_OPEN]?.target ?? 1
      this.setTargetParam(PARAM.EYE_L_OPEN, blinkValue * eyeL)
      this.setTargetParam(PARAM.EYE_R_OPEN, blinkValue * eyeR)
    }

    // 4. 说话嘴型
    if (this.speaking) {
      const osc = (Math.sin(this.elapsed / 1000 * Math.PI * 2 * SPEAK_MOUTH_FREQ) + 1) / 2
      this.setTargetParam(PARAM.MOUTH_OPEN_Y, this.mouthOpenBase + osc * SPEAK_MOUTH_MAX)
    }

    // 5. 参数平滑写入
    const lerp = FOCUS_SMOOTHING
    for (const [id, p] of Object.entries(this.params)) {
      p.current += (p.target - p.current) * lerp
      this.applyParam(id, p.current)
    }
  }

  destroy(): void {
    if (this.app) {
      this.app.ticker.remove(this.tick)
      this.model?.destroy()
      // false = 不销毁 canvas DOM（canvas 由 Vue 管理，切形象时 Vue 用 :key 重建元素）
      this.app.destroy(false, { children: true, texture: true })
    }
    this.model = null
    this.app = null
  }
}
