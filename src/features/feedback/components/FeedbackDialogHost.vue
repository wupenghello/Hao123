<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import type { FeedbackDialog } from '@/features/feedback'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCheck from '~icons/mdi/check-circle-outline'
import IconClose from '~icons/mdi/close'
import IconInfo from '~icons/mdi/information-outline'
import IconWarning from '~icons/mdi/alert-outline'

const props = defineProps<{ dialog: FeedbackDialog | null }>()
const emit = defineEmits<{
  (e: 'resolve', confirmed: boolean): void
}>()

const panel = ref<HTMLElement | null>(null)
let lastFocused: HTMLElement | null = null

function focusableElements(): HTMLElement[] {
  const root = panel.value
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
}

function focusPrimary(): void {
  nextTick(() => {
    const buttons = focusableElements()
    const primary = buttons.find((el) => el.dataset.primary === 'true') ?? buttons[0]
    primary?.focus()
  })
}

function resolve(confirmed: boolean): void {
  emit('resolve', confirmed)
}

function onKeydown(e: KeyboardEvent): void {
  if (!props.dialog) return
  if (e.key === 'Escape') {
    e.preventDefault()
    resolve(false)
    return
  }
  if (e.key !== 'Tab') return

  const items = focusableElements()
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(() => props.dialog, (dialog) => {
  if (dialog) {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    window.addEventListener('keydown', onKeydown)
    focusPrimary()
  } else {
    window.removeEventListener('keydown', onKeydown)
    nextTick(() => lastFocused?.focus?.())
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fb-dialog-fade">
      <div v-if="dialog" class="fb-dialog-shell" :class="`is-${dialog.tone}`" @click.self="resolve(false)">
        <div class="fb-dialog-backdrop" />
        <Transition name="fb-dialog-pop" appear>
          <section
            ref="panel"
            class="fb-dialog-panel"
            role="alertdialog"
            aria-modal="true"
            :aria-label="dialog.title"
          >
            <span class="fb-dialog-scan" aria-hidden="true" />
            <header class="fb-dialog-head">
              <span class="fb-dialog-icon" aria-hidden="true">
                <IconCheck v-if="dialog.tone === 'success'" />
                <IconWarning v-else-if="dialog.tone === 'warning'" />
                <IconAlert v-else-if="dialog.tone === 'danger'" />
                <IconInfo v-else />
              </span>
              <div class="fb-dialog-titlebox">
                <small>{{ dialog.mode === 'confirm' ? 'Action Confirmation' : 'System Message' }}</small>
                <h2>{{ dialog.title }}</h2>
              </div>
              <button type="button" class="fb-dialog-close" title="关闭" @click="resolve(false)">
                <IconClose />
              </button>
            </header>

            <div class="fb-dialog-body">
              <p>{{ dialog.message }}</p>
              <pre v-if="dialog.detail">{{ dialog.detail }}</pre>
            </div>

            <footer class="fb-dialog-actions">
              <button
                v-if="dialog.mode === 'confirm'"
                type="button"
                class="fb-dialog-btn ghost"
                @click="resolve(false)"
              >
                {{ dialog.cancelLabel }}
              </button>
              <button
                type="button"
                class="fb-dialog-btn primary"
                data-primary="true"
                @click="resolve(true)"
              >
                {{ dialog.confirmLabel }}
              </button>
            </footer>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fb-dialog-shell {
  --fb-tone: var(--hud-cyan);
  position: fixed;
  inset: 0;
  z-index: 160;
  display: grid;
  place-items: center;
  padding: 20px;
}
.fb-dialog-shell.is-success { --fb-tone: var(--hud-teal); }
.fb-dialog-shell.is-warning { --fb-tone: var(--hud-warn); }
.fb-dialog-shell.is-danger { --fb-tone: var(--hud-danger); }
.fb-dialog-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--fb-tone) 18%, transparent), transparent 34%),
    rgba(2, 6, 23, 0.7);
  backdrop-filter: blur(14px) saturate(130%);
  -webkit-backdrop-filter: blur(14px) saturate(130%);
}
.fb-dialog-panel {
  position: relative;
  z-index: 1;
  overflow: hidden;
  width: min(460px, calc(100vw - 32px));
  border: 1px solid color-mix(in srgb, var(--fb-tone) 38%, rgba(255, 255, 255, 0.09));
  border-radius: 8px;
  background:
    linear-gradient(150deg, color-mix(in srgb, var(--fb-tone) 12%, transparent), transparent 44%),
    linear-gradient(180deg, rgba(10, 20, 41, 0.98), rgba(4, 10, 24, 0.98));
  box-shadow:
    0 30px 90px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.04),
    0 0 48px color-mix(in srgb, var(--fb-tone) 18%, transparent);
  color: rgba(241, 245, 249, 0.94);
}
.fb-dialog-scan {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.14;
  background:
    linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: linear-gradient(180deg, black, transparent);
}
.fb-dialog-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.fb-dialog-icon {
  display: grid;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--fb-tone) 42%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--fb-tone) 10%, transparent);
  color: var(--fb-tone);
  box-shadow: inset 0 0 18px color-mix(in srgb, var(--fb-tone) 12%, transparent);
}
.fb-dialog-icon svg {
  width: 21px;
  height: 21px;
}
.fb-dialog-titlebox {
  min-width: 0;
  flex: 1;
}
.fb-dialog-titlebox small {
  display: block;
  margin-bottom: 3px;
  font-family: var(--hud-font-data);
  font-size: 10px;
  line-height: 1;
  color: color-mix(in srgb, var(--fb-tone) 76%, rgba(226, 232, 240, 0.55));
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.fb-dialog-titlebox h2 {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: 0;
}
.fb-dialog-close {
  display: grid;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgba(226, 232, 240, 0.52);
  cursor: pointer;
}
.fb-dialog-close svg {
  width: 16px;
  height: 16px;
}
.fb-dialog-close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.09);
}
.fb-dialog-body {
  position: relative;
  display: grid;
  gap: 12px;
  padding: 16px 18px 8px;
}
.fb-dialog-body p {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(226, 232, 240, 0.76);
}
.fb-dialog-body pre {
  max-height: 220px;
  margin: 0;
  overflow: auto;
  padding: 11px 12px;
  border: 1px solid rgba(125, 211, 252, 0.12);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.56);
  color: rgba(226, 232, 240, 0.72);
  font-family: var(--hud-font-data);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.fb-dialog-actions {
  position: relative;
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding: 14px 18px 18px;
}
.fb-dialog-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 86px;
  min-height: 34px;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
  transition: background-color 0.16s, border-color 0.16s, color 0.16s, transform 0.16s;
}
.fb-dialog-btn:hover {
  transform: translateY(-1px);
}
.fb-dialog-btn.ghost {
  border: 1px solid rgba(226, 232, 240, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(226, 232, 240, 0.66);
}
.fb-dialog-btn.ghost:hover {
  color: #fff;
  border-color: rgba(226, 232, 240, 0.28);
  background: rgba(255, 255, 255, 0.08);
}
.fb-dialog-btn.primary {
  border: 1px solid color-mix(in srgb, var(--fb-tone) 52%, transparent);
  background: color-mix(in srgb, var(--fb-tone) 18%, rgba(255, 255, 255, 0.04));
  color: color-mix(in srgb, var(--fb-tone) 86%, #fff);
  box-shadow: 0 0 22px color-mix(in srgb, var(--fb-tone) 16%, transparent);
}
.fb-dialog-btn.primary:hover {
  color: #fff;
  background: color-mix(in srgb, var(--fb-tone) 26%, rgba(255, 255, 255, 0.06));
}
.fb-dialog-fade-enter-active,
.fb-dialog-fade-leave-active {
  transition: opacity 0.18s ease;
}
.fb-dialog-fade-enter-from,
.fb-dialog-fade-leave-to {
  opacity: 0;
}
.fb-dialog-pop-enter-active,
.fb-dialog-pop-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.fb-dialog-pop-enter-from,
.fb-dialog-pop-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
@media (max-width: 640px) {
  .fb-dialog-shell {
    align-items: end;
    padding: 12px;
  }
  .fb-dialog-panel {
    width: 100%;
  }
  .fb-dialog-actions {
    flex-direction: column-reverse;
  }
  .fb-dialog-btn {
    width: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .fb-dialog-btn,
  .fb-dialog-fade-enter-active,
  .fb-dialog-fade-leave-active,
  .fb-dialog-pop-enter-active,
  .fb-dialog-pop-leave-active {
    transition: none;
  }
  .fb-dialog-btn:hover {
    transform: none;
  }
}
</style>
