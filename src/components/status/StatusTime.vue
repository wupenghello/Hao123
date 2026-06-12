<script setup lang="ts">
import { useTime } from '@/composables/useTime'

const { time } = useTime()
</script>

<template>
  <span class="text-white text-[13px] font-normal tracking-[-0.01em] leading-none">{{ time }}</span>
</template>
