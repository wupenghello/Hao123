import { ref, watch, type Ref } from 'vue'
import { getFaviconSources, hashColor } from '@/utils/favicon'
import type { Bookmark } from '@/types'

/**
 * Favicon 加载 composable — 带多源 fallback 和字母图标兜底
 *
 * 加载策略：
 * 1. 优先使用 bookmark.favicon（store 缓存）
 * 2. 失败后按 Yandex → Google → 域名直取 顺序尝试
 * 3. 全部失败则显示首字母彩色圆形
 */
export function useFavicon(bookmark: Ref<Bookmark>) {
  const faviconUrl = ref<string | null>(bookmark.value.favicon || null)
  const showLetter = ref(false)
  const letterColor = ref('')

  /** 尝试加载一张图片，成功 resolve true，失败 resolve false */
  function tryLoad(src: string): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      // 超时保护，避免请求无限挂起
      setTimeout(() => resolve(false), 5000)
      img.src = src
    })
  }

  /** 按优先级尝试所有 favicon 源 */
  async function resolveFavicon() {
    showLetter.value = false
    const sources = getFaviconSources(bookmark.value.url)

    // 如果有缓存值且在源列表中，先尝试它
    if (bookmark.value.favicon) {
      const ok = await tryLoad(bookmark.value.favicon)
      if (ok) {
        faviconUrl.value = bookmark.value.favicon
        return
      }
    }

    // 依次尝试候选源
    for (const src of sources) {
      const ok = await tryLoad(src)
      if (ok) {
        faviconUrl.value = src
        return
      }
    }

    // 全部失败，启用字母 fallback
    faviconUrl.value = null
    showLetter.value = true
    letterColor.value = hashColor(bookmark.value.url || bookmark.value.name)
  }

  // 监听 bookmark 变化（编辑 URL 后重新解析）
  watch(bookmark, resolveFavicon, { immediate: true })

  return { faviconUrl, showLetter, letterColor }
}
