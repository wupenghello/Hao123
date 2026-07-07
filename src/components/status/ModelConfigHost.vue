<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { onOpenModelConfig } from '@/features/chat/model-modal-bridge'
import ModelConfigModal from './ModelConfigModal.vue'

const configOpen = ref(false)
let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = onOpenModelConfig(() => {
    configOpen.value = true
  })
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<template>
  <ModelConfigModal v-model:open="configOpen" />
</template>
