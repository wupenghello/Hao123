<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSearchStore } from '@/stores/search'
import IconSearch from '~icons/mdi/magnify'
import IconChevronDown from '~icons/mdi/chevron-down'

const searchStore = useSearchStore()

const query = ref('')
const showDropdown = ref(false)

function handleSearch() {
  searchStore.search(query.value)
}

function selectEngine(id: string) {
  searchStore.setEngine(id)
  showDropdown.value = false
}

function toggleDropdown() {
  showDropdown.value = !showDropdown.value
}

function closeDropdown(e: Event) {
  if (!(e.target as HTMLElement).closest('.engine-selector')) {
    showDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', closeDropdown)
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      document.querySelector<HTMLInputElement>('#search-input')?.focus()
    }
  })
})
onUnmounted(() => document.removeEventListener('click', closeDropdown))
</script>

<template>
  <div class="relative w-full max-w-2xl mx-auto">
    <div class="flex items-center glass rounded-full shadow-xl px-5 py-3.5">
      <!-- 搜索引擎选择器 -->
      <div class="relative engine-selector">
        <button
          class="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors pr-4 border-r border-gray-200/80"
          @click="toggleDropdown"
          :title="`当前搜索引擎: ${searchStore.currentEngine.name}`"
        >
          <span class="font-medium">{{ searchStore.currentEngine.name }}</span>
          <IconChevronDown class="w-4 h-4 transition-transform" :class="showDropdown ? 'rotate-180' : ''" />
        </button>

        <!-- 下拉菜单 -->
        <Transition name="dropdown">
          <div
            v-if="showDropdown"
            class="absolute top-full left-0 mt-2.5 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100/80 py-2 z-50 min-w-[170px]"
          >
            <button
              v-for="engine in searchStore.engines"
              :key="engine.id"
              @click="selectEngine(engine.id)"
              class="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
              :class="engine.id === searchStore.currentEngine.id ? 'text-blue-600 bg-blue-50/60' : 'text-gray-600 hover:bg-gray-50'"
            >
              <span class="font-medium">{{ engine.name }}</span>
              <span v-if="engine.id === searchStore.currentEngine.id" class="ml-auto text-blue-500">✓</span>
            </button>
          </div>
        </Transition>
      </div>

      <!-- 搜索输入框 -->
      <input
        id="search-input"
        v-model="query"
        type="text"
        :placeholder="`在 ${searchStore.currentEngine.name} 中搜索...`"
        class="flex-1 mx-4 bg-transparent outline-none text-gray-800 placeholder-gray-400/70 text-[15px]"
        @keydown.enter="handleSearch"
      />

      <!-- 搜索按钮 -->
      <button
        @click="handleSearch"
        class="px-4 py-1.5 rounded-full bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm"
      >
        <IconSearch class="w-4 h-4 inline-block -mt-0.5" />
        <span class="ml-1">搜索</span>
      </button>
    </div>

    <!-- 快捷键提示 -->
    <div class="text-center mt-3">
      <span class="text-xs text-white/50">
        <kbd class="px-1.5 py-0.5 bg-white/10 rounded text-white/60 text-[11px] font-mono">⌘K</kbd>
        聚焦搜索
      </span>
    </div>
  </div>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
