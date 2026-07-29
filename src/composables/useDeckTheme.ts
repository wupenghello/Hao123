import { computed } from 'vue'
import { useStorage } from '@/composables/useStorage'

export type DeckThemeId = 'f' | 'g' | 'h' | 'i' | 'j'

export interface DeckThemeDef {
  id: DeckThemeId
  letter: string
  name: string
  desc: string
}

export const DECK_THEMES: DeckThemeDef[] = [
  { id: 'f', letter: 'F', name: '轨道光珠', desc: '光珠沿倾斜 3D 轨道环绕卡堆，近大远小' },
  { id: 'g', letter: 'G', name: '螺旋天梯', desc: '节点绕卡堆盘旋上升成 DNA 螺旋' },
  { id: 'h', letter: 'H', name: '纵深回廊', desc: '发光门框向后没入雾中，用纵深表达余量' },
  { id: 'i', letter: 'I', name: '全息晶柱', desc: '网格地板上每项一根发光晶柱' },
  { id: 'j', letter: 'J', name: '弧面副卡', desc: '迷你副卡排成向两侧后退的 3D 弧线' },
]

export const DEFAULT_THEME: DeckThemeId = 'j'

// 模块级单例 ref：状态栏切换器与 InboxDeck 共享同一份主题状态，否则两端各持一份 ref 会不同步。
const current = useStorage<DeckThemeId>('hao123-deck-theme', DEFAULT_THEME)

/** 队列可视化主题：持久化到 localStorage，默认「弧面副卡」。 */
export function useDeckTheme() {
  const index = computed(() => Math.max(0, DECK_THEMES.findIndex((t) => t.id === current.value)))
  const currentMeta = computed(() => DECK_THEMES[index.value])
  const setTheme = (id: DeckThemeId) => {
    current.value = id
  }
  const nextTheme = () => {
    current.value = DECK_THEMES[(index.value + 1) % DECK_THEMES.length].id
  }
  return { current, currentMeta, themes: DECK_THEMES, index, setTheme, nextTheme }
}
