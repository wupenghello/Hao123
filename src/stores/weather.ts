import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import type { WeatherObserve, WeatherForecastDay, YytianqiResponse } from '@/types'

const API_KEY = '2w3otas5vi8s4idf'
const API_BASE = '/api/weather'

export const useWeatherStore = defineStore('weather', () => {
  // 持久化用户选择的城市坐标（格式: "lat,lng"）
  const cityCoord = useStorage<string>('hao123-weather-city-coord', '39.90,116.40')
  const cityName = useStorage<string>('hao123-weather-city-name', '北京')
  const locateMode = useStorage<'auto' | 'manual'>('hao123-weather-mode', 'auto')

  const observe = ref<WeatherObserve | null>(null)
  const forecast = ref<WeatherForecastDay[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const locating = ref(false) // 正在自动定位

  let timer: ReturnType<typeof setInterval> | null = null

  async function fetchWeather() {
    loading.value = true
    error.value = null

    try {
      const [observeRes, forecastRes] = await Promise.all([
        fetch(`${API_BASE}/observe?city=${cityCoord.value}&key=${API_KEY}`),
        fetch(`${API_BASE}/forecast7d?city=${cityCoord.value}&key=${API_KEY}`),
      ])

      const observeData: YytianqiResponse<WeatherObserve> = await observeRes.json()
      const forecastData: YytianqiResponse<{ cityName: string; list: WeatherForecastDay[] }> = await forecastRes.json()

      if (observeData.code === 1) {
        observe.value = observeData.data
        cityName.value = observeData.data.cityName
      } else {
        error.value = observeData.msg
      }

      if (forecastData.code === 1) {
        forecast.value = forecastData.data.list
        cityName.value = forecastData.data.cityName
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '天气数据获取失败'
    } finally {
      loading.value = false
    }
  }

  /**
   * 通过浏览器 Geolocation API 自动定位
   * 成功后获取经纬度，直接传给天气 API（精确到区县）
   */
  function autoLocate(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(false)
        return
      }

      locating.value = true
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude.toFixed(2)
          const lng = pos.coords.longitude.toFixed(2)
          cityCoord.value = `${lat},${lng}`
          locateMode.value = 'auto'
          locating.value = false
          fetchWeather()
          resolve(true)
        },
        () => {
          // 定位失败，保持当前坐标
          locating.value = false
          resolve(false)
        },
        { timeout: 8000, enableHighAccuracy: false },
      )
    })
  }

  /**
   * 手动选择城市（使用坐标）
   */
  function setCity(lat: number, lng: number, name: string) {
    cityCoord.value = `${lat.toFixed(2)},${lng.toFixed(2)}`
    cityName.value = name
    locateMode.value = 'manual'
    fetchWeather()
  }

  function startAutoRefresh() {
    if (locateMode.value === 'auto') {
      // 自动定位模式：先定位再获取天气
      autoLocate().then((ok) => {
        if (!ok) fetchWeather()
      })
    } else {
      fetchWeather()
    }
    // 每 20 分钟刷新一次
    timer = setInterval(fetchWeather, 20 * 60 * 1000)
  }

  function stopAutoRefresh() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    cityCoord,
    cityName,
    locateMode,
    observe,
    forecast,
    loading,
    locating,
    error,
    fetchWeather,
    autoLocate,
    setCity,
    startAutoRefresh,
    stopAutoRefresh,
  }
})
