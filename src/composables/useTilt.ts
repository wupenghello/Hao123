import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue'
import VanillaTilt, { type TiltOptions } from 'vanilla-tilt'

export interface UseTiltOptions {
  /** 最大旋转角（度）。推荐 6-10（信息密集卡 ≤10），默认 7 */
  max?: number
  /** 进出场回正时长 ms（规格 300-400），默认 350 */
  speed?: number
  /** 透视距离 px（规格 1000），默认 1000 */
  perspective?: number
  /** hover 放大，默认 1.01 */
  scale?: number
  /** 动态 glare 高光，默认 true */
  glare?: boolean
  /** glare 最大透明度（规格 .3-.5 内）；含下拉菜单 / 行内表单的卡传 0 避免 z-index 冲突 */
  maxGlare?: number
}

type TiltElement = HTMLElement & { vanillaTilt?: VanillaTilt }

/**
 * 3D tilt —— vanilla-tilt 的 Vue 包装
 *
 * - 仅在 `(hover: hover) and (pointer: fine)` 且未开 `prefers-reduced-motion`
 *   时初始化，否则 no-op（触屏 / 减动效用户得到静态卡片）。
 * - watch 等待元素就绪（支持 v-if / v-else-if 延迟渲染）；目标元素被替换或
 *   卸载时自动 destroy 旧实例；scope 结束时全部清理。
 * - 跟手平滑（rAF）由 vanilla-tilt 内部处理；进出场固定
 *   cubic-bezier(.03,.98,.52,.99)（两大 tilt 库同款，≈ easeOut 带轻微回弹）。
 * - glare 需宿主 overflow:hidden 裁切圆角（bento-cell / gd-stat 均已满足）。
 */
export function useTilt(
  target: MaybeRefOrGetter<TiltElement | null | undefined>,
  options: UseTiltOptions = {},
): { destroy: () => void } {
  const opts: TiltOptions = {
    max: options.max ?? 7,
    speed: options.speed ?? 350,
    perspective: options.perspective ?? 1000,
    scale: options.scale ?? 1.01,
    glare: options.glare ?? true,
    'max-glare': options.maxGlare ?? 0.22,
    gyroscope: false,
    easing: 'cubic-bezier(.03,.98,.52,.99)',
  }

  let last: TiltElement | null = null

  const destroy = () => {
    last?.vanillaTilt?.destroy()
    last = null
  }

  const eligible =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (eligible) {
    watch(
      () => toValue(target) ?? null,
      (el) => {
        if (last && last !== el) {
          last.vanillaTilt?.destroy()
          last = null
        }
        if (!el || el.vanillaTilt) return
        VanillaTilt.init(el, opts)
        last = el
      },
      { immediate: true, flush: 'post' },
    )
    onScopeDispose(destroy)
  }

  return { destroy }
}
