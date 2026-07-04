<script setup lang="ts">
/**
 * Compatibility wrapper.
 *
 * The actual model settings implementation lives in the self-contained
 * `features/model-config` module. Keep this file so older local imports do not
 * reach into a large status component again.
 */
import ModelConfigModal from '@/features/model-config/components/ModelConfigModal.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
</script>

<template>
  <ModelConfigModal :open="props.open" @update:open="emit('update:open', $event)" />
</template>
