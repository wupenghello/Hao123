export interface Bookmark {
  id: string
  name: string
  url: string
  description?: string
  categoryId: string
  order: number
  favicon?: string
  createdAt: number
}

export interface Category {
  id: string
  name: string
  icon: string
  order: number
}

export interface SearchEngine {
  id: string
  name: string
  icon: string
  searchUrl: string // 含 {query} 占位符
}
