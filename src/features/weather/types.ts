/**
 * 和风天气（QWeather）API 类型定义
 * 接口文档：https://dev.qweather.com/docs/api/
 *
 * 字段命名与接口返回保持一致（和风统一为 camelCase），便于对照文档。
 * 所有数值字段接口均以字符串返回，这里按文档原样定义为 string。
 * code 为字符串：'200' 表示成功。
 */

/** 通用响应信封：所有接口共用 */
export interface QWeatherResponse {
  code: string // '200' 成功；其它为各类错误
}

/**
 * location 参数两种形式：
 *  - LocationID：如 '101010100'
 *  - 经纬度：'经度,纬度'（注意：经度在前）
 *
 * 内部存储的城市坐标为 '纬度,经度'，调用前由 api 层转换。
 */
export type LocationParam = string

// ============ 1. 天气实况 /v7/weather/now ============
export interface WeatherNow {
  obsTime: string // 数据观测时间（ISO8601）
  temp: string // 实况温度
  feelsLike: string // 体感温度
  icon: string // 天气图标代码
  text: string // 天气文字，如 "多云"
  wind360: string // 风向角度
  windDir: string // 风向，如 "西北风"
  windScale: string // 风力等级
  windSpeed: string // 风速 km/h
  humidity: string // 相对湿度 %
  precip: string // 过去 1 小时降水量 mm
  pressure: string // 大气压 hPa
  vis: string // 能见度 km
  cloud: string // 云量 %
  dew: string // 露点温度
}

export interface WeatherNowResponse extends QWeatherResponse {
  updateTime: string
  fxLink: string
  now: WeatherNow
}

// ============ 2. 逐天预报 /v7/weather/7d ============
export interface WeatherDaily {
  fxDate: string // 预报日期 yyyy-MM-dd
  sunrise: string // 日出 HH:mm（高纬度可能为空）
  sunset: string // 日落 HH:mm
  moonrise: string
  moonset: string
  moonPhase: string
  moonPhaseIcon: string
  tempMax: string // 最高温
  tempMin: string // 最低温
  iconDay: string // 白天天气图标代码
  textDay: string // 白天天气文字
  iconNight: string // 夜间天气图标代码
  textNight: string // 夜间天气文字
  wind360Day: string
  windDirDay: string
  windScaleDay: string
  windSpeedDay: string
  wind360Night: string
  windDirNight: string
  windScaleNight: string
  windSpeedNight: string
  humidity: string
  precip: string
  pressure: string
  vis: string
  cloud: string
  uvIndex: string
}

export interface WeatherDailyResponse extends QWeatherResponse {
  updateTime: string
  fxLink: string
  daily: WeatherDaily[]
}

// ============ 3. 逐小时预报 /v7/weather/24h ============
export interface WeatherHourly {
  fxTime: string // 预报时间（ISO8601）
  temp: string
  icon: string
  text: string
  wind360: string
  windDir: string
  windScale: string
  windSpeed: string
  humidity: string
  pop: string // 降水概率 %
  precip: string
  pressure: string
  cloud: string
  dew: string
}

export interface WeatherHourlyResponse extends QWeatherResponse {
  updateTime: string
  fxLink: string
  hourly: WeatherHourly[]
}

// ============ 4. 生活指数 /v7/indices/1d ============
export interface WeatherIndex {
  date: string
  type: string // 指数类型代码 1~16
  name: string // 指数名称，如 "紫外线指数"
  level: string // 等级数值
  category: string // 等级名称（简短），如 "中等"
  text: string // 详细描述
}

export interface WeatherIndicesResponse extends QWeatherResponse {
  updateTime: string
  fxLink: string
  daily: WeatherIndex[]
}

// ============ 5. 空气质量实况 /v7/air/now ============
export interface WeatherAir {
  pubTime: string
  aqi: string
  level: string // 污染级别 1~6
  category: string // 污染类别，如 "优" / "轻度污染"
  primary: string // 主要污染物；'NA' 表示无
  pm10: string
  pm2p5: string // PM2.5（JSON 键名为 pm2p5）
  no2: string
  so2: string
  co: string
  o3: string
}

export interface WeatherAirResponse extends QWeatherResponse {
  updateTime: string
  fxLink: string
  now: WeatherAir
}

// ============ 6. 天气预警 /v7/warning/now ============
export interface WeatherWarning {
  id: string
  sender: string
  pubTime: string
  title: string
  status: string
  level: string // 预警等级（颜色文字），如 "蓝色"
  severity: string
  severityColor: string
  type: string
  typeName: string // 预警类别，如 "大风"
  urgency: string
  certainty: string
  text: string // 预警详情
  related: string
}

export interface WeatherWarningResponse extends QWeatherResponse {
  updateTime: string
  fxLink: string
  warning: WeatherWarning[]
}

// ============ 7. GeoAPI 城市查询 /v2/city/lookup ============
export interface GeoCity {
  name: string // 城市/地区名
  id: string // LocationID
  lat: string
  lon: string
  adm2: string // 上级行政区（区/县）
  adm1: string // 上级行政区（省/州）
  country: string
  isLocation: string
}

export interface GeoLookupResponse extends QWeatherResponse {
  location: GeoCity[]
}

// ============ 8. 分钟级降水 /v7/minutely/5m ============
export interface WeatherMinutely {
  fxTime: string // 预报时间（ISO8601）
  precip: string // 5 分钟降水量 mm
  type?: string // 降水分型：rain / snow（部分情况返回）
}

export interface WeatherMinutelyResponse extends QWeatherResponse {
  updateTime: string
  fxLink: string
  summary: string // 文字预报，如 "未来两小时无降水"
  minutely: WeatherMinutely[]
}
