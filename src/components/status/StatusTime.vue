<script setup lang="ts">
import { useTime } from '@/composables/useTime'

const { time } = useTime()
</script>

<template>
  <span class="status-time">{{ time }}</span>
</template>

<style scoped>
.status-time {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.08em;
  color: var(--color-ink);
  text-shadow: 0 0 14px color-mix(in srgb, var(--color-accent-strong) 34%, transparent);
}
</style>
