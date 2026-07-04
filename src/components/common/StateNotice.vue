<script setup lang="ts">
/**
 * 通用状态提示框：用于列表 / 面板里的加载、错误、未配置、空态。
 * 视觉语言对齐 DetailModal 与 FeedbackToast 的 HUD 玻璃信息框。
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCheck from '~icons/mdi/check-circle-outline'
import IconInbox from '~icons/mdi/inbox-outline'
import IconInfo from '~icons/mdi/information-outline'
import IconLoading from '~icons/mdi/loading'

type StateNoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'empty' | 'loading'

const props = withDefaults(
  defineProps<{
    tone?: StateNoticeTone
    title: string
    message?: string
    details?: string[]
    actionLabel?: string
    compact?: boolean
    align?: 'left' | 'center'
    surface?: 'card' | 'inline' | 'center'
  }>(),
  {
    tone: 'info',
    message: '',
    details: () => [],
    actionLabel: '',
    compact: false,
    align: 'center',
    surface: 'card',
  },
)

const emit = defineEmits<{ action: [] }>()

const iconComponent = computed<Component>(() => {
  if (props.tone === 'loading') return IconLoading
  if (props.tone === 'success') return IconCheck
  if (props.tone === 'warning' || props.tone === 'danger') return IconAlert
  if (props.tone === 'empty') return IconInbox
  return IconInfo
})

const isLoading = computed(() => props.tone === 'loading')
</script>

<template>
  <article
    class="state-notice"
    :class="[`is-${tone}`, `align-${align}`, `surface-${surface}`, { 'is-compact': compact }]"
    :role="tone === 'danger' ? 'alert' : 'status'"
  >
    <div class="state-notice-corners" aria-hidden="true" />
    <span class="state-notice-icon" aria-hidden="true">
      <component :is="iconComponent" :class="{ 'state-notice-spin': isLoading }" />
    </span>

    <div class="state-notice-copy">
      <p class="state-notice-title">{{ title }}</p>
      <p v-if="message" class="state-notice-message">{{ message }}</p>
      <ul v-if="details.length" class="state-notice-details">
        <li v-for="detail in details" :key="detail">{{ detail }}</li>
      </ul>
    </div>

    <button
      v-if="actionLabel"
      type="button"
      class="state-notice-action"
      @click="emit('action')"
    >
      {{ actionLabel }}
    </button>
  </article>
</template>

<style scoped>
.state-notice {
  --state-tone: #22d3ee;
  position: relative;
  display: grid;
  width: min(560px, calc(100% - 32px));
  margin: 18px auto;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: 12px;
  overflow: hidden;
  padding: 15px 15px 15px 16px;
  border: 1px solid color-mix(in srgb, var(--state-tone) 34%, rgba(255, 255, 255, 0.08));
  border-radius: 10px;
  background:
    radial-gradient(circle at 0 0, color-mix(in srgb, var(--state-tone) 17%, transparent), transparent 34%),
    linear-gradient(135deg, color-mix(in srgb, var(--state-tone) 10%, transparent), transparent 48%),
    rgba(5, 12, 27, 0.62);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 18px 44px rgba(0, 0, 0, 0.22),
    0 0 28px color-mix(in srgb, var(--state-tone) 10%, transparent);
  color: rgba(241, 245, 249, 0.94);
  backdrop-filter: blur(16px) saturate(135%);
  -webkit-backdrop-filter: blur(16px) saturate(135%);
}
.state-notice::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--state-tone), transparent);
  box-shadow: 0 0 18px var(--state-tone);
}
.state-notice-corners {
  position: absolute;
  inset: 7px;
  pointer-events: none;
  border-radius: 8px;
  background:
    linear-gradient(var(--state-tone), var(--state-tone)) left top / 16px 1px no-repeat,
    linear-gradient(var(--state-tone), var(--state-tone)) left top / 1px 16px no-repeat,
    linear-gradient(var(--state-tone), var(--state-tone)) right bottom / 16px 1px no-repeat,
    linear-gradient(var(--state-tone), var(--state-tone)) right bottom / 1px 16px no-repeat;
  opacity: 0.28;
}
.state-notice.is-success { --state-tone: #34d399; }
.state-notice.is-warning { --state-tone: #fbbf24; }
.state-notice.is-danger { --state-tone: #fb7185; }
.state-notice.is-empty { --state-tone: #a78bfa; }
.state-notice.is-loading { --state-tone: #2dd4bf; }
.state-notice.is-compact {
  width: min(480px, calc(100% - 24px));
  margin-block: 14px;
  padding: 13px 14px;
}
.state-notice.surface-inline {
  width: auto;
  margin: 0;
  padding: 10px 16px 10px 15px;
  border: 0;
  border-radius: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.055);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--state-tone) 13%, transparent), transparent 54%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent);
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.state-notice.surface-inline::before {
  display: block;
  inset: 9px auto 9px 0;
  width: 2px;
  background: linear-gradient(180deg, transparent, var(--state-tone), transparent);
  opacity: 0.9;
}
.state-notice.surface-inline .state-notice-corners {
  display: none;
}
.state-notice.surface-inline.is-compact {
  width: auto;
  margin-block: 0;
  padding: 10px 16px 10px 15px;
}
.state-notice.surface-inline .state-notice-icon {
  position: relative;
  width: 25px;
  height: 25px;
  border-radius: 8px;
  background:
    radial-gradient(circle at 50% 0, rgba(255, 255, 255, 0.14), transparent 58%),
    color-mix(in srgb, var(--state-tone) 10%, transparent);
  box-shadow: inset 0 0 14px color-mix(in srgb, var(--state-tone) 9%, transparent);
}
.state-notice.surface-inline .state-notice-icon::after {
  position: absolute;
  inset: -4px;
  border-radius: 11px;
  content: '';
  background: radial-gradient(circle, color-mix(in srgb, var(--state-tone) 24%, transparent), transparent 62%);
  opacity: 0.55;
  z-index: -1;
}
.state-notice.surface-inline.is-loading .state-notice-icon::after {
  animation: state-notice-pulse 1.5s ease-in-out infinite;
}
.state-notice.surface-inline .state-notice-icon svg {
  width: 15px;
  height: 15px;
}
.state-notice.surface-inline .state-notice-copy {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 9px;
  padding-top: 2px;
}
.state-notice.surface-inline .state-notice-title {
  font-size: 12.5px;
  font-weight: 780;
}
.state-notice.surface-inline .state-notice-message {
  margin: 0;
  color: rgba(226, 232, 240, 0.56);
}
.state-notice.surface-inline .state-notice-title + .state-notice-message::before {
  display: inline-block;
  width: 3px;
  height: 3px;
  margin: 0 8px 2px 0;
  border-radius: 999px;
  content: '';
  background: color-mix(in srgb, var(--state-tone) 68%, transparent);
}
.state-notice.surface-inline .state-notice-action {
  height: 27px;
  margin-top: -1px;
  border-color: color-mix(in srgb, var(--state-tone) 34%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--state-tone) 13%, transparent), transparent),
    rgba(255, 255, 255, 0.028);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.055);
}
.state-notice.surface-center {
  z-index: 1;
  display: flex;
  width: 100%;
  min-height: clamp(320px, 56vh, 560px);
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin: 0;
  padding: 40px 24px;
  border: 0;
  border-radius: 0;
  background:
    radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--state-tone) 14%, transparent), transparent 20%),
    radial-gradient(ellipse at 50% 60%, rgba(15, 23, 42, 0.42), transparent 54%);
  box-shadow: none;
  text-align: center;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.state-notice.surface-center::before {
  inset: 50% auto auto 50%;
  width: min(520px, 72%);
  height: 1px;
  content: '';
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--state-tone) 58%, transparent), transparent);
  box-shadow: 0 0 26px color-mix(in srgb, var(--state-tone) 28%, transparent);
  opacity: 0.75;
  transform: translate(-50%, -50%);
}
.state-notice.surface-center::after {
  position: absolute;
  inset: 18% 18% 14%;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, transparent 0 17%, color-mix(in srgb, var(--state-tone) 13%, transparent) 17.2%, transparent 17.6% 82%, color-mix(in srgb, var(--state-tone) 10%, transparent) 82.2%, transparent 82.7%),
    linear-gradient(180deg, transparent 0 28%, rgba(255, 255, 255, 0.045) 28.2%, transparent 28.7% 72%, rgba(255, 255, 255, 0.035) 72.2%, transparent 72.7%);
  mask-image: radial-gradient(ellipse at center, black, transparent 70%);
  opacity: 0.46;
}
.state-notice.surface-center .state-notice-corners {
  display: none;
}
.state-notice.surface-center .state-notice-icon {
  position: relative;
  z-index: 2;
  width: 128px;
  height: 128px;
  border: 0;
  border-radius: 34px;
  background:
    radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--state-tone) 26%, transparent), transparent 43%),
    radial-gradient(ellipse at 50% 90%, rgba(255, 255, 255, 0.12), transparent 36%);
  box-shadow:
    0 0 70px color-mix(in srgb, var(--state-tone) 28%, transparent),
    0 22px 80px rgba(0, 0, 0, 0.24);
  animation: state-notice-icon-float 3.6s ease-in-out infinite;
}
.state-notice.surface-center .state-notice-icon::before,
.state-notice.surface-center .state-notice-icon::after {
  position: absolute;
  content: '';
  pointer-events: none;
}
.state-notice.surface-center .state-notice-icon::before {
  display: none;
}
.state-notice.surface-center .state-notice-icon::after {
  inset: -34px;
  border-radius: 50%;
  background:
    radial-gradient(circle, color-mix(in srgb, var(--state-tone) 18%, transparent), transparent 58%);
  opacity: 0.72;
  z-index: -1;
  animation: state-notice-breathe 2.4s ease-in-out infinite;
}
.state-notice.surface-center .state-notice-icon svg {
  width: 82px;
  height: 82px;
  filter:
    drop-shadow(0 0 10px color-mix(in srgb, var(--state-tone) 70%, transparent))
    drop-shadow(0 0 28px color-mix(in srgb, var(--state-tone) 30%, transparent));
}
.state-notice.surface-center .state-notice-copy {
  display: grid;
  position: relative;
  z-index: 2;
  justify-items: center;
  max-width: 520px;
  gap: 7px;
}
.state-notice.surface-center .state-notice-title {
  color: rgba(248, 250, 252, 0.96);
  font-size: 16px;
  font-weight: 860;
  letter-spacing: 0;
}
.state-notice.surface-center .state-notice-message {
  margin: 0;
  max-width: 460px;
  color: rgba(226, 232, 240, 0.62);
  font-size: 12.5px;
}
.state-notice.surface-center .state-notice-action {
  position: relative;
  z-index: 2;
  margin-top: 4px;
  height: 32px;
  padding: 0 16px;
  border-color: color-mix(in srgb, var(--state-tone) 42%, transparent);
  background:
    radial-gradient(circle at 50% 0, rgba(255, 255, 255, 0.14), transparent 44%),
    color-mix(in srgb, var(--state-tone) 12%, rgba(255, 255, 255, 0.035));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.09),
    0 0 24px color-mix(in srgb, var(--state-tone) 14%, transparent);
}
.state-notice.align-center {
  text-align: left;
}
.state-notice.align-left {
  width: 100%;
  margin-inline: 0;
}
.state-notice-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--state-tone) 36%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--state-tone) 11%, transparent);
  color: color-mix(in srgb, var(--state-tone) 88%, white);
  box-shadow: inset 0 0 16px color-mix(in srgb, var(--state-tone) 10%, transparent);
}
.state-notice-icon svg {
  width: 18px;
  height: 18px;
}
.state-notice-copy {
  min-width: 0;
}
.state-notice-title {
  margin: 0;
  color: rgba(248, 250, 252, 0.94);
  font-size: 13px;
  font-weight: 820;
  line-height: 1.35;
}
.state-notice-message {
  margin: 4px 0 0;
  color: rgba(226, 232, 240, 0.66);
  font-size: 12px;
  line-height: 1.55;
}
.state-notice-details {
  display: grid;
  gap: 4px;
  margin: 9px 0 0;
  padding: 0;
  color: rgba(226, 232, 240, 0.52);
  font-size: 11.5px;
  line-height: 1.5;
  list-style: none;
}
.state-notice-details li {
  position: relative;
  padding-left: 11px;
}
.state-notice-details li::before {
  position: absolute;
  top: 0.68em;
  left: 0;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  content: '';
  background: color-mix(in srgb, var(--state-tone) 68%, transparent);
}
.state-notice-action {
  position: relative;
  z-index: 1;
  height: 28px;
  flex-shrink: 0;
  padding: 0 11px;
  border: 1px solid color-mix(in srgb, var(--state-tone) 40%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--state-tone) 12%, rgba(255, 255, 255, 0.04));
  color: color-mix(in srgb, var(--state-tone) 86%, white);
  font-size: 12px;
  font-weight: 760;
  cursor: pointer;
  transition: transform 0.15s, background 0.15s, border-color 0.15s, color 0.15s;
}
.state-notice-action:hover,
.state-notice-action:focus-visible {
  border-color: color-mix(in srgb, var(--state-tone) 56%, transparent);
  background: color-mix(in srgb, var(--state-tone) 18%, rgba(255, 255, 255, 0.06));
  color: #fff;
  outline: 0;
  transform: translateY(-1px);
}
.state-notice-spin {
  animation: state-notice-spin 0.9s linear infinite;
}
@keyframes state-notice-spin {
  to { transform: rotate(360deg); }
}
@keyframes state-notice-pulse {
  0%, 100% { opacity: 0.28; transform: scale(0.92); }
  50% { opacity: 0.72; transform: scale(1.08); }
}
@keyframes state-notice-breathe {
  0%, 100% { opacity: 0.38; transform: scale(0.94); }
  50% { opacity: 0.72; transform: scale(1.04); }
}
@keyframes state-notice-icon-float {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-5px) scale(1.025); }
}
@media (max-width: 640px) {
  .state-notice {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .state-notice.surface-inline {
    padding-right: 12px;
  }
  .state-notice.surface-inline .state-notice-copy {
    display: block;
  }
  .state-notice.surface-inline .state-notice-message {
    margin-top: 2px;
  }
  .state-notice.surface-inline .state-notice-title + .state-notice-message::before {
    display: none;
  }
  .state-notice.surface-center {
    min-height: 340px;
    padding: 34px 18px;
  }
  .state-notice.surface-center .state-notice-icon {
    width: 112px;
    height: 112px;
    border-radius: 26px;
  }
  .state-notice.surface-center .state-notice-icon svg {
    width: 72px;
    height: 72px;
  }
  .state-notice-action {
    grid-column: 2;
    justify-self: start;
  }
  .state-notice.surface-center .state-notice-action {
    grid-column: auto;
    justify-self: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .state-notice-spin {
    animation: none;
  }
  .state-notice-action {
    transition: none;
  }
  .state-notice.surface-inline.is-loading .state-notice-icon::after {
    animation: none;
  }
  .state-notice.surface-center .state-notice-icon::before,
  .state-notice.surface-center .state-notice-icon::after,
  .state-notice.surface-center .state-notice-icon {
    animation: none;
  }
}
</style>
