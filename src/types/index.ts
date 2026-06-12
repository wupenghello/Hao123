export interface Bookmark {
  id: string
  name: string
  url: string
  description?: string
  categoryId: string
  order: number
  favicon?: string
  visitCount?: number
  lastVisitedAt?: number
  createdAt: number
}

export interface Category {
  id: string
  name: string
  icon: string
  order: number
}

export interface SearchEngine {
  id: string
  name: string
  icon: string
  searchUrl: string // 含 {query} 占位符
}

// 丫丫天气 API 类型
export interface WeatherObserve {
  cityId: string
  cityName: string
  lastUpdate: string
  tq: string       // 天气现象，如 "多云"
  numtq: string     // 天气编码
  qw: string        // 当前气温
  fl: string        // 当前风力
  numfl: string     // 风力编码
  fx: string        // 当前风向
  numfx: string     // 风向编码
  sd: string        // 相对湿度
}

export interface WeatherForecastDay {
  tq1: string       // 白天天气
  tq2: string       // 夜间天气
  numtq1: string    // 白天天气编码
  numtq2: string    // 夜间天气编码
  qw1: string       // 白天气温
  qw2: string       // 夜间气温
  fl1: string       // 白天风力
  numfl1: string    // 白天风力编码
  fl2: string       // 夜间风力
  numfl2: string    // 夜间风力编码
  fx1: string       // 白天风向
  numfx1: string    // 白天风向编码
  fx2: string       // 夜间风向
  numfx2: string    // 夜间风向编码
  date: string      // 预报日期
}

export interface YytianqiResponse<T> {
  code: number
  msg: string
  counts: number
  data: T
}
