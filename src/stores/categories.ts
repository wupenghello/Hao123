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

  return { categories, addCategory, deleteCategory }
})
