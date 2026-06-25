/**
 * 和风天气（QWeather）API 客户端
 *
 * 职责：封装数据接口，屏蔽 URL 拼接、key 注入、响应解析、错误归一化，
 *      对外暴露强类型方法 + 统一的 WeatherApiError。
 *
 *   const data = await weatherApi.now(city)
 *   失败时抛 WeatherApiError，其 message 已是面向用户的最佳文案。
 *
 * 坐标约定：内部统一存储 "纬度,经度"；调用前自动转换为和风所需的 "经度,纬度"。
 *
 * -----------------------------------------------------------------------
 * 当前账户（专用 Host m55b66xmda.re.qweatherapi.com，2026-06-25 实测）可用性：
 *   ✅ 可用：weather/now、weather/{3,7,10,15}d、weather/{24,72,168}h、
 *            minutely/5m、indices/1d
 *   ❌ 403 无权限：air/now、warning/now、warning/list（套餐不含，升级后生效）
 *   ❌ 404 未开通：astronomy/*、tropical/*、ocean/*、grid/*、
 *                  v2/city/*(GeoAPI)、historic/*、climate/*
 *
 * 客户端按「✅ 可用 / ❌ 不可用」分区组织；不可用接口同样封装，升级或开通后即用。
 * -----------------------------------------------------------------------
 */
import type {
  QWeatherResponse,
  LocationParam,
  WeatherNowResponse,
  WeatherNow,
  WeatherDailyResponse,
  WeatherDaily,
  WeatherHourlyResponse,
  WeatherHourly,
  WeatherMinutelyResponse,
  WeatherMinutely,
  WeatherIndicesResponse,
  WeatherIndex,
  WeatherAirResponse,
  WeatherAir,
  WeatherWarningResponse,
  WeatherWarning,
  GeoLookupResponse,
} from './types'

/** 数据接口前缀（走 /qweather 代理 → 专用 API Host） */
const DATA_BASE = '/qweather'
/** GeoAPI 前缀（走 /qgeo 代理；当前套餐 404 未开通，见文件头说明） */
const GEO_BASE = '/qgeo'
const API_KEY = import.meta.env.VITE_QWEATHER_API_KEY

/** 每日预报支持的跨度（3/7/10/15 天） */
export type DailyDays = 3 | 7 | 10 | 15
/** 逐小时预报支持的跨度（24/72/168 小时） */
export type HourlyHours = 24 | 72 | 168

/**
 * 统一错误类型
 * code: '-1' 表示本地错误（未配置 key / 网络 / 解析）；其它为接口返回的 code
 */
export class WeatherApiError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WeatherApiError'
    this.code = code
  }
}

interface RequestOptions {
  /** 传入 AbortSignal 以支持取消请求（如快速切换城市时取消未完成的旧请求） */
  signal?: AbortSignal
}

/** 和风错误码 → 面向用户的中文文案 */
const ERROR_MESSAGES: Record<string, string> = {
  '204': '该地区暂无此数据（空气质量 / 指数 / 预警 仅部分城市支持）',
  '400': '请求参数错误',
  '401': 'API Key 无效或权限不足',
  '402': '调用额度已用尽',
  '403': '无访问权限，可能受限于所在地区或套餐',
  '404': '城市 / 位置不存在',
  '429': '请求过于频繁，请稍后再试',
  '500': '服务暂时不可用，请稍后再试',
}

/** 把 "纬度,经度" 转为和风所需的 "经度,纬度"；已是 LocationID 则原样返回 */
function toLocation(coord: string): LocationParam {
  const parts = coord.split(',').map((s) => s.trim())
  if (parts.length === 2 && parts[0] && parts[1]) return `${parts[1]},${parts[0]}`
  return coord
}

/**
 * 底层请求：拼 URL → 注入 key → 解析 → 错误归一化
 * 成功时直接返回完整响应（带 code/updateTime），由各方法取出 data。
 */
