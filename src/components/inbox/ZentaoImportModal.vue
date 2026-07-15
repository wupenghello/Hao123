<script setup lang="ts">
/**
 * 一键导入禅道任务 / Bug —— 悬浮输入台
 *
 * 按用户要求：一个大气、简约、有未来感的悬浮输入框。输入区不放任何 icon / placeholder，
 * 只有一条大号输入线；套用项目统一的 HUD 玻璃基座（见 style.css 的 .hud-panel 说明），
 * 层级设在全仓库已知最高值（FeedbackDialogHost 160）之上，确保盖住底层的新建弹窗。
 *
 * 职责边界：本组件负责「解析链接 → 走禅道会话取详情 → 映射为本地待办输入」，
 * 成功后通过 imported 事件把 { input, source } 交回页面级，由新建表单预填后交用户确认，
 * 不直接写 store（把「导入」并入「新建」流程，符合把入口收进新建弹窗的诉求）。
 */
import { nextTick, ref, watch } from 'vue'
import { useZentaoSession, taskApi, bugApi } from '@/features/zentao'
import type { LocalTaskInput, LocalTaskSource } from '@/features/local-tasks'
import { parseZentaoLink, zentaoTaskToLocalInput, zentaoBugToLocalInput } from './zentao-import'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  imported: [payload: { input: LocalTaskInput; source: LocalTaskSource }]
}>()

const session = useZentaoSession()

const url = ref('')
const loading = ref(false)
const errorMsg = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    url.value = ''
    errorMsg.value = ''
    loading.value = false
    await nextTick()
    inputRef.value?.focus()
  },
)

function close() {
  if (loading.value) return
  emit('update:open', false)
}

async function doImport() {
  if (loading.value) return
  errorMsg.value = ''
  const raw = url.value.trim()
  if (!raw) return
  const parsed = parseZentaoLink(raw)
  if (!parsed) {
    errorMsg.value = '看起来不是禅道任务 / Bug 链接'
    return
  }
  loading.value = true
  try {
    const source: LocalTaskSource = { kind: parsed.kind, id: parsed.id, url: raw }
    if (parsed.kind === 'task') {
      const task = await session.withSession((sid) => taskApi.taskDetail(sid, parsed.id))
      emit('imported', { input: zentaoTaskToLocalInput(task, raw), source })
    } else {
      const bug = await session.withSession((sid) => bugApi.bugDetail(sid, parsed.id))
      emit('imported', { input: zentaoBugToLocalInput(bug, raw), source })
    }
    emit('update:open', false)
  } catch (e) {
    errorMsg.value = session.toMessage(e, '导入失败，请检查链接或网络')
  } finally {
    loading.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    doImport()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150 ease-out"
      leave-active-class="transition-opacity duration-100 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="zim-shell">
        <div class="zim-backdrop" @click="close" />

        <Transition
          appear
          enter-active-class="transition-all duration-200 ease-out"
          leave-active-class="transition-all duration-120 ease-in"
          enter-from-class="opacity-0 -translate-y-3 scale-[0.97]"
          leave-to-class="opacity-0 -translate-y-1 scale-[0.98]"
        >
          <div
            class="zim-panel hud-panel hud-sheen relative rounded-[22px]"
            role="dialog"
            aria-modal="true"
            aria-label="导入禅道任务或 Bug 到本地待办"
            @click.stop
          >
            <div class="hud-accent-bar hud-accent-bar--cyan rounded-t-[22px]" :class="{ 'is-loading': loading }" />
            <div class="hud-corners" aria-hidden="true" />

            <div class="zim-body">
              <p class="zim-eyebrow">导入禅道</p>
              <input
                ref="inputRef"
                v-model="url"
                type="text"
                class="zim-input"
                :disabled="loading"
                spellcheck="false"
                autocomplete="off"
                @keydown="onKeydown"
              >
              <div class="zim-line" :class="{ 'is-loading': loading }" />
              <p class="zim-hint" :class="{ 'is-error': errorMsg }">
                {{ errorMsg || (loading ? '正在读取禅道详情…' : '粘贴禅道任务或 Bug 链接，回车导入') }}
              </p>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.zim-shell {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 0 20px;
  padding-top: 20vh;
}
.zim-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 18%, rgba(56, 189, 248, 0.12), transparent 42%),
    rgba(2, 6, 23, 0.74);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
}
.zim-panel {
  position: relative;
  z-index: 1;
  width: min(680px, 94vw);
  overflow: hidden;
}
.zim-body {
  position: relative;
  z-index: 1;
  padding: 34px 36px 26px;
}
.zim-eyebrow {
  margin: 0 0 16px;
  color: rgba(94, 234, 212, 0.82);
  font: 850 11px/1 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  letter-spacing: 0.24em;
  text-transform: uppercase;
}
.zim-input {
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  outline: none;
  color: rgba(248, 250, 252, 0.96);
  font-size: 26px;
  font-weight: 500;
  letter-spacing: 0.005em;
  line-height: 1.3;
}
.zim-input:disabled {
  opacity: 0.55;
}
.zim-line {
  margin-top: 14px;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(94, 234, 212, 0.7), rgba(56, 189, 248, 0.5), transparent);
  opacity: 0.75;
}
.zim-line.is-loading {
  background-size: 220% 100%;
  animation: zim-scan 1.1s linear infinite;
}
@keyframes zim-scan {
  from { background-position: 120% 0; }
  to { background-position: -80% 0; }
}
.zim-hint {
  margin: 14px 0 0;
  color: rgba(226, 232, 240, 0.42);
  font-size: 13px;
  letter-spacing: 0.01em;
}
.zim-hint.is-error {
  color: rgba(252, 165, 165, 0.94);
}
.hud-accent-bar.is-loading {
  animation-duration: 1.1s;
}
@media (prefers-reduced-motion: reduce) {
  .zim-line.is-loading { animation: none; }
}
</style>
