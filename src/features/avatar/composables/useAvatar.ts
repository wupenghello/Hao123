/**
 * Avatar 模块 · 响应式状态层
 *
 * 把 AvatarRenderer 的指令式 API 包成 Vue 响应式状态 + 命令式方法，
 * 让组件/上层 store 都能用同一套接口驱动 avatar。
 *
 * 使用方式：
 *   const avatar = useAvatar({ url: '...' })
 *   avatar.speaking.value = true
 *   avatar.setExpression('happy')
 *   // 挂载：<AvatarStage ref="stageRef" :config="config" @ready="..." />
 *   // 通过 rendererRef 把渲染器实例注册进来
 */
import { ref, shallowRef, readonly } from 'vue'
import { AvatarRenderer } from '../Live2dRenderer'
import type { AvatarExpression, AvatarModelConfig, AvatarState } from '../types'
import { DEFAULT_MODEL_CONFIG } from '../config'

export interface UseAvatarOptions {
  /** 模型配置，不填用默认 Shizuku */
  config?: AvatarModelConfig
  /** 是否默认开启视线追随鼠标 */
  mouseTrack?: boolean
}

export function useAvatar(options: UseAvatarOptions = {}) {
  const config = options.config ?? DEFAULT_MODEL_CONFIG
  const mouseTrack = options.mouseTrack ?? true

  // 渲染器实例（非响应式，避免 Proxy 污染 PIXI 内部）
  const renderer = shallowRef<AvatarRenderer | null>(null)

  // 状态（只读暴露）
  const state = ref<AvatarState>({
    ready: false,
    speaking: false,
    expression: 'neutral',
    message: null,
  })

  // 内部 mouse handler 引用（便于卸载）
  let mouseHandler: ((e: MouseEvent) => void) | null = null

  /** 注册渲染器实例（AvatarStage 挂载后调用） */
  function attach(r: AvatarRenderer): void {
    renderer.value = r
    r.onReady(() => {
      state.value = { ...state.value, ready: true, message: null }
    })
    r.onError((e) => {
      state.value = { ...state.value, ready: false, message: e.message }
    })
    r.start()
  }

  /** 解绑渲染器 */
  function detach(): void {
    stopMouseTrack()
    renderer.value?.destroy()
    renderer.value = null
    state.value = { ready: false, speaking: false, expression: 'neutral', message: null }
  }

  // —— 语义 API ——

  function setSpeaking(on: boolean): void {
    state.value = { ...state.value, speaking: on }
    renderer.value?.setSpeaking(on)
  }

  function setExpression(expr: AvatarExpression): void {
    state.value = { ...state.value, expression: expr }
    renderer.value?.setExpression(expr)
  }

  /** 短暂表达一个表情后回弹（用于反馈/提示） */
  function flashExpression(expr: AvatarExpression, durationMs = 1500): void {
    setExpression(expr)
    setTimeout(() => {
      if (state.value.expression === expr) setExpression('neutral')
    }, durationMs)
  }

  function focus(x: number, y: number): void {
    renderer.value?.focus(x, y)
  }

  function focusReset(): void {
    renderer.value?.focusReset()
  }

  function tap(x: number, y: number): void {
    renderer.value?.tap(x, y)
  }

  function reset(): void {
    state.value = { ...state.value, speaking: false, expression: 'neutral' }
    renderer.value?.reset()
  }

  /** 启动鼠标追随 */
  function startMouseTrack(): void {
    if (mouseHandler) return
    mouseHandler = (e: MouseEvent) => {
      renderer.value?.focus(e.clientX, e.clientY)
    }
    window.addEventListener('mousemove', mouseHandler)
  }

  function stopMouseTrack(): void {
    if (mouseHandler) {
      window.removeEventListener('mousemove', mouseHandler)
      mouseHandler = null
    }
  }

  function toggleMouseTrack(): boolean {
    if (mouseHandler) {
      stopMouseTrack()
      return false
    } else {
      startMouseTrack()
      return true
    }
  }

  // 自动管理 mouse track
  if (mouseTrack) {
    // 延迟到下一个 tick，确保 renderer 已 attach
    // 但 attach 里再启动更稳妥——这里只标记意图
  }

  return {
    config,
    readonlyState: readonly(state),
    state,
    attach,
    detach,
    setSpeaking,
    setExpression,
    flashExpression,
    focus,
    focusReset,
    tap,
    reset,
    startMouseTrack,
    stopMouseTrack,
    toggleMouseTrack,
    isReady: () => state.value.ready,
  }
}

export type UseAvatarReturn = ReturnType<typeof useAvatar>
