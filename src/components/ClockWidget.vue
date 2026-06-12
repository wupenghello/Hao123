<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const time = ref('')
const date = ref('')

let timer: ReturnType<typeof setInterval>

function updateTime() {
  const now = new Date()
  time.value = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  date.value = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
}

onMounted(() => {
  updateTime()
  timer = setInterval(updateTime, 1000)
})

onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="text-white/70">
    <p class="text-2xl font-light tracking-widest">{{ time }}</p>
    <p class="text-sm mt-1 opacity-70">{{ date }}</p>
  </div>
</template>
