/**
 * Chat 助手 · 全局召唤快捷键
 *
 * Alt+K（及 Mac 上的 Cmd+K）切换命令面板；Esc 关闭。
 * 在 App 根组件挂载一次即可，自动随组件卸载解绑。
 */
import { onMounted, onUnmounted } from 'vue'
import { useChatStore } from './store'

export function useChatHotkeys() {
  const store = useChatStore()

  function onKeydown(e: KeyboardEvent) {
    // Alt+K（跨平台）或 Cmd+K（Mac），K 不区分大小写
    const isToggle = (e.altKey || e.metaKey) && (e.key === 'k' || e.key === 'K')
    if (isToggle) {
      e.preventDefault()
      store.toggle()
      return
    }
    // Esc 关闭（输入法合成中不处理，避免误关）
    if (e.key === 'Escape' && store.open && !e.isComposing) {
      store.close()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onUnmounted(() => window.removeEventListener('keydown', onKeydown))
}
