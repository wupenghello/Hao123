<script setup lang="ts">
import { useTime } from '@/composables/useTime'

const { time } = useTime()
</script>

<template>
  <span class="status-time">{{ time }}</span>
</template>

<style scoped>
.status-time {
  font-family: var(--hud-font-data);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.08em;
  color: rgba(224, 242, 254, 0.92);
  text-shadow: 0 0 14px rgba(125, 211, 252, 0.34);
}
</style>
