<script setup lang="ts">
/**
 * ECharts 基础组件 —— 消费方唯一入口
 *
 * 纪律：消费方一律以
 *   defineAsyncComponent(() => import('…/BaseChart.vue'))
 * 引入本组件，echarts 核心即自动落入独立 async chunk，首屏不加载。
 * 主题 / 渲染器 / 自适应全部在此固定，消费方只传 option。
 */
import VChart from 'vue-echarts'
import type { EChartsOption } from 'echarts'
import { THEME_NAME } from './index' // 引入即触发注册副作用（按需 use + registerTheme）

withDefaults(
  defineProps<{
    option: EChartsOption
    /** 图表高度，默认填满父容器 */
    height?: string
  }>(),
  { height: '100%' },
)
</script>

<template>
  <VChart
    class="base-chart"
    :theme="THEME_NAME"
    :option="option"
    :init-options="{ renderer: 'canvas' }"
    autoresize
    :style="{ height }"
  />
</template>

<style scoped>
.base-chart {
  width: 100%;
}
</style>
