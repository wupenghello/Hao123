<script setup lang="ts">
import { ref, computed } from 'vue'
import { useWeatherStore } from '@/stores/weather'
import { getWeatherIcon } from '@/utils/weather-icons'
import CitySelector from '@/components/weather/CitySelector.vue'
import type { CityItem } from '@/utils/city-data'
import IconCrosshairsGps from '~icons/mdi/crosshairs-gps'
import IconRefresh from '~icons/mdi/refresh'
import IconClose from '~icons/mdi/close'
import IconWaterPercent from '~icons/mdi/water-percent'
import IconWeatherWindyVariant from '~icons/mdi/weather-windy-variant'

const store = useWeatherStore()

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const activeTab = ref<'forecast' | 'city'>('forecast')

const currentIcon = computed(() => {
  const numtq = store.observe?.numtq
  return numtq ? getWeatherIcon(numtq) : null
})

const forecastDays = computed(() => store.forecast.slice(0, 7))

const forecastLabel = computed(() => {
  const n = forecastDays.value.length
  return n > 0 ? `${n}日预报` : '天气预报'
})

function getWeekday(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return '今天'
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return '明天'
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}

function isToday(dateStr: string): boolean {
  return new Date(dateStr).toDateString() === new Date().toDateString()
}

function onSelectCity(city: CityItem) {
  store.setCity(city.lat, city.lng, city.name)
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      leave-active-class="transition-opacity duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="props.show" class="fixed inset-0 z-40 flex items-center justify-center">
        <!-- 遮罩 -->
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="emit('close')" />

        <Transition
          appear
          enter-active-class="transition-all duration-250 ease-out"
          leave-active-class="transition-all duration-200 ease-in"
          enter-from-class="opacity-0 scale-97"
          leave-to-class="opacity-0 scale-97"
        >
          <div
            class="relative z-10 w-[92vw] max-w-[420px] max-h-[90vh] sm:max-h-[85vh] flex flex-col rounded-3xl glass-dark
                   shadow-2xl shadow-black/20 will-change-transform"
            @click.stop
          >
            <!-- 头部 -->
            <div class="px-6 pt-5 pb-4 flex items-start justify-between flex-shrink-0">
              <div>
                <h2 class="text-white text-lg font-medium mb-1">天气详情</h2>
                <p class="text-white/40 text-[12px]">查看完整天气预报</p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="text-white/40 hover:text-white/70 p-1 transition-colors"
                  :class="{ 'opacity-50 pointer-events-none': store.loading }"
                  @click="store.fetchWeather()"
                >
                  <IconRefresh class="w-4.5 h-4.5" :class="{ 'animate-spin': store.loading }" />
                </button>
                <button
                  class="text-white/40 hover:text-white/70 p-1 transition-colors"
                  @click="emit('close')"
                >
                  <IconClose class="w-5 h-5" />
                </button>
              </div>
            </div>

            <!-- 当前天气 -->
            <div v-if="store.observe" class="px-6 pb-4 flex-shrink-0">
              <div class="flex items-center gap-4">
                <component v-if="currentIcon" :is="currentIcon" class="w-14 h-14 text-white/90 flex-shrink-0" />
                <div class="flex-1">
                  <div class="flex items-baseline gap-2">
                    <span class="text-white text-4xl font-light tabular-nums">{{ store.observe.qw }}°</span>
                    <span class="text-white/60 text-sm">{{ store.observe.tq }}</span>
                  </div>
                  <div class="text-white/50 text-[12px] mt-0.5">{{ store.observe.cityName }}</div>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-3 mt-4">
                <div class="bg-white/8 rounded-xl px-3 py-2.5 text-center">
                  <IconWaterPercent class="w-4 h-4 text-blue-300/60 mx-auto mb-1" />
                  <div class="text-white text-[13px] tabular-nums">{{ store.observe.sd }}%</div>
                  <div class="text-white/40 text-[10px] mt-0.5">湿度</div>
                </div>
                <div class="bg-white/8 rounded-xl px-3 py-2.5 text-center">
                  <IconWeatherWindyVariant class="w-4 h-4 text-teal-300/60 mx-auto mb-1" />
                  <div class="text-white text-[13px]">{{ store.observe.fl }}</div>
                  <div class="text-white/40 text-[10px] mt-0.5">{{ store.observe.fx }}</div>
                </div>
                <div class="bg-white/8 rounded-xl px-3 py-2.5 text-center" v-if="forecastDays[0]">
                  <component :is="getWeatherIcon(forecastDays[0].numtq1)" class="w-4 h-4 text-orange-300/60 mx-auto mb-1" />
                  <div class="text-white text-[13px] tabular-nums">
                    {{ forecastDays[0].qw2 }}°/{{ forecastDays[0].qw1 }}°
                  </div>
                  <div class="text-white/40 text-[10px] mt-0.5">今日温度</div>
                </div>
              </div>
            </div>

            <!-- Tab 栏 -->
            <div class="px-6 flex gap-1 border-b border-white/8 flex-shrink-0">
              <button
                class="px-3 py-2 text-[12px] transition-colors relative"
                :class="activeTab === 'forecast' ? 'text-white' : 'text-white/40 hover:text-white/60'"
                @click="activeTab = 'forecast'"
              >
                {{ forecastLabel }}
                <div v-if="activeTab === 'forecast'" class="absolute bottom-0 left-3 right-3 h-[2px] bg-white/60 rounded-full" />
              </button>
              <button
                class="px-3 py-2 text-[12px] transition-colors relative"
                :class="activeTab === 'city' ? 'text-white' : 'text-white/40 hover:text-white/60'"
                @click="activeTab = 'city'"
              >
                切换城市
                <div v-if="activeTab === 'city'" class="absolute bottom-0 left-3 right-3 h-[2px] bg-white/60 rounded-full" />
              </button>
            </div>

            <!-- Tab 内容 -->
            <div class="px-6 py-4 flex-1 overflow-y-auto min-h-0">
              <!-- 天气预报 -->
              <div v-if="activeTab === 'forecast'">
                <div
                  v-for="(day, idx) in forecastDays"
                  :key="day.date"
                  class="flex items-center gap-3 py-2.5"
                  :class="{ 'border-b border-white/6': idx < forecastDays.length - 1 }"
                >
                  <span
                    class="text-[12px] w-10 flex-shrink-0"
                    :class="isToday(day.date) ? 'text-white font-medium' : 'text-white/50'"
                  >
                    {{ getWeekday(day.date) }}
                  </span>
                  <component :is="getWeatherIcon(day.numtq1)" class="w-5 h-5 text-white/70 flex-shrink-0" />
                  <span class="text-white/60 text-[12px] flex-1">{{ day.tq1 }}</span>
                  <span class="text-white/40 text-[12px] w-6 text-right tabular-nums">{{ day.qw2 }}°</span>
                  <div class="w-16 h-1 rounded-full bg-white/10 relative overflow-hidden">
                    <div
                      class="absolute top-0 left-0 h-full rounded-full"
                      :style="{
                        width: `${Math.max(20, ((Number(day.qw1) - Number(day.qw2)) / 30) * 100)}%`,
                        marginLeft: `${Math.max(0, ((Number(day.qw2) + 10) / 50) * 100)}%`,
                        background: 'linear-gradient(to right, rgba(96,165,250,0.6), rgba(251,146,60,0.6))',
                      }"
                    />
                  </div>
                  <span class="text-white text-[12px] w-6 tabular-nums">{{ day.qw1 }}°</span>
                </div>
              </div>

              <!-- 城市选择 -->
              <div v-if="activeTab === 'city'">
                <!-- 自动定位 -->
                <button
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-xl mb-3 transition-colors"
                  :class="store.locateMode === 'auto'
                    ? 'bg-blue-500/15 text-blue-300/80'
                    : 'bg-white/6 text-white/50 hover:bg-white/10 hover:text-white/70'"
                  @click="store.autoLocate()"
                >
                  <IconCrosshairsGps class="w-4 h-4" :class="{ 'animate-pulse': store.locating }" />
                  <span class="text-[12px]">自动定位到当前位置</span>
                </button>

                <!-- 城市选择器组件 -->
                <CitySelector :current-city="store.cityName" @select="onSelectCity" />
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.glass-dark {
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  contain: layout paint;
}
</style>
