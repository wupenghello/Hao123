/**
 * 天气展示层工具：AQI / 预警 的配色与生活指数图标映射。
 * 与 weather-icons.ts（天气编码→图标）分工：这里负责「数值/等级 → 视觉呈现」。
 */
import type { Component } from 'vue'
import type { WeatherAir } from './types'
import IconTshirtCrew from '~icons/mdi/tshirt-crew'
import IconWhiteBalanceSunny from '~icons/mdi/white-balance-sunny'
import IconMedicalBag from '~icons/mdi/medical-bag'
import IconCar from '~icons/mdi/car'
import IconRun from '~icons/mdi/run'
import IconFish from '~icons/mdi/fish'
import IconAirConditioner from '~icons/mdi/air-conditioner'
import IconSmog from '~icons/mdi/smog'
import IconThermometer from '~icons/mdi/thermometer'
import IconChartBoxOutline from '~icons/mdi/chart-box-outline'

export interface ToneStyle {
  /** 状态圆点背景色 class */
  dot: string
  /** 文字主色 class */
  text: string
  /** 胶囊背景 + 文字组合 class */
  chip: string
}

/**
 * 空气质量配色：依据和风返回的 level（1~6）匹配国标 HJ 633 颜色。
 *   1 优(绿) / 2 良(黄) / 3 轻度(橙) / 4 中度(红) / 5 重度(紫) / 6 严重(褐红)
 */
export function aqiTone(air: WeatherAir | null | undefined): ToneStyle {
  switch (air?.level) {
    case '1':
      return { dot: 'bg-emerald-400', text: 'text-emerald-200', chip: 'bg-emerald-400/15 text-emerald-200' }
    case '2':
      return { dot: 'bg-yellow-400', text: 'text-yellow-200', chip: 'bg-yellow-400/15 text-yellow-200' }
    case '3':
      return { dot: 'bg-orange-400', text: 'text-orange-200', chip: 'bg-orange-400/15 text-orange-200' }
    case '4':
      return { dot: 'bg-red-500', text: 'text-red-200', chip: 'bg-red-500/15 text-red-200' }
    case '5':
      return { dot: 'bg-purple-400', text: 'text-purple-200', chip: 'bg-purple-400/15 text-purple-200' }
    case '6':
      return { dot: 'bg-rose-700', text: 'text-rose-200', chip: 'bg-rose-700/20 text-rose-200' }
    default:
      return { dot: 'bg-slate-400', text: 'text-slate-200', chip: 'bg-white/10 text-white/70' }
  }
}

/** 预警级别配色：蓝/黄/橙/红（气象灾害预警信号标准） */
export function alarmTone(level: string): ToneStyle {
  if (level.includes('蓝')) return { dot: 'bg-blue-400', text: 'text-blue-200', chip: 'bg-blue-400/15 text-blue-100 border border-blue-300/30' }
  if (level.includes('黄')) return { dot: 'bg-yellow-400', text: 'text-yellow-100', chip: 'bg-yellow-400/15 text-yellow-100 border border-yellow-300/30' }
  if (level.includes('橙')) return { dot: 'bg-orange-400', text: 'text-orange-100', chip: 'bg-orange-400/15 text-orange-100 border border-orange-300/30' }
  if (level.includes('红')) return { dot: 'bg-red-500', text: 'text-red-100', chip: 'bg-red-500/15 text-red-100 border border-red-300/30' }
  return { dot: 'bg-slate-400', text: 'text-slate-100', chip: 'bg-white/10 text-white/80 border border-white/15' }
}

/** 和风生活指数 type 代码 → 图标；未命中返回通用图表图标 */
const indexIconMap: Record<string, Component> = {
  '1': IconRun, // 运动指数
  '2': IconCar, // 洗车指数
  '3': IconTshirtCrew, // 穿衣指数
  '4': IconFish, // 钓鱼指数
  '5': IconWhiteBalanceSunny, // 紫外线指数
  '8': IconThermometer, // 舒适度指数
  '9': IconMedicalBag, // 感冒指数
  '10': IconSmog, // 空气污染扩散条件指数
  '11': IconAirConditioner, // 空调指数
  '16': IconWhiteBalanceSunny, // 防晒指数
}

/** 根据和风生活指数 type 代码获取图标 */
export function getIndexIcon(type: string): Component {
  return indexIconMap[type] || IconChartBoxOutline
}
