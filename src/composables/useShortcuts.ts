import { onMounted, onUnmounted } from 'vue'

export interface ShortcutConfig {
  onCategorySwitch: (index: number) => void
  onFocusSearch: () => void
  onToggleCommandPalette: () => void
}

/**
 * 模块化快捷键管理
 *
 * 统一注册全局快捷键：
 * - ⌘K / Ctrl+K  → 聚焦搜索框
 * - ⌘P / Ctrl+P  → 切换书签快速搜索面板
 * - 1-9          → 切换分类标签（输入框内不触发）
 */
export function useShortcuts(config: ShortcutConfig) {
  function handleKeydown(e: KeyboardEvent) {
    // ⌘K / Ctrl+K — 聚焦搜索
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      config.onFocusSearch()
      return
    }

    // ⌘P / Ctrl+P — 切换 Command Palette
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
      e.preventDefault()
      config.onToggleCommandPalette()
      return
    }

    // 数字键 1-9 — 切换分类（仅在非输入元素时触发）
    const target = e.target as HTMLElement
    const isInput =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable

    if (!isInput && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const num = parseInt(e.key)
      if (num >= 1 && num <= 9) {
        e.preventDefault()
        config.onCategorySwitch(num - 1)
        return
      }
    }
  }

  onMounted(() => document.addEventListener('keydown', handleKeydown))
  onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
}
