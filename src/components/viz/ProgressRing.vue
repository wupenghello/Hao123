<script setup lang="ts">
/**
 * 进度环 / 分段环（KPI 可视化原语）
 *
 * 两种用法：
 *  - 单值环：传 value + max，画一段强调弧 + 灰轨（如「本地待办完成率」）。
 *  - 分段环：传 segments[]，按比例切多段（如风险分布 overdue/dueSoon/stalled/ok）。
 *
 * 设计：
 *  - 纯 SVG，stroke-dasharray 画弧；size / thickness 可调；圆角端点。
 *  - 无障碍：有 label 时 role="img" + aria-label，否则 aria-hidden 做装饰。
 *  - 进场有一次性 draw 动画，prefers-reduced-motion 下关闭。
 *  - tone 走 CSS 变量，默认对齐 HUD palette（cyan/teal/warn/danger/violet/muted）。
 */
import { computed } from 'vue'

interface Segment {
  /** 该段数值（>0 才画） */
  value: number
  /** 该段颜色（CSS 颜色字面量），不传则按 tone 取默认 */
  tone?: string
}

const props = withDefaults(
  defineProps<{
    /** 单值模式的当前值（与 max 配合；传了 segments 则忽略） */
    value?: number
    /** 单值模式总量，默认 100 */
    max?: number
    /** 分段模式段集合 */
    segments?: Segment[]
    /** 单值模式的强调色（CSS 字面量） */
    tone?: string
    /** 环外径 px */
    size?: number
    /** 描边宽度 px */
    thickness?: number
    /** 无障碍标签；传了则 role=img，否则装饰性 aria-hidden */
    label?: string
    /** 中心自定义内容是否显示（默认由插槽控制，此处仅占位） */
  }>(),
  {
    value: 0,
    max: 100,
    segments: () => [],
    tone: 'var(--hud-cyan)',
    size: 88,
    thickness: 8,
    label: undefined,
  },
)

const radius = computed(() => (props.size - props.thickness) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const center = computed(() => props.size / 2)

// 单值模式：弧长 = 比例 × 周长
const singleFraction = computed(() => {
  const m = props.max <= 0 ? 1 : props.max
  return Math.max(0, Math.min(1, props.value / m))
})

// 分段模式：归一化 + 累计偏移
const segs = computed(() => {
  const total = props.segments.reduce((s, x) => s + Math.max(0, x.value), 0)
  if (total <= 0) return []
  let acc = 0
  return props.segments
    .filter((x) => x.value > 0)
    .map((x) => {
      const frac = x.value / total
      const seg = {
        tone: x.tone ?? 'var(--hud-cyan)',
        frac,
        arc: frac * circumference.value,
        offset: -acc * circumference.value, // 负偏移让段顺时针首尾相接
      }
      acc += frac
      return seg
    })
})

const isMulti = computed(() => props.segments.length > 0)
</script>

<template>
  <svg
    class="progress-ring"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${size} ${size}`"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  >
    <!-- 灰轨 -->
    <circle
      class="ring-track"
      :cx="center"
      :cy="center"
      :r="radius"
      :stroke-width="thickness"
      fill="none"
    />
    <!-- 分段模式 -->
    <g v-if="isMulti">
      <circle
        v-for="(s, i) in segs"
        :key="i"
        class="ring-seg"
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke="s.tone"
        :stroke-width="thickness"
        :stroke-dasharray="`${s.arc} ${circumference - s.arc}`"
        :stroke-dashoffset="s.offset"
        stroke-linecap="round"
        fill="none"
      />
    </g>
    <!-- 单值模式 -->
    <circle
      v-else
      class="ring-seg ring-single"
      :cx="center"
      :cy="center"
      :r="radius"
      :stroke="tone"
      :stroke-width="thickness"
      :stroke-dasharray="`${singleFraction * circumference} ${circumference}`"
      stroke-linecap="round"
      fill="none"
    />
  </svg>
</template>

<style scoped>
.progress-ring {
  display: block;
  transform: rotate(-90deg); /* 起点拨到 12 点钟 */
}
.ring-track {
  stroke: rgba(148, 163, 184, 0.14);
}
.ring-seg {
  transition: stroke-dasharray 0.6s cubic-bezier(0.22, 1, 0.36, 1),
    stroke-dashoffset 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.22));
}
@media (prefers-reduced-motion: reduce) {
  .ring-seg { transition: none; }
}
</style>
