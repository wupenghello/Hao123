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
      class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200"
      :class="
        modelValue === cat.id
          ? 'bg-blue-500 text-white shadow-md'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      "
    >
      {{ cat.name }}
    </button>
  </div>
</template>
