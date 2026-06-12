import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import { defaultCategories } from '@/utils/default-categories'
import type { Category } from '@/types'

export const useCategoryStore = defineStore('categories', () => {
  const categories = useStorage<Category[]>('hao123-categories', defaultCategories)

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
    }
  }

  function getSortedCategories(): Category[] {
    return [...categories.value].sort((a, b) => a.order - b.order)
  }

  function reorderCategories(reorderedIds: string[]) {
    reorderedIds.forEach((id, index) => {
      const cat = categories.value.find((c) => c.id === id)
      if (cat) cat.order = index
    })
  }

  return { categories, addCategory, deleteCategory, getSortedCategories, reorderCategories }
})
