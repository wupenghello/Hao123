/**
 * 天气编码 → Iconify 图标组件映射
 * 丫丫天气编码对照：http://www.yytianqi.com/api.html
 */
import type { Component } from 'vue'
import IconWeatherSunny from '~icons/mdi/weather-sunny'
import IconWeatherPartlyCloudy from '~icons/mdi/weather-partly-cloudy'
import IconWeatherCloudy from '~icons/mdi/weather-cloudy'
import IconWeatherFog from '~icons/mdi/weather-fog'
import IconWeatherRainy from '~icons/mdi/weather-rainy'
import IconWeatherPouring from '~icons/mdi/weather-pouring'
import IconWeatherLightningRainy from '~icons/mdi/weather-lightning-rainy'
import IconWeatherSnowy from '~icons/mdi/weather-snowy'
import IconWeatherSnowyHeavy from '~icons/mdi/weather-snowy-heavy'
import IconWeatherSnowyRainy from '~icons/mdi/weather-snowy-rainy'
import IconWeatherHail from '~icons/mdi/weather-hail'
import IconWeatherWindy from '~icons/mdi/weather-windy'
import IconWeatherDust from '~icons/mdi/weather-dust'
import IconWeatherHazy from '~icons/mdi/weather-hazy'

const iconMap: Record<string, Component> = {
  '00': IconWeatherSunny,
  '01': IconWeatherPartlyCloudy,
  '02': IconWeatherPartlyCloudy,
  '03': IconWeatherCloudy,
  '04': IconWeatherCloudy,
  '05': IconWeatherFog,
  '06': IconWeatherFog,
  '07': IconWeatherFog,
  '08': IconWeatherFog,
  '09': IconWeatherRainy,
  '10': IconWeatherPouring,
  '11': IconWeatherLightningRainy,
  '12': IconWeatherSnowy,
  '13': IconWeatherSnowyHeavy,
  '14': IconWeatherSnowyRainy,
  '15': IconWeatherHail,
  '16': IconWeatherSnowyRainy,
  '17': IconWeatherLightningRainy,
  '18': IconWeatherPouring,
  '19': IconWeatherWindy,
  '20': IconWeatherDust,
  '21': IconWeatherDust,
  '22': IconWeatherDust,
  '23': IconWeatherDust,
  '24': IconWeatherSunny,
  '25': IconWeatherSunny,
  '26': IconWeatherPartlyCloudy,
  '27': IconWeatherSnowy,
  '28': IconWeatherSnowy,
  '29': IconWeatherDust,
  '30': IconWeatherFog,
  '31': IconWeatherFog,
  '53': IconWeatherHazy,
}

/** 根据丫丫天气编码获取对应的图标组件 */
export function getWeatherIcon(numtq: string): Component {
  return iconMap[numtq] || IconWeatherCloudy
}

/** 默认图标（用于 fallback） */
export { IconWeatherCloudy as DefaultWeatherIcon }
