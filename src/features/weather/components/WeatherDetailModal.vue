<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useWeatherStore } from '../store'
import { getWeatherIcon } from '../icons'
import { aqiTone, alarmTone, getIndexIcon } from '../ui'
import CitySelector from './CitySelector.vue'
import type { CityItem } from '../city-data'
import type { WeatherDaily, WeatherHourly } from '../types'
import IconCrosshairsGps from '~icons/mdi/crosshairs-gps'
import IconRefresh from '~icons/mdi/refresh'
import IconClose from '~icons/mdi/close'
import IconAlert from '~icons/mdi/alert'
import IconAlertCircleOutline from '~icons/mdi/alert-circle-outline'
import IconChevronDown from '~icons/mdi/chevron-down'
import IconAirFilter from '~icons/mdi/air-filter'
import IconWeatherSunsetUp from '~icons/mdi/weather-sunset-up'
import IconWeatherSunsetDown from '~icons/mdi/weather-sunset-down'
import IconEyeOutline from '~icons/mdi/eye-outline'
import IconGauge from '~icons/mdi/gauge'
import IconWeatherPouring from '~icons/mdi/weather-pouring'
import IconWeatherWindy from '~icons/mdi/weather-windy'

const store = useWeatherStore()

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const cityPanelOpen = ref(false)
const showAllIndices = ref(false)

const currentIcon = computed(() => {
  const ic = store.now?.icon
  return ic ? getWeatherIcon(ic) : null
})

const forecastDays = computed(() => store.daily.slice(0, 7))
const hourlyList = computed(() => store.hourly?.slice(0, 12) ?? [])
const indexList = computed(() => store.indices ?? [])
const warningList = computed(() => store.warnings ?? [])
const aqi = computed(() => aqiTone(store.air))
const todayForecast = computed(() => store.daily[0] ?? null)

/**
 * 生活指数精选：穿衣 / 紫外线 / 洗车 / 感冒 / 运动 / 舒适度
 * （工作台用户高频且在 indexIconMap 内有专属图标），其余折叠在「展开更多」，
 * 避免一次铺 16 项造成信息过载 + 撑高弹窗。
 */
const PRIMARY_INDEX_TYPES = new Set(['3', '5', '2', '9', '1', '8'])
const primaryIndices = computed(() => indexList.value.filter((ix) => PRIMARY_INDEX_TYPES.has(ix.type)))
const visibleIndices = computed(() => (showAllIndices.value ? indexList.value : primaryIndices.value))
const hasMoreIndices = computed(() => indexList.value.length > primaryIndices.value.length)

/** 本周气温范围，用于把每日温度条映射到统一刻度 */
const tempRange = computed(() => {
  const days = forecastDays.value
  if (!days.length) return { min: 0, max: 1 }
  let min = Infinity
  let max = -Infinity
  for (const d of days) {
    const lo = Number(d.tempMin)
    const hi = Number(d.tempMax)
    if (!isNaN(lo)) min = Math.min(min, lo)
    if (!isNaN(hi)) max = Math.max(max, hi)
  }
  if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 }
  if (max - min < 1) max = min + 1
  return { min, max }
})

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function barStyle(day: WeatherDaily) {
  const { min, max } = tempRange.value
  const span = max - min
  const lo = Number(day.tempMin)
  const hi = Number(day.tempMax)
  const left = ((lo - min) / span) * 100
  const width = ((hi - lo) / span) * 100
  return {
    marginLeft: `${clamp(left, 0, 92)}%`,
    width: `${clamp(width, 8, 100 - clamp(left, 0, 92))}%`,
  }
}

function getWeekday(dateStr: string): string {
  // fxDate 形如 '2026-06-25'，new Date('YYYY-MM-DD') 会被当作 UTC 午夜解析，
  // 与本地 now 的 toDateString() 比较时在 UTC 负偏移时区会漂移一天——故手动按本地解析
  const d = parseLocalDate(dateStr)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return '今天'
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return '明天'
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}

function isToday(dateStr: string): boolean {
  return parseLocalDate(dateStr).toDateString() === new Date().toDateString()
}

