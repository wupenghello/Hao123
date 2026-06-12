<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSearch } from '@/composables/useSearch'
import IconSearch from '~icons/mdi/magnify'
import IconChevronDown from '~icons/mdi/chevron-down'

const { searchEngines, currentEngine, search, switchEngine } = useSearch()

const query = ref('')
const showDropdown = ref(false)

function handleSearch() {
  search(query.value)
}

function handleKeydown(e: KeyboardEvent) {
  // Ctrl/Cmd + K 聚焦搜索框
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('#search-input')?.focus()
  }
}

function selectEngine(id: string) {
  switchEngine(id)
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

onMounted(() => document.addEventListener('click', closeDropdown))
onUnmounted(() => document.removeEventListener('click', closeDropdown))
</script>

<template>
  <div class="relative w-full max-w-2xl mx-auto">
    <div class="flex items-center glass rounded-full shadow-lg px-5 py-3 border border-white/30">
      <!-- 搜索引擎选择器 -->
      <div class="relative engine-selector">
        <button
          class="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors pr-3 border-r border-gray-200"
          @click="toggleDropdown"
          :title="`当前搜索引擎: ${currentEngine.name}`"
        >
          <span>{{ currentEngine.name }}</span>
          <IconChevronDown class="w-4 h-4" />
        </button>

        <!-- 下拉菜单 -->
        <Transition name="dropdown">
          <div
            v-if="showDropdown"
            class="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 min-w-[160px]"
          >
            <button
              v-for="engine in searchEngines"
              :key="engine.id"
              @click="selectEngine(engine.id)"
              class="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors"
              :class="engine.id === currentEngine.id ? 'text-blue-600 bg-blue-50/50' : 'text-gray-700'"
            >
              <span>{{ engine.name }}</span>
              <span v-if="engine.id === currentEngine.id" class="ml-auto text-blue-500">✓</span>
            </button>
          </div>
        </Transition>
      </div>

      <!-- 搜索输入框 -->
      <input
        id="search-input"
        v-model="query"
        type="text"
        :placeholder="`在 ${currentEngine.name} 中搜索...`"
        class="flex-1 mx-3 bg-transparent outline-none text-gray-800 placeholder-gray-400"
        @keydown.enter="handleSearch"
      />

      <!-- 搜索按钮 -->
      <button
        @click="handleSearch"
        class="p-1.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition-colors"
      >
        <IconSearch class="w-5 h-5" />
      </button>
    </div>

    <!-- 快捷键提示 -->
    <div class="text-center mt-2">
      <span class="text-xs text-white/60">
        按 <kbd class="px-1.5 py-0.5 bg-white/20 rounded text-white/80">Ctrl+K</kbd> 聚焦搜索
      </span>
    </div>
  </div>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
