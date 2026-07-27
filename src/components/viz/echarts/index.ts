/**
 * ECharts 唯一注册点（async chunk 入口）
 *
 * 消费方一律经 BaseChart.vue（defineAsyncComponent）触达本模块，
 * echarts 核心随之被 Vite 自动分进独立 async chunk，不进首屏 bundle。
 * 主题值在注册时读 :root 的 CSS 变量（@theme 单一事实源），token 改色图表自动跟随
 * （运行时换肤需重建 theme，当前无此需求）。
 */
import { use, registerTheme } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import type { EChartsOption } from 'echarts'

// 按需子集：只用折线 / 条形 + 网格 / tooltip，canvas 渲染
use([CanvasRenderer, LineChart, BarChart, GridComponent, TooltipComponent])

export const THEME_NAME = 'todayops-dark'

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function buildTheme(): Record<string, unknown> {
  const accent = cssVar('--color-accent', '#00d9ff')
  const teal = cssVar('--color-teal', '#2dd4bf')
  const warning = cssVar('--color-warning', '#f5a524')
  const danger = cssVar('--color-danger', '#f4587a')
  const ink3 = cssVar('--color-ink-3', 'rgba(255, 255, 255, 0.44)')
  const mono = cssVar('--font-mono', 'ui-monospace, monospace')
  return {
    // 系列序：主 / 辅 / 能量 / 风险（与手工 SVG 微图表同口径）
    color: [accent, teal, warning, danger],
    backgroundColor: 'transparent',
    categoryAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: ink3, fontSize: 10.5, fontFamily: mono },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: ink3, fontSize: 10.5, fontFamily: mono },
      // 深色下阴影不表达层级，网格压到 white/5 主动后退
      splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
    },
    tooltip: {
      backgroundColor: 'rgba(18, 21, 28, 0.92)',
      borderColor: 'rgba(255, 255, 255, 0.18)',
      borderWidth: 1,
      padding: [6, 10],
      textStyle: { color: 'rgba(255, 255, 255, 0.92)', fontSize: 12 },
      extraCssText:
        'border-radius: 12px; box-shadow: 0 24px 64px -16px rgba(0,0,0,0.7); backdrop-filter: blur(24px) saturate(180%);',
    },
  }
}

registerTheme(THEME_NAME, buildTheme())

/**
 * 默认轴系工厂：只留横向网格 white/5、轴线隐藏、mono 刻度、
 * 850ms cubicOut 入场。消费方传入 series/xAxis/yAxis 浅合并即可。
 */
export function baseAxisOption(partial: EChartsOption): EChartsOption {
  return {
    grid: { left: 8, right: 12, top: 14, bottom: 4, containLabel: true },
    animationDuration: 850,
    animationEasing: 'cubicOut',
    ...partial,
  }
}
