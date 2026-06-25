/**
 * 和风天气图标代码 → Iconify 图标组件
 * 代码对照：https://dev.qweather.com/docs/resource/icons/
 *
 * 和风代码量大（含白天/夜间 + 强度细分），这里按区间归类映射，
 * 比逐条枚举更紧凑、更易维护。
 */
import type { Component } from 'vue'
import IconWeatherSunny from '~icons/mdi/weather-sunny'
import IconWeatherNight from '~icons/mdi/weather-night'
import IconWeatherPartlyCloudy from '~icons/mdi/weather-partly-cloudy'
import IconWeatherNightPartlyCloudy from '~icons/mdi/weather-night-partly-cloudy'
import IconWeatherCloudy from '~icons/mdi/weather-cloudy'
import IconWeatherFog from '~icons/mdi/weather-fog'
import IconWeatherRainy from '~icons/mdi/weather-rainy'
import IconWeatherPouring from '~icons/mdi/weather-pouring'
import IconWeatherLightningRainy from '~icons/mdi/weather-lightning-rainy'
import IconWeatherSnowy from '~icons/mdi/weather-snowy'
import IconWeatherSnowyHeavy from '~icons/mdi/weather-snowy-heavy'
import IconWeatherSnowyRainy from '~icons/mdi/weather-snowy-rainy'
import IconWeatherHail from '~icons/mdi/weather-hail'
import IconWeatherHazy from '~icons/mdi/weather-hazy'
import IconWeatherDust from '~icons/mdi/weather-dust'

/** 根据和风图标代码获取对应的图标组件 */
export function getWeatherIcon(icon: string): Component {
  const c = Number(icon)
  // 晴 / 多云 / 阴（白天）
  if (c === 100) return IconWeatherSunny
  if (c >= 101 && c <= 103) return IconWeatherPartlyCloudy
  if (c === 104) return IconWeatherCloudy
  // 夜间（150 晴；151~154 多云 / 阴）
  if (c === 150) return IconWeatherNight
  if (c >= 151 && c <= 154) return IconWeatherNightPartlyCloudy
  // 雷阵雨 / 冰雹（先于普通雨命中）
  if (c === 302 || c === 303) return IconWeatherLightningRainy
  if (c === 304) return IconWeatherHail
  // 强降水（大雨 / 暴雨级别）
  if ([301, 307, 308, 310, 311, 312, 315, 316, 317, 318].includes(c)) return IconWeatherPouring
  // 雨夹雪 / 冻雨
  if ([313, 404, 405, 406].includes(c)) return IconWeatherSnowyRainy
  // 普通雨（含夜间 350~399）
  if ((c >= 300 && c <= 318) || (c >= 350 && c <= 399)) return IconWeatherRainy
  // 强降雪（大雪 / 暴雪级别）
  if ([402, 403, 410, 411, 412, 413].includes(c)) return IconWeatherSnowyHeavy
  // 普通雪（含夜间 446~499）
  if ((c >= 400 && c <= 415) || (c >= 446 && c <= 499)) return IconWeatherSnowy
  // 霾
  if ([502, 511, 512, 513, 517, 518].includes(c)) return IconWeatherHazy
  // 沙尘
  if ([503, 504, 507, 508].includes(c)) return IconWeatherDust
  // 雾
  if (c >= 500 && c <= 518) return IconWeatherFog
  return IconWeatherCloudy // 默认（含 900 热 / 901 冷 / 999 未知）
}

/** 默认图标（用于 fallback） */
export { IconWeatherCloudy as DefaultWeatherIcon }
