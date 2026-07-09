<script setup lang="ts">
/**
 * Sparkline（迷你折线 / 面积，KPI 可视化原语）
 *
 * 输入一个或两个数值序列，自动归一化到画布，画平滑折线 + 可选面积填充 + 端点高亮。
 * 典型用途：未来 7 天温度趋势（max/min 双线）、提交频次等。
 *
 * 设计：
 *  - 纯 SVG polyline + path；宽高自适应；min/max 自动或指定。
 *  - 双线模式：series2 以更暗的辅色画，用于 max/min 这类成对数据。
 *  - 端点圆点 + 末点 glow，强化「最新值」。
 *  - 无障碍：aria-hidden 装饰，由父组件用文字说明数据含义（避免重复）。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 主序列 */
    data: number[]
    /** 辅序列（如最低温），可选 */
    data2?: number[]
    /** 画布宽，默认 120 */
    width?: number
    /** 画布高，默认 36 */
    height?: number
    /** 主色（CSS 字面量） */
    tone?: string
    /** 辅色 */
    tone2?: string
    /** 是否填充面积，默认 true */
    fill?: boolean
    /** 是否画端点圆点，默认 true */
    dots?: boolean
    /** 固定上下界（不传则取数据极值） */
    min?: number
    max?: number
  }>(),
  {
    data: () => [],
    data2: () => [],
    width: 120,
    height: 36,
    tone: 'var(--hud-cyan)',
    tone2: 'rgba(125, 211, 252, 0.45)',
    fill: true,
    dots: true,
    min: undefined,
    max: undefined,
  },
)

const PAD = 3 // 上下留白，避免线条贴边

const bounds = computed(() => {
  const all = [...props.data, ...(props.data2.length ? props.data2 : [])]
  if (!all.length) return { lo: 0, hi: 1 }
  const lo = props.min ?? Math.min(...all)
  const hi = props.max ?? Math.max(...all)
  // 归一化分母不能为 0
  return { lo, hi: hi === lo ? lo + 1 : hi }
})

/** 把一个序列映射成画布坐标点数组 */
function toPoints(series: number[]) {
  const n = series.length
  if (!n) return [] as { x: number; y: number }[]
  const { lo, hi } = bounds.value
  const span = hi - lo
  const innerH = props.height - PAD * 2
  return series.map((v, i) => ({
    x: n === 1 ? props.width / 2 : (i / (n - 1)) * props.width,
    y: PAD + (1 - (v - lo) / span) * innerH,
  }))
}

const pts = computed(() => toPoints(props.data))
const pts2 = computed(() => toPoints(props.data2))

function toPolyline(p: { x: number; y: number }[]) {
  return p.map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ')
}
function toAreaPath(p: { x: number; y: number }[]) {
  if (p.length < 2) return ''
  const head = `M ${p[0].x.toFixed(2)},${p[0].y.toFixed(2)}`
  const line = p
    .slice(1)
    .map((pt) => `L ${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
    .join(' ')
  const close = `L ${p.at(-1)!.x.toFixed(2)},${props.height} L ${p[0].x.toFixed(2)},${props.height} Z`
  return `${head} ${line} ${close}`
}

const polyline = computed(() => toPolyline(pts.value))
const polyline2 = computed(() => toPolyline(pts2.value))
const areaPath = computed(() => toAreaPath(pts.value))
const last = computed(() => (pts.value.length ? pts.value.at(-1) : null))
</script>

<template>
  <svg
    class="sparkline"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="`sp-grad-${width}-${height}`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="tone" stop-opacity="0.32" />
        <stop offset="100%" :stop-color="tone" stop-opacity="0" />
      </linearGradient>
    </defs>

    <!-- 辅线（先画，置于主线之下） -->
    <polyline
      v-if="pts2.length > 1"
      class="spark-line spark-line-2"
      :points="polyline2"
      :stroke="tone2"
      fill="none"
    />

    <!-- 主线面积 -->
    <path
      v-if="fill && pts.length > 1"
      class="spark-area"
      :d="areaPath"
      :fill="`url(#sp-grad-${width}-${height})`"
    />
    <!-- 主线 -->
    <polyline
      v-if="pts.length > 1"
      class="spark-line"
      :points="polyline"
      :stroke="tone"
      fill="none"
    />

    <!-- 端点圆点 -->
    <template v-if="dots">
      <circle
        v-if="pts.length === 1"
        :cx="pts[0].x"
        :cy="pts[0].y"
        r="2"
        :fill="tone"
      />
      <circle v-if="last" class="spark-end" :cx="last.x" :cy="last.y" r="2.4" :fill="tone" />
    </template>
  </svg>
</template>

<style scoped>
.sparkline { display: block; }
.spark-line {
  stroke-width: 1.6;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.spark-line-2 {
  stroke-width: 1.2;
  stroke-dasharray: 2 2;
}
.spark-area { opacity: 0.9; }
.spark-end {
  filter: drop-shadow(0 0 4px rgba(56, 189, 248, 0.7));
}
@media (prefers-reduced-motion: reduce) {
  .spark-end { filter: none; }
}
</style>