/** 把 'YYYY-MM-DD' 解析为本地午夜的 Date，避免 UTC 解析导致的跨时区日期漂移 */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** 逐小时标签：首项显示"现在"，其余取 ISO8601 时间里的 HH:MM */
function hourLabel(h: WeatherHourly, idx: number): string {
  if (idx === 0) return '现在'
  const m = h.fxTime?.match(/T(\d{2}:\d{2})/)
  return m ? m[1] : ''
}

/** 预报天气文案：白天夜间不同则显示"转"，相同则合并 */
function dayWeather(day: WeatherDaily): string {
  return day.textDay === day.textNight ? day.textDay : `${day.textDay} 转 ${day.textNight}`
}

/** 和风时间为 ISO8601（如 2021-11-15T18:30+08:00），取 T 后的 HH:MM */
function formatTime(iso?: string): string {
  const m = iso?.match(/T(\d{2}:\d{2})/)
  return m ? m[1] : ''
}

function onSelectCity(city: CityItem) {
  store.setCity(city.lat, city.lng, city.name)
  cityPanelOpen.value = false
}

/** 刷新：核心数据 + 已加载的按需数据（force） */
function refresh() {
  store.fetchWeather()
  if (store.air) store.ensureAir(true)
  if (store.hourly) store.ensureHourly(true)
  if (store.indices) store.ensureIndices(true)
  if (store.warnings) store.ensureWarnings(true)
}

// 弹窗打开：锁定滚动 + Esc 分级关闭（先关城市面板，再关弹窗）+ 懒加载富数据
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (cityPanelOpen.value) cityPanelOpen.value = false
  else emit('close')
}

function lockScroll() {
  document.body.style.overflow = 'hidden'
  window.addEventListener('keydown', onKeydown)
}

function unlockScroll() {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKeydown)
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      lockScroll()
      store.ensureAir()
      store.ensureHourly()
      store.ensureIndices()
      store.ensureWarnings()
    } else {
      unlockScroll()
      cityPanelOpen.value = false
      showAllIndices.value = false
    }
  },
)

