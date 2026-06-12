import type { Category } from '@/types'

export const defaultCategories: Category[] = [
  { id: 'cat-1', name: '常用', icon: 'mdi:star', order: 0 },
  { id: 'cat-2', name: '工作', icon: 'mdi:briefcase', order: 1 },
  { id: 'cat-3', name: '学习', icon: 'mdi:school', order: 2 },
  { id: 'cat-4', name: '社交', icon: 'mdi:account-group', order: 3 },
  { id: 'cat-5', name: '影音', icon: 'mdi:play-circle', order: 4 },
  { id: 'cat-6', name: '工具', icon: 'mdi:wrench', order: 5 },
]
