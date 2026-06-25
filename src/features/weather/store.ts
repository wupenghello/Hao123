import { ref, computed, type Ref } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { weatherApi, WeatherApiError } from './api'
import { calcSunTimes } from './sun-times'
import type {
  WeatherNow,
  WeatherDaily,
  WeatherHourly,
  WeatherIndex,
  WeatherAir,
  WeatherWarning,
} from './types'

export const useWeatherStore = defineStore('weather', () => {
  // ============ 持久化用户偏好 ============
  // 城市坐标（格式 "纬度,经度"）；调用和风 API 时会自动转为 "经度,纬度"
  const cityCoord = useStorage<string>('hao123-weather-city-coord', '39.90,116.40')
  const cityName = useStorage<string>('hao123-weather-city-name', '北京')
  const locateMode = useStorage<'auto' | 'manual'>('hao123-weather-mode', 'auto')

  // ============ 核心数据（状态栏常驻，每次刷新更新）============
  const now = ref<WeatherNow | null>(null)
  const daily = ref<WeatherDaily[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const locating = ref(false) // 正在自动定位

  // ============ 按需数据（详情面板等场景懒加载，按城市缓存）============
  const hourly = ref<WeatherHourly[] | null>(null)
  const indices = ref<WeatherIndex[] | null>(null)
  const air = ref<WeatherAir | null>(null)
  const warnings = ref<WeatherWarning[] | null>(null)
  // 当前城市是否缺少「部分城市才支持」的数据（空气质量/指数/预警仅大陆城市），
  // 用于在 UI 给出说明，而非静默丢失区块
  const regionalUnsupported = ref(false)

  interface LazySlot<T> {
    data: Ref<T | null>
    city: Ref<string | null>
    failed: Ref<boolean> // 该城市下曾请求失败，避免反复请求消耗配额
  }
  const lazySlots: LazySlot<unknown>[] = [
    { data: hourly as Ref<unknown>, city: ref<string | null>(null), failed: ref(false) },
    { data: indices as Ref<unknown>, city: ref<string | null>(null), failed: ref(false) },
    { data: air as Ref<unknown>, city: ref<string | null>(null), failed: ref(false) },
    { data: warnings as Ref<unknown>, city: ref<string | null>(null), failed: ref(false) },
  ]

  /**
   * 日出日落（优先取 7 天预报里今天的 sunrise/sunset；
   * 预报缺失时回退本地天文计算，始终有值）
   * 返回 { sunRise, sunSet } 本地时间 HH:MM，或 null
   */
  const sunTimes = computed<{ sunRise: string; sunSet: string } | null>(() => {
    const today = daily.value[0]
    if (today?.sunrise && today?.sunset) return { sunRise: today.sunrise, sunSet: today.sunset }
    const [lat, lng] = cityCoord.value.split(',').map(Number)
    if (!isNaN(lat) && !isNaN(lng)) {
      const r = calcSunTimes(lat, lng)
      if (r.sunrise && r.sunset) return { sunRise: r.sunrise, sunSet: r.sunset }
    }
    return null
  })

  let timer: ReturnType<typeof setInterval> | null = null
  // 当前进行中的核心请求控制器；新请求会取消旧请求，避免快速切换城市时旧响应覆盖新数据
  let abortController: AbortController | null = null

  /** 把 message 规整为字符串（WeatherApiError 已带最佳文案） */
  function toMessage(e: unknown, fallback: string): string {
    return e instanceof WeatherApiError ? e.message : e instanceof Error ? e.message : fallback
  }

  /**
   * 拉取核心数据（实况 + 7天预报）。
   * 两个接口独立成败：实况失败必须报错；预报失败时保留旧预报、仅在实况也无数据时提示。
   */
  async function fetchWeather() {
    abortController?.abort()
    const controller = new AbortController()
    abortController = controller
    const signal = controller.signal

    loading.value = true
    error.value = null

    const [nowR, dailyR] = await Promise.allSettled([
      weatherApi.now(cityCoord.value, { signal }),
      weatherApi.daily(cityCoord.value, 7, { signal }),
    ])

    // 被新请求取消：不触碰任何状态，loading 由新请求接管
    if (signal.aborted) return

    if (nowR.status === 'fulfilled') {
      now.value = nowR.value
    } else {
      error.value = toMessage(nowR.reason, '实况数据获取失败')
    }

    if (dailyR.status === 'fulfilled') {
      daily.value = dailyR.value ?? []
    } else if (!now.value) {
      error.value = toMessage(dailyR.reason, error.value || '预报数据获取失败')
    }

    if (abortController === controller) {
      loading.value = false
      abortController = null
    }
  }

  /**
   * 按需数据懒加载通用方法：
   *   - 命中缓存（同城市 + 已有数据）直接返回，节省接口配额
   *   - 同城市曾失败则不重复请求（避免反复消耗配额）
   *   - 失败静默不阻塞核心展示，但记录到 regionalUnsupported 以便 UI 说明
   */
  async function ensureLazy<T>(
    slot: LazySlot<T>,
    fetcher: (city: string) => Promise<T>,
    force = false,
  ): Promise<T | null> {
    if (!force && slot.city.value === cityCoord.value) {
      if (slot.data.value) return slot.data.value
      if (slot.failed.value) return null // 该城市已确认不可用，不重复请求
    }
    try {
      const result = await fetcher(cityCoord.value)
      slot.data.value = result
      slot.city.value = cityCoord.value
      slot.failed.value = false
      return result
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return null
      slot.failed.value = true
      slot.city.value = cityCoord.value
      // 204=该地区无数据 / 403=地区受限：标记为区域性不可用
      if (e instanceof WeatherApiError && (e.code === '204' || e.code === '403')) {
        regionalUnsupported.value = true
      }
      console.warn('[weather] 按需数据获取失败：', toMessage(e, '未知错误'))
      return null
    }
  }

  /** 清空按需数据缓存（切换城市时调用，避免闪现上一个城市的数据） */
  function resetLazy() {
    for (const s of lazySlots) {
      s.data.value = null
      s.city.value = null
      s.failed.value = false
    }
    regionalUnsupported.value = false
  }

  // 各按需接口的 ensure 方法（force=true 强制刷新）
  const ensureHourly = (force = false) =>
    ensureLazy(lazySlots[0] as LazySlot<WeatherHourly[]>, (c) => weatherApi.hourly(c, 24), force)
  const ensureIndices = (force = false) =>
    ensureLazy(lazySlots[1] as LazySlot<WeatherIndex[]>, (c) => weatherApi.indices(c), force)
  const ensureAir = (force = false) =>
    ensureLazy(lazySlots[2] as LazySlot<WeatherAir>, (c) => weatherApi.air(c), force)
  const ensureWarnings = (force = false) =>
    ensureLazy(lazySlots[3] as LazySlot<WeatherWarning[]>, (c) => weatherApi.warnings(c), force)

  /**
   * 通过浏览器 Geolocation API 自动定位
   * 成功后获取经纬度，存为 "纬度,经度"，并用 GeoAPI 反查城市名。
   */
  function autoLocate(): Promise<boolean> {
    return new Promise((resolve) => {
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
          resetLazy()
          // GeoAPI 反查城市名；该账户 GeoAPI 不可用时会失败，回退通用标签，
          // 避免把陈旧城市名（如默认"北京"）误显示到 GPS 定位结果上
          const name = await weatherApi.lookupByCoord(lng, lat).catch(() => null)
          cityName.value = name || '当前位置'
          fetchWeather()
          resolve(true)
        },
        () => {
          locating.value = false
          resolve(false)
        },
        { timeout: 8000, enableHighAccuracy: false },
      )
    })
  }

  /** 手动选择城市（使用坐标；名称取自本地城市库） */
  function setCity(lat: number, lng: number, name: string) {
    cityCoord.value = `${lat.toFixed(2)},${lng.toFixed(2)}`
    cityName.value = name
    locateMode.value = 'manual'
    resetLazy()
    fetchWeather()
  }

  function startAutoRefresh() {
    if (locateMode.value === 'auto') {
      autoLocate().then((ok) => {
        if (!ok) fetchWeather()
      })
    } else {
      fetchWeather()
    }
    // 每 20 分钟刷新一次核心数据
    timer = setInterval(fetchWeather, 20 * 60 * 1000)
  }

  function stopAutoRefresh() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    abortController?.abort()
    abortController = null
  }

  return {
    // 持久化偏好
    cityCoord,
    cityName,
    locateMode,
    // 核心数据
    now,
    daily,
    loading,
    locating,
    error,
    fetchWeather,
    // 按需数据 + 懒加载方法
    hourly,
    indices,
    air,
    warnings,
    sunTimes, // 日出日落（优先预报，缺失时本地计算兜底）
    regionalUnsupported, // 当前城市是否缺少区域性数据
    ensureHourly,
    ensureIndices,
    ensureAir,
    ensureWarnings,
    // 定位 / 选城
    autoLocate,
    setCity,
    startAutoRefresh,
    stopAutoRefresh,
  }
})
