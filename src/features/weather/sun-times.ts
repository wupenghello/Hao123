/**
 * 日出日落本地计算（NOAA 太阳位置算法，近似，误差通常 < 2 分钟）
 *
 * 用途：和风 7 天预报已含每日 sunrise/sunset，但预报拉取失败或高纬极昼/极夜
 *      场景下会缺失；此函数可仅凭城市经纬度算出日出日落，作为面板兜底。
 *
 * 时区按经度取整近似（中国全域约 UTC+8），返回值即"本地钟表时间"。
 */

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
/** 官方日出日落的天顶角（考虑大气折射） */
const ZENITH = 90.833

function norm360(x: number): number {
  return ((x % 360) + 360) % 360
}

function toHHMM(hours: number): string {
  const total = Math.round(hours * 60)
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 计算一年中的第几天（1~366） */
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000)
}

interface SunTimes {
  sunrise: string | null
  sunset: string | null
}

/**
 * 计算给定经纬度、日期的日出与日落（本地时间 HH:MM）
 * 极昼/极夜情形返回 null
 */
export function calcSunTimes(lat: number, lng: number, date = new Date()): SunTimes {
  // 时区（小时）：按经度每 15° 一个时区近似；中国全域约 +8
  const tz = Math.round(lng / 15)
  const n = dayOfYear(date)
  const lngHour = lng / 15

  // 日出用 t≈6h、日落用 t≈18h 作为初值
  const tRise = n + (6 - lngHour) / 24
  const tSet = n + (18 - lngHour) / 24

  function calc(t: number, rising: boolean): number | null {
    // 太阳平近点角
    const M = 0.9856 * t - 3.289
    // 太阳黄经
    let L = M + 1.916 * Math.sin(M * DEG) + 0.02 * Math.sin(2 * M * DEG) + 282.634
    L = norm360(L)
    // 太阳赤经
    let RA = RAD * Math.atan(0.91764 * Math.tan(L * DEG))
    RA = norm360(RA)
    // 将 RA 调整到与 L 同一象限
    const Lq = Math.floor(L / 90) * 90
    const RAq = Math.floor(RA / 90) * 90
    RA = (RA + (Lq - RAq)) / 15
    // 太阳赤纬
    const sinDec = 0.39782 * Math.sin(L * DEG)
    const cosDec = Math.cos(Math.asin(sinDec))
    // 时角
    const cosH = (Math.cos(ZENITH * DEG) - sinDec * Math.sin(lat * DEG)) / (cosDec * Math.cos(lat * DEG))
    if (cosH > 1 || cosH < -1) return null // 极昼 / 极夜
    const H = (rising ? 360 - Math.acos(cosH) * RAD : Math.acos(cosH) * RAD) / 15
    // 本地均时（小时）
    let local = H + RA - 0.06571 * t - 6.622 - lngHour + tz
    local = ((local % 24) + 24) % 24
    return local
  }

  return {
    sunrise: calc(tRise, true) != null ? toHHMM(calc(tRise, true)!) : null,
    sunset: calc(tSet, false) != null ? toHHMM(calc(tSet, false)!) : null,
  }
}
