<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDraggable } from 'vue-draggable-plus'
import { useCategoryStore } from '@/stores/categories'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [id: string]
}>()

const store = useCategoryStore()
const containerRef = ref<HTMLElement>()

const sortedCategories = computed(() => store.getSortedCategories())
const sortedIds = ref<string[]>([])

watch(sortedCategories, (val) => {
  sortedIds.value = val.map((c) => c.id)
}, { immediate: true })

useDraggable(containerRef, sortedIds, {
  animation: 150,
  onEnd: () => {
    store.reorderCategories(sortedIds.value)
  },
})

function selectCategory(id: string) {
  emit('update:modelValue', id)
}
</script>

<template>
  <div ref="containerRef" class="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
    <button
      v-for="cat in sortedCategories"
      :key="cat.id"
      :data-id="cat.id"
      @click="selectCategory(cat.id)"
      class="category-pill relative px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm whitespace-nowrap rounded-xl transition-all duration-300 ease-out"
      :class="
        modelValue === cat.id
          ? 'active-pill text-white font-medium shadow-lg'
          : 'text-white/50 hover:text-white/80 hover:bg-white/8'
      "
    >
      {{ cat.name }}
    </button>
  </div>
</template>

<style scoped>
.active-pill {
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

.category-pill:not(.active-pill) {
  border: 1px solid transparent;
}

.category-pill:not(.active-pill):hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}

.sortable-ghost {
  opacity: 0.3;
}

.sortable-drag {
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
}
</style>
