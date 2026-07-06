/**
 * 地点模块公共出口（barrel）
 *
 * 城市/地点是跨特性全局概念，统一从这里引入：
 *   import { useLocationStore, searchCities, nearestCity, type CityItem } from '@/features/location'
 *
 * 分层（自包含）：
 *   types.ts      公共类型（CityItem / ProvinceGroup / LocationMode）
 *   city-data.ts  中国城市坐标库 + 搜索 / 最近城市
 *   store.ts      全局城市状态（useLocationStore）
 */
export * from './types'
export * from './city-data'
export * from './store'
