import { ref, provide, inject, type Ref } from 'vue'
import type { Bookmark } from '@/types'

const CONTEXT_MENU_KEY = Symbol('context-menu')

export interface ContextMenuContext {
  visible: Ref<boolean>
  bookmark: Ref<Bookmark | null>
  x: Ref<number>
  y: Ref<number>
  show: (event: MouseEvent, bookmark: Bookmark) => void
  close: () => void
}

export function provideContextMenu(): ContextMenuContext {
  const visible = ref(false)
  const bookmark = ref<Bookmark | null>(null)
  const x = ref(0)
  const y = ref(0)

  function show(event: MouseEvent, bm: Bookmark) {
    const padding = 8
    const menuWidth = 200
    const menuHeight = 280

    let posX = event.clientX
    let posY = event.clientY

    if (posX + menuWidth > window.innerWidth - padding) {
      posX = window.innerWidth - menuWidth - padding
    }
    if (posY + menuHeight > window.innerHeight - padding) {
      posY = window.innerHeight - menuHeight - padding
    }

    x.value = Math.max(padding, posX)
    y.value = Math.max(padding, posY)
    bookmark.value = bm
    visible.value = true
  }

  function close() {
    visible.value = false
    bookmark.value = null
  }

  const ctx: ContextMenuContext = { visible, bookmark, x, y, show, close }
  provide(CONTEXT_MENU_KEY, ctx)
  return ctx
}

export function useContextMenu(): ContextMenuContext {
  const ctx = inject<ContextMenuContext>(CONTEXT_MENU_KEY)
  if (!ctx) {
    throw new Error('useContextMenu must be used inside a component that calls provideContextMenu')
  }
  return ctx
}
