<script setup lang="ts">
import { computed } from 'vue'
import { useWeatherStore } from '@/stores/weather'
import { getWeatherIcon } from '@/utils/weather-icons'
import IconWaterPercent from '~icons/mdi/water-percent'
import IconWeatherWindyVariant from '~icons/mdi/weather-windy-variant'

const store = useWeatherStore()

const icon = computed(() => {
  const numtq = store.observe?.numtq
  return numtq ? getWeatherIcon(numtq) : null
})

const todayForecast = computed(() => store.forecast[0] ?? null)

function formatTime(str: string) {
  return str ? str.split(' ')[1]?.slice(0, 5) : ''
}
</script>

<template>
  <div
    v-if="store.observe"
    class="absolute top-full mt-2 right-0 w-[220px] rounded-2xl px-4 py-3 glass-dark shadow-xl"
  >
    <div class="flex items-center gap-3 mb-2">
      <component v-if="icon" :is="icon" class="w-8 h-8 text-white/85 flex-shrink-0" />
      <div>
        <div class="text-white text-xl font-medium tabular-nums leading-tight">
          {{ store.observe.qw }}°
        </div>
        <div class="text-white/60 text-[11px]">{{ store.observe.tq }}</div>
      </div>
    </div>

    <div v-if="todayForecast" class="text-white/50 text-[11px] mb-2">
      {{ todayForecast.qw2 }}° / {{ todayForecast.qw1 }}°
    </div>

    <div class="flex items-center gap-3 text-white/50 text-[11px]">
      <span class="flex items-center gap-1">
        <IconWaterPercent class="w-3.5 h-3.5" />
        {{ store.observe.sd }}%
      </span>
      <span class="flex items-center gap-1">
        <IconWeatherWindyVariant class="w-3.5 h-3.5" />
        {{ store.observe.fx }} {{ store.observe.fl }}
      </span>
    </div>

    <div class="text-white/30 text-[10px] mt-2">
      更新于 {{ formatTime(store.observe.lastUpdate) }}
    </div>
  </div>
</template>

<style scoped>
.glass-dark {
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
</style>
