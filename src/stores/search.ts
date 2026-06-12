import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@/composables/useStorage'
import type { SearchEngine } from '@/types'

const defaultEngines: SearchEngine[] = [
  {
    id: 'google',
    name: 'Google',
    icon: 'mdi:google',
    searchUrl: 'https://www.google.com/search?q={query}',
  },
  {
    id: 'baidu',
    name: '百度',
    icon: 'simple-icons:baidu',
    searchUrl: 'https://www.baidu.com/s?wd={query}',
  },
]

export const useSearchStore = defineStore('search', () => {
  const engines = useStorage<SearchEngine[]>('hao123-engines', defaultEngines)
  const currentEngineId = useStorage<string>('hao123-current-engine', 'google')

  const currentEngine = computed(() =>
    engines.value.find((e) => e.id === currentEngineId.value) ?? engines.value[0]
  )

  function setEngine(id: string) {
    currentEngineId.value = id
  }

  return { engines, currentEngineId, currentEngine, setEngine }
})
