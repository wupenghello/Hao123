import { ref, provide, inject, type Ref } from 'vue'
import type { Bookmark } from '@/types'

const BOOKMARK_EDITOR_KEY = Symbol('bookmark-editor')

interface BookmarkEditor {
  editingBookmark: Ref<Bookmark | null>
  startEdit: (bookmark: Bookmark) => void
  stopEdit: () => void
}

export function provideBookmarkEditor(): BookmarkEditor {
  const editingBookmark = ref<Bookmark | null>(null)

  function startEdit(bookmark: Bookmark) {
    editingBookmark.value = bookmark
  }

  function stopEdit() {
    editingBookmark.value = null
  }

  const editor: BookmarkEditor = { editingBookmark, startEdit, stopEdit }
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
