/**
 * 天气模块 · LLM 工具层（function-calling / tool-use）
 *
 * 把天气能力以「工具」形式暴露给大模型，provider 无关（OpenAI / Claude / Gemini 通用）：
 *   - weatherToolDefs  喂给 LLM 的工具声明（name + description + 参数 JSON Schema）
 *   - callWeatherTool(name, params)  执行 LLM 选中的工具，返回结构化数据
 *
 * 典型接入（伪代码）：
 *   const messages = [{ role: 'user', content: '北京明天冷吗？' }]
 *   const resp = await llm.chat({ messages, tools: weatherToolDefs })
 *   for (const call of resp.tool_calls) {
 *     const result = await callWeatherTool(call.name, call.arguments)
 *     messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
 *   }
 *   const final = await llm.chat({ messages, tools: weatherToolDefs })  // LLM 据工具结果作答
 *
 * 设计原则：
 *   - 城市解析本地优先（city-data.ts），不依赖 GeoAPI（当前套餐未开通）；
 *   - 返回值做「LLM 友好」裁剪：数值转 number、时间转 HH:MM、剔除冗余字段以省 token；
 *   - 仅纳入当前套餐可用能力（air/warning/geo 不可用，不放进来，避免 LLM 调到注定失败的函数）。
 */
import { weatherApi, WeatherApiError, type DailyDays, type HourlyHours } from './api'
import { searchCities, type CityItem } from './city-data'
import type {
  WeatherNow,
  WeatherDaily,
  WeatherHourly,
  WeatherMinutely,
  WeatherIndex,
} from './types'

/** 位置入参：city 与 coord 二选一 */
export interface LocationInput {
  city?: string
  coord?: string // "纬度,经度"
}

/** provider 无关的工具声明（喂给 LLM 的部分，不含执行器） */
export interface LlmToolDef {
  name: string
  description: string
  /** 参数的 JSON Schema（provider 无关） */
  parameters: Record<string, unknown>
}

/** 完整工具：声明 + 执行器。P 默认宽松，便于注册成统一数组 */
export interface LlmTool<P = Record<string, unknown>, R = unknown> extends LlmToolDef {
  execute(params: P): Promise<R>
}

// ============ 小工具 ============

/** ISO8601 时间取 HH:MM，如 "2021-11-15T18:30+08:00" → "18:30" */
function hhmm(iso?: string): string {
  const m = iso?.match(/T(\d{2}:\d{2})/)
  return m ? m[1] : ''
}

/** 字符串数值安全转 number；空值返回 undefined（序列化时自动省略） */
function num(s: string | undefined | null): number | undefined {
  if (s == null || s === '') return undefined
  const n = Number(s)
  return isNaN(n) ? undefined : n
}

/** LLM 传入的 days 归一为合法值，非法则回退默认 */
function pickDays(days: unknown): DailyDays {
  return [3, 7, 10, 15].includes(days as number) ? (days as DailyDays) : 7
}
function pickHours(hours: unknown): HourlyHours {
  return [24, 72, 168].includes(hours as number) ? (hours as HourlyHours) : 24
}

/**
 * 把 LocationInput 解析为坐标 + 城市名。
 * coord 优先；否则用城市名在本地城市库精确/模糊匹配。失败抛 WeatherApiError。
 */
export function resolveLocation(input: LocationInput): { coord: string; name: string } {
  const { city, coord } = input
  if (coord) {
    const parts = coord.split(',').map((s) => Number(s.trim()))
    if (parts.length !== 2 || parts.some((n) => isNaN(n))) {
      throw new WeatherApiError('-1', `坐标格式错误：${coord}，应为 "纬度,经度"`)
    }
    return { coord, name: city ?? coord }
  }
  if (city) {
    const found = searchCities(city)[0]
    if (found) return { coord: `${found.lat},${found.lng}`, name: found.name }
    throw new WeatherApiError('-1', `未找到城市：${city}`)
  }
  throw new WeatherApiError('-1', '请提供 city 或 coord 之一')
}

// ============ LLM 友好的数据裁剪（降 token、数值化、时间化）============

function summarizeNow(now: WeatherNow, name: string) {
  return {
    city: name,
    observedAt: hhmm(now.obsTime),
    temp: num(now.temp),
    feelsLike: num(now.feelsLike),
    text: now.text,
    icon: now.icon,
    humidity: num(now.humidity),
    wind: { dir: now.windDir, scale: num(now.windScale), speed: num(now.windSpeed) },
    precip: num(now.precip),
    pressure: num(now.pressure),
    visibility: num(now.vis),
  }
}

function summarizeDaily(d: WeatherDaily) {
  return {
    date: d.fxDate,
    tempMax: num(d.tempMax),
    tempMin: num(d.tempMin),
    textDay: d.textDay,
    textNight: d.textNight,
    sunrise: d.sunrise || undefined,
    sunset: d.sunset || undefined,
    windDay: { dir: d.windDirDay, scale: num(d.windScaleDay) },
    windNight: { dir: d.windDirNight, scale: num(d.windScaleNight) },
    humidity: num(d.humidity),
    uvIndex: num(d.uvIndex),
    precip: num(d.precip),
  }
}