async function request<T extends QWeatherResponse>(
  base: string,
  endpoint: string,
  location: string,
  extra: Record<string, string> = {},
  opts: RequestOptions = {},
): Promise<T> {
  if (!API_KEY) {
    throw new WeatherApiError('-1', '未配置天气 API Key，请在 .env 中设置 VITE_QWEATHER_API_KEY')
  }

  const params = new URLSearchParams({ location, key: API_KEY, ...extra })
  const url = `${base}/${endpoint}?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url, { signal: opts.signal })
  } catch (e) {
    // 被取消的请求向外抛 AbortError，由调用方决定是否静默
    if ((e as Error)?.name === 'AbortError') throw e
    throw new WeatherApiError('-1', '网络请求失败，请检查网络连接')
  }

  let json: T
  try {
    json = (await res.json()) as T
  } catch {
    throw new WeatherApiError('-1', '天气数据解析失败')
  }

  // 新版鉴权 / API Host 错误以 { error: { status, detail } } 形式返回（无 code 字段）
  const errorBody = (json as QWeatherResponse & {
    error?: { status?: number; title?: string; detail?: string }
  }).error
  if (errorBody) {
    throw new WeatherApiError(
      String(errorBody.status ?? '-1'),
      errorBody.detail || errorBody.title || '接口返回错误',
    )
  }

  if (json.code !== '200') {
    throw new WeatherApiError(
      json.code,
      ERROR_MESSAGES[json.code] || `接口返回错误（${json.code}）`,
    )
  }

  return json
}

/**
 * 天气 API 客户端
 * 方法按可用性分区；参数均为城市坐标（内部 "纬度,经度"），可选拖 signal。
 */
export const weatherApi = {
  // ============================================================
  //  ✅ 可用接口（当前套餐实测 code=200）
  // ============================================================

  /** 天气实况（建议 10~20 分钟调取一次） /v7/weather/now */
  async now(coord: string, opts?: RequestOptions): Promise<WeatherNow> {
    const r = await request<WeatherNowResponse>(DATA_BASE, 'v7/weather/now', toLocation(coord), {}, opts)
    return r.now
  },

  /**
   * 每日预报 /v7/weather/{3|7|10|15}d
   * @param days 预报天数；返回每日白天/夜间天气、最高最低温、风力风向，含 sunrise/sunset
   */
  async daily(coord: string, days: DailyDays, opts?: RequestOptions): Promise<WeatherDaily[]> {
    const r = await request<WeatherDailyResponse>(
      DATA_BASE,
      `v7/weather/${days}d`,
      toLocation(coord),
      {},
      opts,
    )
    return r.daily
  },

  /**
   * 逐小时预报 /v7/weather/{24|72|168}h
   * @param hours 预报时长（24/72/168 小时）
   */
  async hourly(coord: string, hours: HourlyHours, opts?: RequestOptions): Promise<WeatherHourly[]> {
    const r = await request<WeatherHourlyResponse>(
      DATA_BASE,
      `v7/weather/${hours}h`,
      toLocation(coord),
      {},
      opts,
    )
    return r.hourly
  },

  /**
   * 分钟级降水预报 /v7/minutely/5m（未来 2 小时，逐 5 分钟，约 24 条）
   * 返回文字 summary + 明细数组（precip 降水量、type 降水分型 rain/snow）。
   */
  async minutely(
    coord: string,
    opts?: RequestOptions,
  ): Promise<{ summary: string; list: WeatherMinutely[] }> {
    const r = await request<WeatherMinutelyResponse>(DATA_BASE, 'v7/minutely/5m', toLocation(coord), {}, opts)
    return { summary: r.summary, list: r.minutely ?? [] }
  },

  /**
   * 生活指数 /v7/indices/1d（穿衣/感冒/紫外线/洗车/运动/舒适度…，最多 16 项）
   * @param types 指数类型代码，逗号分隔（如 "3,5,9"）；默认 "0" 取全部
   */
  async indices(coord: string, types = '0', opts?: RequestOptions): Promise<WeatherIndex[]> {
    const r = await request<WeatherIndicesResponse>(
      DATA_BASE,
      'v7/indices/1d',
      toLocation(coord),
      { type: types },
      opts,
    )
    return r.daily
  },

  // ============================================================
  //  ❌ 不可用接口（当前套餐 403/404，保留封装；升级或开通后即用）
  // ============================================================

  /**
   * 空气质量实况 /v7/air/now（AQI、PM2.5/PM10 等）
   * ⚠️ 当前套餐返回 403（无权限），且仅中国大陆城市有数据。
   */
  async air(coord: string, opts?: RequestOptions): Promise<WeatherAir> {
    const r = await request<WeatherAirResponse>(DATA_BASE, 'v7/air/now', toLocation(coord), {}, opts)
    return r.now
  },

  /**
   * 天气预警 /v7/warning/now（无预警时返回空数组）
   * ⚠️ 当前套餐返回 403（无权限）。
   */
  async warnings(coord: string, opts?: RequestOptions): Promise<WeatherWarning[]> {
    const r = await request<WeatherWarningResponse>(DATA_BASE, 'v7/warning/now', toLocation(coord), {}, opts)
    return r.warning ?? []
  },

  /**
   * 按坐标反查城市名 /v2/city/lookup（GeoAPI，返回最近城市名）
   * ⚠️ 当前套餐 GeoAPI 未开通（404）。开通后用于 GPS 定位反查城市名。
   */
  async lookupByCoord(lng: string, lat: string, opts?: RequestOptions): Promise<string | null> {
    const r = await request<GeoLookupResponse>(
      GEO_BASE,
      'v2/city/lookup',
      `${lng},${lat}`,
      { number: '1' },
      opts,
    )
    return r.location?.[0]?.name ?? null
  },
}

export type WeatherApi = typeof weatherApi
