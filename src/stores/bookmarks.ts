import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { defaultBookmarks } from '@/utils/default-bookmarks'
import { getFaviconUrl } from '@/utils/favicon'
import type { Bookmark } from '@/types'

export const useBookmarkStore = defineStore('bookmarks', () => {
  const bookmarks = useStorage<Bookmark[]>('hao123-bookmarks', defaultBookmarks)

  function getBookmarksByCategory(categoryId: string): Bookmark[] {
    return bookmarks.value
      .filter((b) => b.categoryId === categoryId)
      .sort((a, b) => a.order - b.order)
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
  }
})
