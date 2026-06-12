<script setup lang="ts">
import StatusTime from '@/components/status/StatusTime.vue'
import WeatherWidget from '@/components/weather/WeatherWidget.vue'
</script>

<template>
  <div class="fixed top-4 right-3 z-30 select-none flex items-center gap-3">
    <WeatherWidget />
    <StatusTime />
  </div>
</template>
