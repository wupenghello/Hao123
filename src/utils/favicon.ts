/**
 * 根据 URL 生成 favicon 地址（使用 Google Favicon 服务）
 */
export function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`
  } catch {
    return ''
  }
}
