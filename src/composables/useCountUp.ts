import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

export interface CountUpOptions {
  /** 滚动时长 ms，默认 850 */
  duration?: number
  /** 小数位，默认 0 */
  decimals?: number
}

/**
 * KPI 数字滚动：从旧值 ~850ms easeOutExpo 滚到新值。
 *
 * - 输出经 Intl.NumberFormat（千分位 + 天然 tabular 友好），配 .kpi-num 等宽不抖。
 * - watch 目标变化自动重跑（数据刷新时从旧值续滚，不从 0 重来）。
 * - prefers-reduced-motion 下瞬时到位，不起 rAF。
 */
export function useCountUp(
  target: MaybeRefOrGetter<number>,
  opts: CountUpOptions = {},
): Ref<string> {
  const duration = opts.duration ?? 850
  const decimals = opts.decimals ?? 0
  const fmt = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  const display = ref(fmt.format(toValue(target) || 0))

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let raf = 0
  const stop = () => {
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }

  watch(
    () => toValue(target) || 0,
    (to, from) => {
      stop()
      const from0 = from ?? 0
      if (reduced || from0 === to) {
        display.value = fmt.format(to)
        return
      }
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        // easeOutExpo
        const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
        display.value = fmt.format(from0 + (to - from0) * eased)
        if (t < 1) raf = requestAnimationFrame(tick)
        else raf = 0
      }
      raf = requestAnimationFrame(tick)
    },
    { immediate: true },
  )

  onScopeDispose(stop)
  return display
}
