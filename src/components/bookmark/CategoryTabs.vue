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
  <div class="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin border-b border-gray-200/60">
    <button
      v-for="cat in store.categories"
      :key="cat.id"
      @click="selectCategory(cat.id)"
      class="relative px-4 py-2 text-sm whitespace-nowrap transition-colors duration-200"
      :class="
        modelValue === cat.id
          ? 'text-gray-800 font-semibold'
          : 'text-gray-400 hover:text-gray-600'
      "
    >
      {{ cat.name }}
      <!-- 底部指示器 -->
      <span
        v-if="modelValue === cat.id"
        class="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-blue-500"
      />
    </button>
  </div>
</template>
