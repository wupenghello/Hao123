<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useWeatherStore } from '../store'
import { getWeatherIcon } from '../icons'
import WeatherHoverCard from './WeatherHoverCard.vue'
import WeatherDetailModal from './WeatherDetailModal.vue'
import IconLoading from '~icons/mdi/loading'
import IconAlertCircleOutline from '~icons/mdi/alert-circle-outline'

const store = useWeatherStore()
const hoverVisible = ref(false)
const modalVisible = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

const currentIcon = computed(() => {
  const icon = store.now?.icon
  return icon ? getWeatherIcon(icon) : null
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
  <span
    class="relative inline-flex items-center text-white text-[13px] font-normal tracking-[-0.01em] leading-none cursor-pointer hover:text-white/90 transition-colors"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @click="onClick"
  >
    <template v-if="store.now">
      <component v-if="currentIcon" :is="currentIcon" class="w-[13px] h-[13px] mr-1" />
      <span class="tabular-nums mr-1">{{ store.now.temp }}°</span>
      <span>{{ store.cityName }}</span>
    </template>
    <!-- 首次加载中：显示已持久化的城市名 + 旋转图标，避免状态栏空白 -->
    <template v-else-if="store.loading">
      <IconLoading class="w-[13px] h-[13px] mr-1 animate-spin text-white/55" />
      <span class="text-white/55">{{ store.cityName }}</span>
    </template>
    <!-- 加载失败且无数据：轻量错误提示，点击仍可打开弹窗查看详情/重试 -->
    <template v-else-if="store.error">
      <IconAlertCircleOutline class="w-[13px] h-[13px] mr-1 text-amber-300/80" />
      <span class="text-white/55">天气暂不可用</span>
    </template>

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
  </span>
</template>
