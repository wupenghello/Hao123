/**
 * Favicon 获取工具 — 多源 fallback 策略
 *
 * 优先级链：Google（高清 128px）→ Yandex（国内可用 64px）→ 域名根目录直取
 * 显示尺寸 32px (w-8)，需要 64px+ 源图才能在 Retina 屏上保持清晰
 */

/** 获取所有 favicon 候选源，按优先级排列 */
export function getFaviconSources(url: string): string[] {
  try {
    const u = new URL(url)
    const { hostname } = u
    return [
      `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`,
      `https://favicon.yandex.net/favicon/v2/${hostname}?size=64`,
      `https://${hostname}/favicon.ico`,
    ]
  } catch {
    return []
  }
}

/** 获取首选 favicon 地址（向后兼容） */
export function getFaviconUrl(url: string): string {
  return getFaviconSources(url)[0] ?? ''
}

/**
 * 基于字符串生成柔和色相（类似 GitHub avatar 配色）
 * 用于 favicon fallback 的字母图标背景色
 */
export function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = ((hash % 360) + 360) % 360
  return `hsl(${h}, 45%, 55%)`
}
