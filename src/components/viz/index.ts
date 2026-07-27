/**
 * KPI 可视化原语 barrel（模块 2）
 *
 * 纯展示组件，不触达业务 store——数据由调用方传入。
 *  - ProgressRing：单值环 / 分段环（完成率、风险分布）。
 *  - Sparkline：迷你折线 / 面积（温度趋势、提交频次等序列）。
 *  - Bars：纯 CSS 微条形（分布 / 频次；真坐标系图表用 viz/echarts）。
 */
export { default as ProgressRing } from './ProgressRing.vue'
export { default as Sparkline } from './Sparkline.vue'
export { default as Bars } from './Bars.vue'
