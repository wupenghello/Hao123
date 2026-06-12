import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { defaultBookmarks, defaultCategories } from '@/utils/default-bookmarks'
import { getFaviconUrl } from '@/utils/favicon'
import type { Bookmark, Category } from '@/types'

export const useBookmarkStore = defineStore('bookmarks', () => {
  const categories = useStorage<Category[]>('hao123-categories', defaultCategories)
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

  function addCategory(name: string, icon: string) {
    const newCategory: Category = {
      id: `cat-${Date.now()}`,
      name,
      icon,
      order: categories.value.length,
    }
    categories.value.push(newCategory)
  }

  function deleteCategory(id: string) {
    const index = categories.value.findIndex((c) => c.id === id)
    if (index !== -1) {
      categories.value.splice(index, 1)
      bookmarks.value = bookmarks.value.filter((b) => b.categoryId !== id)
    }
  }

  return {
    categories,
    bookmarks,
    getBookmarksByCategory,
    addBookmark,
    updateBookmark,
    deleteBookmark,
    addCategory,
    deleteCategory,
  }
})
