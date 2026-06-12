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

function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('#search-input')?.focus()
  }
}

onMounted(() => {
  document.addEventListener('click', closeDropdown)
  document.addEventListener('keydown', handleKeydown)
})
onUnmounted(() => {
  document.removeEventListener('click', closeDropdown)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="relative w-full max-w-2xl mx-auto">
    <div class="search-bar flex items-center rounded-full px-5 py-3.5">
      <!-- 搜索引擎选择器 -->
      <div class="relative engine-selector">
        <button
          class="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors pr-4 border-r border-white/10"
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
            class="engine-dropdown absolute top-full left-0 mt-2.5 rounded-2xl py-2 z-50 min-w-[170px]"
          >
            <button
              v-for="engine in searchStore.engines"
              :key="engine.id"
              @click="selectEngine(engine.id)"
              class="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
              :class="engine.id === searchStore.currentEngine.id ? 'text-blue-300 bg-white/10' : 'text-white/60 hover:bg-white/8'"
            >
              <span class="font-medium">{{ engine.name }}</span>
              <span v-if="engine.id === searchStore.currentEngine.id" class="ml-auto text-blue-400">✓</span>
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
        class="flex-1 mx-4 bg-transparent outline-none text-white placeholder-white/30 text-[15px]"
        @keydown.enter="handleSearch"
      />

      <!-- 搜索按钮 -->
      <button
        @click="handleSearch"
        class="search-btn px-5 py-1.5 rounded-full text-sm font-medium transition-all duration-300 shadow-lg"
      >
        <IconSearch class="w-4 h-4 inline-block -mt-0.5" />
        <span class="ml-1.5">搜索</span>
      </button>
    </div>

    <!-- 快捷键提示 -->
    <div class="mt-3 flex items-center gap-4">
      <span class="text-xs text-white/30">
        <kbd class="px-1.5 py-0.5 bg-white/8 rounded text-white/40 text-[11px] font-mono border border-white/10">⌘K</kbd>
        聚焦搜索
      </span>
      <span class="text-xs text-white/30">
        <kbd class="px-1.5 py-0.5 bg-white/8 rounded text-white/40 text-[11px] font-mono border border-white/10">⌘P</kbd>
        快速找书签
      </span>
    </div>
  </div>
</template>

<style scoped>
.search-bar {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.engine-dropdown {
  background: rgba(30, 40, 60, 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
}

.search-btn {
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  color: white;
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
}

.search-btn:hover {
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
  transform: translateY(-1px);
}

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
