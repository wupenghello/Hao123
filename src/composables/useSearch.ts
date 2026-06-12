import { computed } from 'vue'
import { useSearchStore } from '@/stores/search'

export function useSearch() {
  const searchStore = useSearchStore()

  const searchEngines = computed(() => searchStore.engines)
  const currentEngine = computed(() => searchStore.currentEngine)

  function search(query: string) {
    if (!query.trim()) return
    const url = currentEngine.value.searchUrl.replace('{query}', encodeURIComponent(query.trim()))
    window.open(url, '_blank')
  }

  function switchEngine(engineId: string) {
    searchStore.setEngine(engineId)
  }

  return {
    searchEngines,
    currentEngine,
    search,
    switchEngine,
  }
}
