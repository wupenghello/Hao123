<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import WeatherWidget from '@/components/weather/WeatherWidget.vue'

const time = ref('')

let timer: ReturnType<typeof setInterval>

function updateTime() {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  time.value = `周${weekday}  ${month}月${day}日  ${hh}:${mm}`
}

onMounted(() => {
  updateTime()
  timer = setInterval(updateTime, 1000)
})

onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="fixed top-2 right-3 z-30 select-none flex items-center gap-3">
    <WeatherWidget />
    <span class="text-white text-[13px] font-normal tracking-[-0.01em] leading-none">{{ time }}</span>
  </div>
</template>
