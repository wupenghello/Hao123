<script setup lang="ts">
import type { FeedbackToast } from '@/features/feedback'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCheck from '~icons/mdi/check-circle-outline'
import IconClose from '~icons/mdi/close'
import IconInfo from '~icons/mdi/information-outline'
import IconWarning from '~icons/mdi/alert-outline'

defineProps<{ toasts: FeedbackToast[] }>()
const emit = defineEmits<{
  (e: 'close', id: number): void
}>()

function runAction(toast: FeedbackToast): void {
  toast.action?.run()
  emit('close', toast.id)
}
</script>

<template>
  <Teleport to="body">
    <div class="fb-toast-stack" aria-live="polite">
      <TransitionGroup name="fb-toast">
        <article
          v-for="toast in toasts"
          :key="toast.id"
          class="fb-toast"
          :class="`is-${toast.tone}`"
          role="status"
        >
          <span class="fb-toast-orbit" aria-hidden="true">
            <IconCheck v-if="toast.tone === 'success'" />
            <IconWarning v-else-if="toast.tone === 'warning'" />
            <IconAlert v-else-if="toast.tone === 'danger'" />
            <IconInfo v-else />
          </span>

          <span class="fb-toast-body">
            <strong>{{ toast.title }}</strong>
            <small v-if="toast.message">{{ toast.message }}</small>
          </span>

          <button
            v-if="toast.action"
            type="button"
            class="fb-toast-action"
            @click="runAction(toast)"
          >
            {{ toast.action.label }}
          </button>
          <button type="button" class="fb-toast-close" title="关闭" @click="emit('close', toast.id)">
            <IconClose />
          </button>
        </article>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.fb-toast-stack {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 140;
  display: flex;
  width: min(360px, calc(100vw - 32px));
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}
.fb-toast {
  --fb-tone: var(--hud-cyan);
  pointer-events: auto;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 11px;
  overflow: hidden;
  min-height: 64px;
  padding: 13px 12px 13px 14px;
  border: 1px solid color-mix(in srgb, var(--fb-tone) 36%, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--fb-tone) 13%, transparent), transparent 42%),
    rgba(5, 12, 27, 0.9);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.42),
    0 0 0 1px rgba(255, 255, 255, 0.04),
    0 0 34px color-mix(in srgb, var(--fb-tone) 18%, transparent);
  color: rgba(241, 245, 249, 0.94);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
}
.fb-toast::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: var(--fb-tone);
  box-shadow: 0 0 18px var(--fb-tone);
}
.fb-toast.is-success { --fb-tone: var(--hud-teal); }
.fb-toast.is-warning { --fb-tone: var(--hud-warn); }
.fb-toast.is-danger { --fb-tone: var(--hud-danger); }
.fb-toast-orbit {
  display: grid;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--fb-tone) 36%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--fb-tone) 10%, transparent);
  color: var(--fb-tone);
  box-shadow: inset 0 0 16px color-mix(in srgb, var(--fb-tone) 10%, transparent);
}
.fb-toast-orbit svg {
  width: 17px;
  height: 17px;
}
.fb-toast-body {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 4px;
}
.fb-toast-body strong {
  overflow-wrap: anywhere;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.32;
}
.fb-toast-body small {
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(226, 232, 240, 0.68);
}
.fb-toast-action {
  flex: 0 0 auto;
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, var(--fb-tone) 42%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--fb-tone) 10%, transparent);
  color: color-mix(in srgb, var(--fb-tone) 88%, #fff);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.fb-toast-close {
  display: inline-grid;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(226, 232, 240, 0.48);
  cursor: pointer;
}
.fb-toast-close svg {
  width: 14px;
  height: 14px;
}
.fb-toast-action:hover,
.fb-toast-close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.fb-toast-enter-active,
.fb-toast-leave-active,
.fb-toast-move {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.fb-toast-enter-from,
.fb-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
.fb-toast-leave-active {
  position: absolute;
  right: 0;
  left: 0;
}
@media (max-width: 640px) {
  .fb-toast-stack {
    right: 12px;
    bottom: 12px;
    width: calc(100vw - 24px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .fb-toast-enter-active,
  .fb-toast-leave-active,
  .fb-toast-move {
    transition: none;
  }
}
</style>