onUnmounted(unlockScroll)
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
        <div class="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" @click="emit('close')" />

        <Transition
          appear
          enter-active-class="transition-all duration-250 ease-out"
          leave-active-class="transition-all duration-200 ease-in"
          enter-from-class="opacity-0 scale-97"
          leave-to-class="opacity-0 scale-97"
        >
          <!-- 桌面端放宽到 880px 并启用双栏主体；移动端仍 92vw/560px 单栏 -->
          <div
            class="hud-panel hud-sheen relative z-10 w-[92vw] max-w-[560px] md:max-w-[880px] max-h-[90vh] md:max-h-[88vh] flex flex-col rounded-[20px] will-change-transform"
            @click.stop
          >
            <div class="hud-accent-bar hud-accent-bar--cyan" aria-hidden="true" />
            <div class="hud-corners" aria-hidden="true" />

            <!-- 头部：城市名（点击切换城市）+ 刷新 / 关闭 -->
            <div class="px-6 pt-5 pb-3 flex items-center justify-between gap-3 flex-shrink-0">
              <button
                class="flex items-center gap-2 min-w-0 rounded-lg hover:bg-white/5 -mx-1.5 px-1.5 py-1 transition-colors"
                @click="cityPanelOpen = !cityPanelOpen"
              >
                <IconCrosshairsGps class="w-4 h-4 text-teal-300/70 flex-shrink-0" :class="{ 'animate-pulse': store.locating }" />
                <span class="text-white text-base font-medium truncate">{{ store.cityName }}</span>
                <IconChevronDown
                  class="w-4 h-4 text-white/50 flex-shrink-0 transition-transform duration-200"
                  :class="{ 'rotate-180': cityPanelOpen }"
                />
              </button>
              <div class="flex items-center gap-1 flex-shrink-0">
                <button
                  class="text-white/50 hover:text-white/80 p-1.5 transition-colors"
                  :class="{ 'opacity-50 pointer-events-none': store.loading }"
                  title="刷新"
                  @click="refresh"
                >
                  <IconRefresh class="w-4.5 h-4.5" :class="{ 'animate-spin': store.loading }" />
                </button>
                <button class="text-white/50 hover:text-white/80 p-1.5 transition-colors" title="关闭" @click="emit('close')">
                  <IconClose class="w-5 h-5" />
                </button>
              </div>
            </div>

            <!-- 切换城市面板（折叠，紧贴头部，无需滚到底部即可换城市） -->
            <Transition
              enter-active-class="transition-all duration-200 ease-out"
              leave-active-class="transition-all duration-150 ease-in"
              enter-from-class="opacity-0 max-h-0"
              enter-to-class="opacity-100 max-h-[420px]"
              leave-from-class="opacity-100 max-h-[420px]"
              leave-to-class="opacity-0 max-h-0"
            >
              <div v-if="cityPanelOpen" class="overflow-hidden px-6 pb-4 flex-shrink-0">
                <button
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-xl mb-3 transition-colors"
                  :class="store.locateMode === 'auto'
                    ? 'bg-blue-500/15 text-blue-300/80'
                    : 'bg-white/6 text-white/55 hover:bg-white/10 hover:text-white/75'"
                  @click="store.autoLocate()"
                >
                  <IconCrosshairsGps class="w-4 h-4 flex-shrink-0" :class="{ 'animate-pulse': store.locating }" />
                  <span class="text-[12px]">自动定位到当前位置</span>
                </button>
                <CitySelector :current-city="store.cityName" @select="onSelectCity" />
              </div>
            </Transition>

            <!-- 错误占位 -->
            <div v-if="!store.now && store.error" class="px-6 pb-6 flex-shrink-0 text-center">
              <IconAlertCircleOutline class="w-8 h-8 text-amber-300/60 mx-auto mb-2" />
              <p class="text-white/65 text-[12px] mb-3 leading-relaxed">{{ store.error }}</p>
              <button
                class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/16 text-white/80 text-[12px] transition-colors"
                @click="store.fetchWeather()"
              >
                <IconRefresh class="w-3.5 h-3.5" :class="{ 'animate-spin': store.loading }" />
                重试
              </button>
            </div>

            <!-- 可滚动主体 -->
            <div v-if="store.now" class="overflow-y-auto min-h-0 px-6 pb-5 space-y-5">
              <!-- Hero：当前天气（加大图标 + 体感温度 + 今日高低温） -->
              <div class="flex items-center gap-5">
                <component v-if="currentIcon" :is="currentIcon" class="w-[72px] h-[72px] text-white/90 flex-shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline gap-3">
                    <span class="text-white text-[44px] leading-none font-extralight tabular-nums">{{ store.now.temp }}°</span>
                    <div class="flex flex-col leading-tight">
                      <span class="text-white/75 text-sm">{{ store.now.text }}</span>
                      <span class="text-white/55 text-[11px] mt-0.5">体感 {{ store.now.feelsLike }}°</span>
                    </div>
                    <div v-if="todayForecast" class="ml-auto text-right flex flex-col leading-tight">
                      <span class="text-white/90 text-base tabular-nums">{{ todayForecast.tempMax }}°</span>
                      <span class="text-white/55 text-[13px] tabular-nums">{{ todayForecast.tempMin }}°</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 mt-2.5">
                    <span class="flex-1 min-w-0 truncate text-white/55 text-[11px]">
                      {{ store.now.windDir }} {{ store.now.windScale }}级 · 湿度 {{ store.now.humidity }}% · 更新 {{ formatTime(store.now.obsTime) }}
                    </span>
                    <span
                      v-if="store.air"
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] tabular-nums flex-shrink-0"
                      :class="aqi.chip"
                    >
                      <span class="w-1.5 h-1.5 rounded-full" :class="aqi.dot" />
                      AQI {{ store.air.aqi }} · {{ store.air.category }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- 预警（紧贴 Hero，最高优先级信息） -->
              <div v-if="warningList.length" class="space-y-2">
                <div
                  v-for="(al, i) in warningList"
                  :key="al.id || i"
                  class="rounded-xl px-3 py-2 flex items-start gap-2"
                  :class="alarmTone(al.level).chip"
                >
                  <IconAlert class="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div class="min-w-0">
                    <div class="text-[12px] font-medium">
                      {{ al.typeName }}<span class="opacity-70"> · {{ al.level }}</span>
                    </div>
                    <div class="text-[11px] opacity-80 leading-snug mt-0.5">{{ al.text }}</div>
                  </div>
                </div>
              </div>

              <!-- 逐小时预报（桌面宽度内铺平 12 项；移动端横向滑动，右侧渐隐提示有更多） -->
              <section v-if="hourlyList.length" class="relative">
                <h3 class="text-white/55 text-[11px] mb-2 font-medium">逐小时预报</h3>
                <div class="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
                  <div
                    v-for="(h, idx) in hourlyList"
                    :key="h.fxTime"
                    class="flex-shrink-0 w-11 flex flex-col items-center gap-1.5 py-2 rounded-lg transition-colors"
                    :class="idx === 0 ? 'bg-white/10' : 'hover:bg-white/5'"
                  >
                    <span class="text-[11px]" :class="idx === 0 ? 'text-white' : 'text-white/55'">{{ hourLabel(h, idx) }}</span>
                    <component :is="getWeatherIcon(h.icon)" class="w-[18px] h-[18px] text-white/80" />
                    <span class="text-[12px] text-white/90 tabular-nums">{{ h.temp }}°</span>
                  </div>
                </div>
                <div
                  class="pointer-events-none absolute right-0 top-7 bottom-0 w-8 bg-gradient-to-l from-slate-950/80 to-transparent md:hidden"
                  aria-hidden="true"
                />
              </section>

              <!-- 主体双栏：左 7 天预报 / 右 实况细节 + 生活指数 -->
              <div class="md:grid md:grid-cols-2 md:gap-x-8 md:items-start">
                <!-- 左栏：7 天预报 -->
                <section v-if="forecastDays.length" class="min-w-0">
                  <h3 class="text-white/55 text-[11px] mb-1 font-medium">7 天预报</h3>
                  <div
                    v-for="(day, idx) in forecastDays"
                    :key="day.fxDate"
                    class="flex items-center gap-3 py-2"
                    :class="{ 'border-b border-white/6': idx < forecastDays.length - 1 }"
                  >
                    <span
                      class="text-[12px] w-9 flex-shrink-0"
                      :class="isToday(day.fxDate) ? 'text-white font-medium' : 'text-white/55'"
                    >
                      {{ getWeekday(day.fxDate) }}
                    </span>
                    <component :is="getWeatherIcon(day.iconDay)" class="w-5 h-5 text-white/75 flex-shrink-0" />
                    <span class="text-white/65 text-[12px] flex-1 min-w-0 truncate">{{ dayWeather(day) }}</span>
                    <span class="text-white/55 text-[12px] w-7 text-right tabular-nums">{{ day.tempMin }}°</span>
                    <div class="w-24 h-1 rounded-full bg-white/10 relative overflow-hidden flex-shrink-0">
                      <div
                        class="absolute top-0 left-0 h-full rounded-full"
                        :style="[barStyle(day), { background: 'linear-gradient(to right, rgba(96,165,250,0.6), rgba(251,146,60,0.6))' }]"
                      />
                    </div>
                    <span class="text-white text-[12px] w-7 tabular-nums">{{ day.tempMax }}°</span>
                  </div>
                </section>

                <!-- 右栏：实况细节 + 生活指数 -->
                <div class="mt-5 md:mt-0 space-y-5 min-w-0">
                  <!-- 实况细节：自适应 2 列，air 不可用时不留空格 -->
                  <section>
                    <h3 class="text-white/55 text-[11px] mb-2 font-medium">实况细节</h3>
                    <div class="grid grid-cols-2 gap-2">
                      <div class="bg-white/6 rounded-xl px-3 py-2 flex items-center gap-2.5">
                        <IconEyeOutline class="w-4 h-4 text-teal-300/70 flex-shrink-0" />
                        <div class="min-w-0">
                          <div class="text-white text-[13px] tabular-nums leading-tight">
                            {{ store.now.vis }}<span class="text-white/55 text-[11px] ml-0.5">km</span>
                          </div>
                          <div class="text-white/55 text-[11px] leading-tight">能见度</div>
                        </div>
                      </div>
                      <div class="bg-white/6 rounded-xl px-3 py-2 flex items-center gap-2.5">
                        <IconGauge class="w-4 h-4 text-teal-300/70 flex-shrink-0" />
                        <div class="min-w-0">
                          <div class="text-white text-[13px] tabular-nums leading-tight">
                            {{ store.now.pressure }}<span class="text-white/55 text-[11px] ml-0.5">hPa</span>
                          </div>
                          <div class="text-white/55 text-[11px] leading-tight">气压</div>
                        </div>
                      </div>
                      <div class="bg-white/6 rounded-xl px-3 py-2 flex items-center gap-2.5">
                        <IconWeatherPouring class="w-4 h-4 text-teal-300/70 flex-shrink-0" />
                        <div class="min-w-0">
                          <div class="text-white text-[13px] tabular-nums leading-tight">
                            {{ store.now.precip }}<span class="text-white/55 text-[11px] ml-0.5">mm</span>
                          </div>
                          <div class="text-white/55 text-[11px] leading-tight">降水量</div>
                        </div>
                      </div>
                      <div class="bg-white/6 rounded-xl px-3 py-2 flex items-center gap-2.5">
                        <IconWeatherWindy class="w-4 h-4 text-teal-300/70 flex-shrink-0" />
                        <div class="min-w-0">
                          <div class="text-white text-[13px] tabular-nums leading-tight">
                            {{ store.now.windSpeed }}<span class="text-white/55 text-[11px] ml-0.5">km/h</span>
                          </div>
                          <div class="text-white/55 text-[11px] leading-tight">风速</div>
                        </div>
                      </div>
                      <div v-if="store.sunTimes" class="bg-white/6 rounded-xl px-3 py-2 flex items-center gap-2.5">
                        <IconWeatherSunsetUp class="w-4 h-4 text-amber-300/70 flex-shrink-0" />
                        <div class="min-w-0">
                          <div class="text-white text-[13px] tabular-nums leading-tight">{{ store.sunTimes.sunRise }}</div>
                          <div class="text-white/55 text-[11px] leading-tight">日出</div>
                        </div>
                      </div>
                      <div v-if="store.sunTimes" class="bg-white/6 rounded-xl px-3 py-2 flex items-center gap-2.5">
                        <IconWeatherSunsetDown class="w-4 h-4 text-orange-300/70 flex-shrink-0" />
                        <div class="min-w-0">
                          <div class="text-white text-[13px] tabular-nums leading-tight">{{ store.sunTimes.sunSet }}</div>
                          <div class="text-white/55 text-[11px] leading-tight">日落</div>
                        </div>
                      </div>
                      <div v-if="store.air" class="bg-white/6 rounded-xl px-3 py-2 flex items-center gap-2.5">
                        <IconAirFilter class="w-4 h-4 text-teal-300/70 flex-shrink-0" />
                        <div class="min-w-0">
                          <div class="text-white text-[13px] tabular-nums leading-tight">
                            {{ store.air.pm2p5 }}<span class="text-white/55 text-[11px] ml-0.5">μg/m³</span>
                          </div>
                          <div class="text-white/55 text-[11px] leading-tight">PM2.5</div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <!-- 生活指数：精选 6 项，可展开更多 -->
                  <section v-if="indexList.length">
                    <h3 class="text-white/55 text-[11px] mb-2 font-medium">生活指数</h3>
                    <div class="grid grid-cols-2 gap-2">
                      <div
                        v-for="ix in visibleIndices"
                        :key="ix.type"
                        :title="ix.text"
                        class="bg-white/6 rounded-xl px-3 py-2 flex items-center gap-2.5"
                      >
                        <component :is="getIndexIcon(ix.type)" class="w-4 h-4 text-white/65 flex-shrink-0" />
                        <div class="min-w-0">
                          <div class="text-white/60 text-[11px] leading-tight truncate">{{ ix.name }}</div>
                          <div class="text-white/90 text-[12px] leading-tight mt-0.5 truncate">{{ ix.category }}</div>
                        </div>
                      </div>
                    </div>
                    <button
                      v-if="hasMoreIndices"
                      class="mt-2 w-full text-center text-white/55 hover:text-white/80 text-[11px] py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      @click="showAllIndices = !showAllIndices"
                    >
                      {{ showAllIndices ? '收起' : `展开更多（共 ${indexList.length} 项）` }}
                    </button>
                  </section>
                </div>
              </div>

              <!-- 数据权限说明：空气质量/灾害预警 在部分账户或地区不可用（生活指数不受影响） -->
              <p
                v-if="store.regionalUnsupported"
                class="text-white/55 text-[11px] text-center leading-relaxed"
              >
                空气质量与灾害预警暂不可用（受账户权限或地区限制）
              </p>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
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
