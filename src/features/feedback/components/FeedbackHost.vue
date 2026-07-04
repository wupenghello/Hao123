<script setup lang="ts">
import { useFeedback } from '@/features/feedback'
import FeedbackDialogHost from './FeedbackDialogHost.vue'
import FeedbackToastStack from './FeedbackToastStack.vue'

const feedback = useFeedback()
</script>

<template>
  <FeedbackToastStack :toasts="feedback.toasts.value" @close="feedback.dismissToast" />
  <FeedbackDialogHost :dialog="feedback.activeDialog.value" @resolve="feedback.resolveDialog" />
</template>
