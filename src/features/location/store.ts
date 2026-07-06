/**
 * 地点模块 · 全局城市/地点状态
 *
 * 城市是跨特性全局概念：天气要按城市拉数据、简报/聊天要知道「用户在哪」、
 * 收件箱/引导页也要展示城市名。过去这些状态散落在天气 store 里，
 * 导致简报等非天气模块不得不 import useWeatherStore 只为拿一个城市名（反向耦合）。
 *
 * 现统一收归此地：
 *   - 持久化用户偏好（城市坐标 / 城市名 / 定位模式），localStorage 键集中在此；
 *   - 提供 setCity（手动选城）/ autoLocate（浏览器 GPS 自动定位）行为；
 *   - 暴露 locationSignature（城市 + 坐标 + 定位模式的稳定签名），
 *     供简报等模块做「地点是否变化」的轻量判断，无需了解内部字段。
 *
 * 天气 store 不再拥有城市状态，改为消费本 store：城市变化时触发天气刷新。
 */
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { weatherApi } from '@/features/weather/api'
import { nearestCity } from './city-data'
import type { LocationMode } from './types'

export const useLocationStore = defineStore('location', () => {
  // ============ 持久化用户偏好 ============
  // 城市坐标（格式 "纬度,经度"）；调用和风 API 时会自动转为 "经度,纬度"
  const cityCoord = useStorage<string>('hao123-weather-city-coord', '39.90,116.40')
  const cityName = useStorage<string>('hao123-weather-city-name', '北京')
  const locateMode = useStorage<LocationMode>('hao123-weather-mode', 'auto')

  // 正在自动定位（GPS 进行中；UI 可展示加载态）
  const locating = ref(false)

  /**
   * 地点签名：定位模式 + 坐标 + 城市名的稳定拼接。
   * 供简报等外部模块做「地点是否变化」的轻量判断——签名变了即视为地点变了，
   * 无需了解内部到底哪些字段变了。
   */
  const locationSignature = computed(() =>
    [locateMode.value, cityCoord.value, cityName.value].join('|'),
  )

  let locatePromise: Promise<boolean> | null = null

  /** 手动选择城市（使用坐标；名称取自本地城市库） */
  function setCity(lat: number, lng: number, name: string) {
    cityCoord.value = `${lat.toFixed(2)},${lng.toFixed(2)}`
    cityName.value = name
    locateMode.value = 'manual'
  }

  /**
   * 通过浏览器 Geolocation API 自动定位。
   * 成功后获取经纬度，存为 "纬度,经度"，并用 GeoAPI 反查城市名。
   * 返回是否定位成功（false = 用户拒绝 / 不支持 / 超时）。
   */
  function autoLocate(): Promise<boolean> {
    if (locatePromise) return locatePromise

    const promise = new Promise<boolean>((resolve) => {
      if (!navigator.geolocation) {
        resolve(false)
        return
      }

      locating.value = true
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude.toFixed(2)
          const lng = pos.coords.longitude.toFixed(2)
          cityCoord.value = `${lat},${lng}`
          locateMode.value = 'auto'
          locating.value = false
          // GeoAPI 反查城市名；该账户 GeoAPI 不可用时会失败，回退本地城市库按坐标最近匹配，
          // 既不显示无意义的"当前位置"，也避免陈旧城市名（如默认"北京"）误挂到 GPS 定位结果上
          const name = await weatherApi.lookupByCoord(lng, lat).catch(() => null)
          cityName.value = name || nearestCity(Number(lat), Number(lng)).name
          resolve(true)
        },
        () => {
          locating.value = false
          resolve(false)
        },
        { timeout: 8000, enableHighAccuracy: false },
      )
    }).finally(() => {
      if (locatePromise === promise) locatePromise = null
    })

    locatePromise = promise
    return promise
  }

  return {
    // 持久化偏好
    cityCoord,
    cityName,
    locateMode,
    locating,
    locationSignature,
    // 行为
    setCity,
    autoLocate,
  }
})
