/**
 * 地点模块 · 公共类型
 *
 * 城市/地点是跨特性全局概念（天气、简报、聊天、收件箱都需要知道「用户在哪」），
 * 类型统一在此定义，避免各模块自行声明导致不一致。
 */

/** 定位模式：auto=浏览器 GPS 自动定位；manual=用户手动选城 */
export type LocationMode = 'auto' | 'manual'

/** 城市条目（坐标 + 行政区划） */
export interface CityItem {
  name: string
  lat: number
  lng: number
  province: string
}

/** 按省份分组的城市列表（城市选择器 UI 用） */
export interface ProvinceGroup {
  name: string
  cities: CityItem[]
}
