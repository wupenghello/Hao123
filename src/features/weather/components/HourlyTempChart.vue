<script setup lang="ts">
/**
 * 逐小时温度曲线（ECharts）
 *
 * async chunk 叶子：仅由 WeatherDetailModal 以 defineAsyncComponent 引入，
 * echarts 核心此时才加载（首屏 bundle 不含 echarts）。
 * 规格：2.5px 主线 + 同色 55% α 发光、面积顶部 28% 淡出至透明、smooth 0.45、
 * 隐藏数据点、横向网格 white/5、mono 刻度、glass tooltip（主题统一提供）。
 */
import { computed } from 'vue'
import BaseChart from '@/components/viz/echarts/BaseChart.vue'
import { baseAxisOption } from '@/components/viz/echarts'
import type { WeatherHourly } from '../types'

const props = defineProps<{
  /** 逐小时数据（取 temp） */
  hourly: WeatherHourly[]
  /** 轴刻度标签（首项通常为「现在」），由调用方经 hourLabel 生成 */
  labels: string[]
}>()

const option = computed(() => {
  const temps = props.hourly.map((h) => Number(h.temp)).filter((n) => Number.isFinite(n))
  return baseAxisOption({
    xAxis: {
      type: 'category',
      data: props.labels.slice(0, temps.length),
      boundaryGap: false,
    },
    yAxis: { type: 'value', scale: true },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => `${v}°C`,
    },
    series: [
      {
        type: 'line',
        data: temps,
        smooth: 0.45,
        showSymbol: false,
        lineStyle: {
          width: 2.5,
          shadowBlur: 16,
          shadowColor: 'rgba(0, 217, 255, 0.55)',
          shadowOffsetY: 6,
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 217, 255, 0.28)' },
              { offset: 1, color: 'rgba(0, 217, 255, 0)' },
            ],
          },
        },
      },
    ],
  })
})
</script>

<template>
  <BaseChart :option="option" height="140px" />
</template>
