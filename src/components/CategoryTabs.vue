<script setup lang="ts">
import { useBookmarkStore } from '@/stores/bookmarks'
import { ref, computed } from 'vue'

const store = useBookmarkStore()
const activeCategoryId = ref<string>(store.categories[0]?.id ?? '')

const activeCategory = computed(() =>
  store.categories.find((c) => c.id === activeCategoryId.value)
)

function selectCategory(id: string) {
  activeCategoryId.value = id
}

defineExpose({ activeCategoryId })
</script>

<template>
  <div class="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
    <button
      v-for="cat in store.categories"
      :key="cat.id"
      @click="selectCategory(cat.id)"
      class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200"
      :class="
        activeCategoryId === cat.id
          ? 'bg-blue-500 text-white shadow-md'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      "
    >
      {{ cat.name }}
    </button>
  </div>
</template>
