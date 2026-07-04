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
    class="weather-widget"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @click="onClick"
  >
    <template v-if="store.now">
      <span class="weather-icon-core">
        <component v-if="currentIcon" :is="currentIcon" class="weather-icon" />
      </span>
      <span class="weather-temp">{{ store.now.temp }}°</span>
      <span class="weather-city">{{ store.cityName }}</span>
    </template>
    <!-- 首次加载中：显示已持久化的城市名 + 旋转图标，避免状态栏空白 -->
    <template v-else-if="store.loading">
      <span class="weather-icon-core">
        <IconLoading class="weather-icon weather-spin" />
      </span>
      <span class="weather-city is-muted">{{ store.cityName }}</span>
    </template>
    <!-- 加载失败且无数据：轻量错误提示，点击仍可打开弹窗查看详情/重试 -->
    <template v-else-if="store.error">
      <span class="weather-icon-core is-warn">
        <IconAlertCircleOutline class="weather-icon" />
      </span>
      <span class="weather-city is-muted">天气暂不可用</span>
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

<style scoped>
.weather-widget {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  padding: 4px 7px;
  border-radius: 6px;
  color: rgba(224, 242, 254, 0.84);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.weather-widget:hover {
  background: rgba(94, 234, 212, 0.08);
  color: #fff;
}
.weather-icon-core {
  display: inline-flex;
  align-items: center;
  color: rgba(94, 234, 212, 0.94);
  flex: 0 0 auto;
}
.weather-icon-core.is-warn {
  color: rgba(252, 211, 77, 0.92);
}
.weather-icon {
  width: 14px;
  height: 14px;
}
.weather-spin {
  animation: weather-spin 0.9s linear infinite;
}
@keyframes weather-spin {
  to {
    transform: rotate(360deg);
  }
}
.weather-temp {
  font-family: var(--hud-font-data);
  font-size: 12px;
  font-weight: 850;
  font-variant-numeric: tabular-nums;
}
.weather-city {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.weather-city.is-muted {
  color: rgba(224, 242, 254, 0.58);
}
@media (max-width: 760px) {
  .weather-city {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .weather-spin {
    animation: none;
  }
}
</style>
