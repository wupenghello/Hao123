import { ref, provide, inject, type Ref } from 'vue'
import type { Bookmark } from '@/types'

const BOOKMARK_EDITOR_KEY = Symbol('bookmark-editor')

interface BookmarkEditor {
  editingBookmark: Ref<Bookmark | null>
  isAdding: Ref<boolean>
  startEdit: (bookmark: Bookmark) => void
  stopEdit: () => void
  startAdd: () => void
}

export function provideBookmarkEditor(): BookmarkEditor {
  const editingBookmark = ref<Bookmark | null>(null)
  const isAdding = ref(false)

  function startEdit(bookmark: Bookmark) {
    isAdding.value = false
    editingBookmark.value = bookmark
  }

  function stopEdit() {
    editingBookmark.value = null
    isAdding.value = false
  }

  function startAdd() {
    editingBookmark.value = null
    isAdding.value = true
  }

  const editor: BookmarkEditor = { editingBookmark, isAdding, startEdit, stopEdit, startAdd }
  provide(BOOKMARK_EDITOR_KEY, editor)
  return editor
}

export function useBookmarkEditor(): BookmarkEditor {
  const editor = inject<BookmarkEditor>(BOOKMARK_EDITOR_KEY)
  if (!editor) {
    throw new Error('useBookmarkEditor must be used inside a component that calls provideBookmarkEditor')
  }
  return editor
}
