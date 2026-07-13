<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useWeatherStore } from '../store'
import { getWeatherIcon } from '../icons'
import { aqiTone } from '../ui'
import type { WeatherHourly } from '../types'
import { Sparkline } from '@/components/viz'
import IconWaterPercent from '~icons/mdi/water-percent'
import IconWeatherWindy from '~icons/mdi/weather-windy'
import IconWeatherSunsetUp from '~icons/mdi/weather-sunset-up'
import IconWeatherSunsetDown from '~icons/mdi/weather-sunset-down'

const store = useWeatherStore()

const icon = computed(() => {
  const ic = store.now?.icon
  return ic ? getWeatherIcon(ic) : null
})

const todayForecast = computed(() => store.daily[0] ?? null)
const aqi = computed(() => aqiTone(store.air))

/** 逐小时预报，每 2 小时取一个（首项即"现在"），最多 8 项 */
const hourlyEvery2h = computed(() =>
  (store.hourly ?? []).filter((_, i) => i % 2 === 0).slice(0, 8),
)

/** 逐小时温度序列（喂给 Sparkline 画趋势线，与上方逐小时条目对齐） */
const hourlyTemps = computed(() =>
  hourlyEvery2h.value.map((h) => Number(h.temp)).filter((n) => Number.isFinite(n)),
)

/** 和风时间为 ISO8601（如 2021-11-15T18:30+08:00），取 T 后的 HH:MM */
function formatTime(iso?: string) {
  const m = iso?.match(/T(\d{2}:\d{2})/)
  return m ? m[1] : ''
}

function hourLabel(h: WeatherHourly, idx: number): string {
  if (idx === 0) return '现在'
  return formatTime(h.fxTime)
}

// 挂载即预热空气与逐小时数据（按城市缓存，hover 多次只产生一次请求）
// 日出日落已随核心预报返回，无需单独拉取
onMounted(() => {
  store.ensureAir()
  store.ensureHourly()
})
</script>

<template>
  <div
    v-if="store.now"
    class="hud-panel absolute top-full mt-2 right-0 w-[268px] rounded-2xl px-4 py-3"
  >
    <div class="hud-corners" aria-hidden="true" />
    <!-- 头部：图标 + 温度 + 天气 + 城市 -->
    <div class="flex items-center gap-3 mb-2.5">
      <component v-if="icon" :is="icon" class="w-9 h-9 text-white/85 flex-shrink-0" />
      <div class="min-w-0">
        <div class="flex items-baseline gap-1.5">
          <span class="text-white text-2xl font-light tabular-nums leading-none">{{ store.now.temp }}°</span>
          <span class="text-white/55 text-[11px]">{{ store.now.text }}</span>
        </div>
        <div class="text-white/45 text-[11px] mt-1 truncate">{{ store.cityName }}</div>
      </div>
    </div>

    <!-- 低温/高温 · 湿度 · 风 -->
    <div class="flex items-center gap-3 text-white/55 text-[11px] mb-2">
      <span v-if="todayForecast" class="tabular-nums">{{ todayForecast.tempMin }}° / {{ todayForecast.tempMax }}°</span>
      <span class="flex items-center gap-1">
        <IconWaterPercent class="w-3.5 h-3.5" />{{ store.now.humidity }}%
      </span>
      <span class="flex items-center gap-1 truncate">
        <IconWeatherWindy class="w-3.5 h-3.5 flex-shrink-0" />{{ store.now.windDir }}{{ store.now.windScale }}级
      </span>
    </div>

    <!-- 逐小时温度趋势线（与下方逐小时条目对齐） -->
    <div v-if="hourlyTemps.length >= 2" class="px-1 mb-1">
      <Sparkline
        :data="hourlyTemps"
        :width="236"
        :height="30"
        tone="rgba(94, 234, 212, 0.9)"
        :fill="true"
        :dots="false"
      />
    </div>

    <!-- 逐小时预报（每 2 小时一项，横向可滚动） -->
    <div
      v-if="hourlyEvery2h.length"
      class="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 pt-2 mb-2 border-t border-white/10"
    >
      <div
        v-for="(h, idx) in hourlyEvery2h"
        :key="h.fxTime"
        class="flex-shrink-0 w-9 flex flex-col items-center gap-1 py-1 rounded-md"
        :class="idx === 0 ? 'bg-white/10' : ''"
      >
        <span class="text-[10px]" :class="idx === 0 ? 'text-white' : 'text-white/45'">{{ hourLabel(h, idx) }}</span>
        <component :is="getWeatherIcon(h.icon)" class="w-4 h-4 text-white/75" />
        <span class="text-[11px] text-white/85 tabular-nums">{{ h.temp }}°</span>
      </div>
    </div>

    <!-- AQI 胶囊 · 日出日落（日出日落由预报数据提供，几乎总有值；AQI 仅部分城市） -->
    <div
      v-if="store.air || store.sunTimes"
      class="flex items-center gap-2 flex-wrap mb-2 pt-2 border-t border-white/10"
    >
      <span
        v-if="store.air"
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] tabular-nums"
        :class="aqi.chip"
      >
        <span class="w-1.5 h-1.5 rounded-full" :class="aqi.dot" />
        AQI {{ store.air.aqi }} · {{ store.air.category }}
      </span>
      <div v-if="store.sunTimes" class="flex items-center gap-2 text-white/50 text-[10px] ml-auto">
        <span class="flex items-center gap-0.5">
          <IconWeatherSunsetUp class="w-3 h-3" />{{ store.sunTimes.sunRise }}
        </span>
        <span class="flex items-center gap-0.5">
          <IconWeatherSunsetDown class="w-3 h-3" />{{ store.sunTimes.sunSet }}
        </span>
      </div>
    </div>

    <div class="text-white/30 text-[10px]">
      更新于 {{ formatTime(store.now.obsTime) }}
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
