<script setup lang="ts">
/**
 * 城市选择器组件
 * 包含：搜索框 + 搜索结果列表 + 省份分组折叠列表
 */
import { ref, computed } from 'vue'
import { provinceGroups, searchCities, type CityItem } from '@/utils/city-data'
import IconChevronRight from '~icons/mdi/chevron-right'

const props = defineProps<{
  currentCity?: string
}>()

const emit = defineEmits<{
  select: [city: CityItem]
}>()

const searchKeyword = ref('')
const expandedProvince = ref<string | null>(null)

const searchResults = computed(() => {
  if (!searchKeyword.value.trim()) return []
  return searchCities(searchKeyword.value)
})

function selectCity(city: CityItem) {
  emit('select', city)
  searchKeyword.value = ''
  expandedProvince.value = null
}

function toggleProvince(name: string) {
  expandedProvince.value = expandedProvince.value === name ? null : name
}
</script>

<template>
  <div class="city-selector">
    <!-- 搜索框 -->
    <input
      v-model="searchKeyword"
      type="text"
      placeholder="搜索城市名或省份..."
      class="w-full bg-white/8 border border-white/12 rounded-xl px-3 py-2 text-white text-[12px] placeholder:text-white/30 focus:outline-none focus:border-white/25 mb-3"
    />

    <!-- 搜索结果 -->
    <div v-if="searchKeyword.trim()" class="space-y-0.5">
      <button
        v-for="city in searchResults"
        :key="city.name + city.province"
        class="w-full text-left px-3 py-1.5 text-[12px] rounded-lg transition-colors hover:bg-white/12 text-white/70 hover:text-white/90"
        @click="selectCity(city)"
      >
        {{ city.name }}
        <span class="text-white/35 ml-1">{{ city.province }}</span>
      </button>
      <div v-if="searchResults.length === 0" class="text-white/30 text-[11px] text-center py-3">
        未找到匹配城市
      </div>
    </div>

    <!-- 省份分组 -->
    <div v-else class="space-y-0.5">
      <div v-for="group in provinceGroups" :key="group.name">
        <button
          class="w-full flex items-center gap-1 px-2 py-1.5 text-[11px] rounded-lg transition-colors hover:bg-white/8"
          :class="expandedProvince === group.name ? 'text-white/80' : 'text-white/45'"
          @click="toggleProvince(group.name)"
        >
          <IconChevronRight
            class="w-3 h-3 transition-transform duration-150 flex-shrink-0"
            :class="{ 'rotate-90': expandedProvince === group.name }"
          />
          <span class="font-medium">{{ group.name }}</span>
          <span class="text-white/25 ml-auto">{{ group.cities.length }}</span>
        </button>
        <Transition
          enter-active-class="transition-all duration-150 ease-out"
          leave-active-class="transition-all duration-100 ease-in"
          enter-from-class="opacity-0 max-h-0"
          enter-to-class="opacity-100 max-h-[300px]"
          leave-from-class="opacity-100 max-h-[300px]"
          leave-to-class="opacity-0 max-h-0"
        >
          <div v-if="expandedProvince === group.name" class="overflow-hidden pl-3 pb-1">
            <div class="flex flex-wrap gap-1">
              <button
                v-for="city in group.cities"
                :key="city.name"
                class="px-2 py-0.5 text-[11px] rounded-md transition-colors"
                :class="props.currentCity === city.name
                  ? 'bg-white/20 text-white'
                  : 'bg-white/6 text-white/50 hover:bg-white/12 hover:text-white/70'"
                @click="selectCity(city)"
              >
                {{ city.name }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>