function summarizeHourly(h: WeatherHourly) {
  return {
    time: hhmm(h.fxTime),
    temp: num(h.temp),
    text: h.text,
    pop: num(h.pop), // 降水概率 %
    precip: num(h.precip),
    humidity: num(h.humidity),
    wind: { dir: h.windDir, scale: num(h.windScale) },
  }
}

// ============ 共享参数 Schema 片段 ============

const locationProps = {
  city: { type: 'string', description: '城市名（中文），如 "北京"、"上海"、"杭州"' },
  coord: { type: 'string', description: '"纬度,经度"，如 "39.90,116.40"；与 city 二选一' },
}

// ============ 工具定义 ============

/** 1. 实况天气 */
const currentTool: LlmTool<LocationInput> = {
  name: 'weather.current',
  description: '查询某城市/坐标的实时天气：温度、体感、天气现象、湿度、风力、降水、能见度等。',
  parameters: { type: 'object', properties: locationProps },
  async execute(params) {
    const { coord, name } = resolveLocation(params)
    const now = await weatherApi.now(coord)
    return summarizeNow(now, name)
  },
}

/** 2. 每日预报 */
const dailyTool: LlmTool<LocationInput & { days?: number }> = {
  name: 'weather.forecast_daily',
  description: '查询未来每日天气预报（白天/夜间天气、最高最低温、风力、日出日落），默认 7 天，可选 3/7/10/15 天。',
  parameters: {
    type: 'object',
    properties: { ...locationProps, days: { type: 'integer', enum: [3, 7, 10, 15], description: '预报天数，默认 7' } },
  },
  async execute({ days, ...loc }) {
    const { coord, name } = resolveLocation(loc)
    const list = await weatherApi.daily(coord, pickDays(days))
    return { city: name, days: pickDays(days), forecast: list.map(summarizeDaily) }
  },
}

/** 3. 逐小时预报 */
const hourlyTool: LlmTool<LocationInput & { hours?: number }> = {
  name: 'weather.forecast_hourly',
  description: '查询逐小时天气预报（每小时温度、天气、降水概率、湿度、风力），默认 24 小时，可选 24/72/168 小时。',
  parameters: {
    type: 'object',
    properties: { ...locationProps, hours: { type: 'integer', enum: [24, 72, 168], description: '预报时长（小时），默认 24' } },
  },
  async execute({ hours, ...loc }) {
    const { coord, name } = resolveLocation(loc)
    const list = await weatherApi.hourly(coord, pickHours(hours))
    return { city: name, hours: pickHours(hours), forecast: list.map(summarizeHourly) }
  },
}

/** 4. 分钟级降水 */
const precipTool: LlmTool<LocationInput> = {
  name: 'weather.precipitation',
  description: '查询未来 2 小时分钟级降水预报（逐 5 分钟降水量与降水类型），并给出文字摘要。适合回答"现在/马上会不会下雨"。',
  parameters: { type: 'object', properties: locationProps },
  async execute(params) {
    const { coord, name } = resolveLocation(params)
    const { summary, list } = await weatherApi.minutely(coord)
    const series = list.map((m: WeatherMinutely) => ({
      time: hhmm(m.fxTime),
      precip: num(m.precip),
      type: m.type,
    }))
    return { city: name, horizon: '2h', interval: '5min', summary, series }
  },
}

/** 5. 生活指数 */
const indicesTool: LlmTool<LocationInput & { types?: string }> = {
  name: 'weather.life_indices',
  description: '查询生活指数（穿衣、紫外线、洗车、感冒、运动、舒适度等，最多 16 项），默认返回全部。',
  parameters: {
    type: 'object',
    properties: {
      ...locationProps,
      types: { type: 'string', description: '指数类型代码逗号分隔（如 "3,5,9"），默认 "0" 取全部' },
    },
  },
  async execute({ types = '0', ...loc }) {
    const { coord, name } = resolveLocation(loc)
    const list = await weatherApi.indices(coord, types)
    const indices = list.map((ix: WeatherIndex) => ({
      type: ix.type,
      name: ix.name,
      level: ix.level,
      category: ix.category,
      text: ix.text,
    }))
    return { city: name, indices }
  },
}

/** 6. 城市搜索（本地库，不消耗 API 配额） */
const searchTool: LlmTool<{ keyword: string }, CityItem[]> = {
  name: 'weather.search_city',
  description: '在城市库中搜索城市，返回名称、所属省份、经纬度。用于在调用其它天气工具前确认城市名/坐标。不消耗 API 额度。',
  parameters: {
    type: 'object',
    properties: { keyword: { type: 'string', description: '城市名或省份关键字，如 "北京"、"浙江"' } },
    required: ['keyword'],
  },
  async execute({ keyword }) {
    return searchCities(keyword).slice(0, 10)
  },
}

/** 全部天气工具（仅含当前套餐可用能力） */
export const weatherTools: LlmTool[] = [
  currentTool,
  dailyTool,
  hourlyTool,
  precipTool,
  indicesTool,
  searchTool,
]

/** 喂给 LLM 的工具声明（剥离 execute，可直接序列化） */
export const weatherToolDefs: LlmToolDef[] = weatherTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

/** 按名执行工具（LLM 返回 tool_call 后由此分发） */
export async function callWeatherTool(name: string, params: unknown): Promise<unknown> {
  const tool = weatherTools.find((t) => t.name === name)
  if (!tool) throw new Error(`未知天气工具：${name}`)
  return tool.execute((params ?? {}) as Record<string, unknown>)
}
