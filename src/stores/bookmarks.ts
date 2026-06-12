import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { defaultBookmarks } from '@/utils/default-bookmarks'
import { getFaviconUrl } from '@/utils/favicon'
import type { Bookmark } from '@/types'

export const useBookmarkStore = defineStore('bookmarks', () => {
  const bookmarks = useStorage<Bookmark[]>('hao123-bookmarks', defaultBookmarks)

  /** "常用"分类 ID — 该分类按访问频率自动排序 */
  const FREQUENCY_CATEGORY_ID = 'cat-1'

  function getBookmarksByCategory(categoryId: string): Bookmark[] {
    const list = bookmarks.value.filter((b) => b.categoryId === categoryId)

    if (categoryId === FREQUENCY_CATEGORY_ID) {
      // "常用"分类：按访问次数降序 → 最后访问时间降序
      return [...list].sort((a, b) => {
        const countDiff = (b.visitCount ?? 0) - (a.visitCount ?? 0)
        if (countDiff !== 0) return countDiff
        return (b.lastVisitedAt ?? 0) - (a.lastVisitedAt ?? 0)
      })
    }

    // 其他分类：保持手动排序
    return [...list].sort((a, b) => a.order - b.order)
  }

  function addBookmark(bookmark: Omit<Bookmark, 'id' | 'order' | 'createdAt' | 'favicon'>) {
    const categoryBookmarks = getBookmarksByCategory(bookmark.categoryId)
    const newBookmark: Bookmark = {
      ...bookmark,
      id: `bm-${Date.now()}`,
      order: categoryBookmarks.length,
      favicon: getFaviconUrl(bookmark.url),
      createdAt: Date.now(),
    }
    bookmarks.value.push(newBookmark)
  }

  function updateBookmark(id: string, data: Partial<Bookmark>) {
    const index = bookmarks.value.findIndex((b) => b.id === id)
    if (index !== -1) {
      bookmarks.value[index] = { ...bookmarks.value[index], ...data }
      if (data.url) {
        bookmarks.value[index].favicon = getFaviconUrl(data.url)
      }
    }
  }

  function deleteBookmark(id: string) {
    const index = bookmarks.value.findIndex((b) => b.id === id)
    if (index !== -1) {
      bookmarks.value.splice(index, 1)
    }
  }

  function deleteBookmarksByCategory(categoryId: string) {
    bookmarks.value = bookmarks.value.filter((b) => b.categoryId !== categoryId)
  }

  /** 记录书签访问（递增计数 + 更新时间戳） */
  function recordVisit(id: string) {
    const bm = bookmarks.value.find((b) => b.id === id)
    if (bm) {
      bm.visitCount = (bm.visitCount ?? 0) + 1
      bm.lastVisitedAt = Date.now()
    }
  }

  function reorderBookmarks(_categoryId: string, reorderedIds: string[]) {
    reorderedIds.forEach((id, index) => {
      const bm = bookmarks.value.find((b) => b.id === id)
      if (bm) bm.order = index
    })
  }

  return {
    bookmarks,
    getBookmarksByCategory,
    addBookmark,
    updateBookmark,
    deleteBookmark,
    deleteBookmarksByCategory,
    reorderBookmarks,
    recordVisit,
  }
})
