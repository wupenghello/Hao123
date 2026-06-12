<script setup lang="ts">
import { useCategoryStore } from '@/stores/categories'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [id: string]
}>()

const store = useCategoryStore()

function selectCategory(id: string) {
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
    <button
      v-for="cat in store.categories"
      :key="cat.id"
      @click="selectCategory(cat.id)"
      class="category-pill relative px-4 py-2 text-sm whitespace-nowrap rounded-xl transition-all duration-300 ease-out"
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
</style>
