<script setup lang="ts">
import StatusTime from '@/components/status/StatusTime.vue'
import WeatherWidget from '@/components/weather/WeatherWidget.vue'
</script>

<template>
  <div class="fixed top-2 right-2 sm:top-4 sm:right-3 z-30 select-none flex items-center gap-2 sm:gap-3">
    <WeatherWidget />
    <StatusTime />
  </div>
</template>
