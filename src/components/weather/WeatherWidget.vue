<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useWeatherStore } from '@/stores/weather'
import { getWeatherIcon } from '@/utils/weather-icons'
import WeatherHoverCard from '@/components/weather/WeatherHoverCard.vue'
import WeatherDetailModal from '@/components/weather/WeatherDetailModal.vue'

const store = useWeatherStore()
const hoverVisible = ref(false)
const modalVisible = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

const currentIcon = computed(() => {
  const numtq = store.observe?.numtq
  return numtq ? getWeatherIcon(numtq) : null
})

function onMouseEnter() {
  if (modalVisible.value) return
  hoverTimer = setTimeout(() => { hoverVisible.value = true }, 300)
}

function onMouseLeave() {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverVisible.value = false
}

function onClick() {
  hoverVisible.value = false
  modalVisible.value = true
}

onMounted(() => store.startAutoRefresh())
onUnmounted(() => {
  store.stopAutoRefresh()
  if (hoverTimer) clearTimeout(hoverTimer)
})
</script>

<template>
  <div
    class="weather-area relative"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <!-- 行内：图标 + 温度 + 城市 -->
    <span
      class="inline-flex items-center gap-1 text-white text-[13px] font-normal tracking-[-0.01em] leading-none cursor-pointer hover:text-white/90 transition-colors"
      @click="onClick"
    >
      <component v-if="currentIcon" :is="currentIcon" class="w-4 h-4 text-white/80" />
      <span v-if="store.observe" class="tabular-nums">{{ store.observe.qw }}°</span>
      <span v-if="store.observe" class="text-white/60">{{ store.observe.cityName }}</span>
    </span>

    <!-- Hover 简易卡片 -->
    <Transition
      enter-active-class="transition-all duration-150 ease-out"
      leave-active-class="transition-all duration-100 ease-in"
      enter-from-class="opacity-0 -translate-y-1 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 -translate-y-1 scale-95"
    >
      <WeatherHoverCard v-if="hoverVisible && !modalVisible" />
    </Transition>

    <!-- Click 详细弹窗 -->
    <WeatherDetailModal :show="modalVisible" @close="modalVisible = false" />
  </div>
</template>
