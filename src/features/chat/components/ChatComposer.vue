<script setup lang="ts">
/** 输入栏：自增高 textarea + 图片粘贴/拖放 + 回合状态条（阶段/进度/实时耗时 + 停止↔继续）。 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useChatStore } from '../store'
import { useChatSettings } from '../settings'
import IconSend from '~icons/mdi/send'
import IconStop from '~icons/mdi/stop-circle-outline'
import IconClose from '~icons/mdi/close'
import IconPlay from '~icons/mdi/play'

const store = useChatStore()
const { settings } = useChatSettings()

const text = ref('')
const images = ref<{ url: string; file: File }[]>([])
const taRef = ref<HTMLTextAreaElement | null>(null)
const imageErr = ref('')

const isMac = computed(() =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent),
)
const enterHint = computed(() => (isMac.value ? '⏎ 发送' : 'Enter 发送'))

const canSend = computed(() => text.value.trim().length > 0 || images.value.length > 0)

// ── 回合状态条 ──
/** 实时耗时（1s 间隔更新；不依赖 rAF，避免无头渲染/后台标签页不触发） */
const elapsedSec = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
function tick() {
  if (!store.turnStart) { elapsedSec.value = 0; return }
  elapsedSec.value = Math.floor((Date.now() - store.turnStart) / 1000)
}
function startTimer() {
  stopTimer()
  tick()
  timer = setInterval(tick, 1000)
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
}
watch(() => store.streaming, (s) => (s ? startTimer() : (stopTimer(), tick())))
onBeforeUnmount(stopTimer)

/** 当前正在执行的工具 label（从 messages 派生：最新一条 running 活动） */
const runningActLabel = computed(() => {
  if (!store.streaming) return null
  const acts = store.messages.flatMap((m) => m.activities ?? [])
  for (let i = acts.length - 1; i >= 0; i--) {
    if (acts[i].status === 'running') return acts[i].label
  }
  return null
})

/** 状态条主文案：阶段 + 进度 + 耗时 */
const genText = computed(() => {
  const phase = store.turnPhase
  const sec = elapsedSec.value
  const timeStr = sec < 1 ? '' : ` · ${sec}s`
  switch (phase) {
    case 'thinking':
      return `思考中${timeStr}`
    case 'working': {
      const total = Math.max(1, store.turnActTotal)
      const done = Math.min(store.turnActDone, total)
      const act = runningActLabel.value ? ` · ${runningActLabel.value}` : ''
      return `正在执行 ${done}/${total} 个动作${act}${timeStr}`
    }
    case 'composing':
      return `正在组织回答 · 第 ${store.turnRound} 轮${timeStr}`
    case 'aborted':
      return '已停止 · 保留已生成的部分'
    default:
      return null
  }
})

/** 停止后显示「继续生成」（从半成品处续跑，不重复提问） */
const showResume = computed(() => store.turnPhase === 'aborted')

function onResume() {
  void store.resumeAfterStop()
}

function autoGrow() {
  const ta = taRef.value
  if (!ta) return
  ta.style.height = 'auto'
  ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`
}
watch(text, () => nextTick(autoGrow))

// ── 图片：粘贴 / 拖放 / 选择 ──
function addFiles(files: FileList | File[]) {
  const list = Array.from(files)
  const imgs = list.filter((f) => f.type.startsWith('image/'))
  if (!imgs.length) return
  const limit = settings.value.maxImages
  if (images.value.length + imgs.length > limit) {
    imageErr.value = `最多同时上传 ${limit} 张图片`
    setTimeout(() => (imageErr.value = ''), 3000)
    return
  }
  for (const f of imgs) {
    images.value.push({ url: URL.createObjectURL(f), file: f })
  }
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length) {
    e.preventDefault()
    addFiles(files)
  }
}

function onDrop(e: DragEvent) {
  if (!e.dataTransfer?.files?.length) return
  e.preventDefault()
  addFiles(e.dataTransfer.files)
}

function removeImage(i: number) {
  const img = images.value[i]
  if (img) URL.revokeObjectURL(img.url)
  images.value.splice(i, 1)
}

/** File → dataURL（消息内图片需要稳定 URL 供气泡回显，不能用会被 revoke 的 ObjectURL） */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function send() {
  const content = text.value.trim()
  if (!content && !images.value.length) return
  const dataUrls = await Promise.all(images.value.map((img) => fileToDataUrl(img.file)))
  void store.send(content, dataUrls)
  // 清理预览 ObjectURL（消息气泡用的是 dataURL，不受影响）
  for (const img of images.value) URL.revokeObjectURL(img.url)
  images.value = []
  text.value = ''
  autoGrow()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    if (store.streaming) store.stop()
    else send()
  }
}
</script>

<template>
  <div class="composer">
    <div v-if="images.length" class="composer-imgs">
      <div v-for="(img, i) in images" :key="i" class="composer-img">
        <img :src="img.url" alt="待发送图片" />
        <button type="button" class="composer-img-remove" title="移除" @click="removeImage(i)">
          <IconClose class="w-3 h-3" />
        </button>
      </div>
    </div>
    <p v-if="imageErr" class="composer-err">{{ imageErr }}</p>

    <div v-if="genText" class="composer-gen" :class="{ 'is-stopped': store.turnPhase === 'aborted' }">
      <span class="composer-gen-dot" aria-hidden="true" />
      <span class="composer-gen-text">{{ genText }}</span>
      <button
        v-if="showResume"
        type="button"
        class="composer-gen-resume"
        title="从已生成的部分继续"
        @click="onResume"
      >
        <IconPlay class="w-3 h-3" />
        <span>继续生成</span>
      </button>
    </div>

    <textarea
      ref="taRef"
      v-model="text"
      class="composer-ta"
      rows="2"
      :placeholder="store.configured ? '发消息给小吴…' : '先配置模型线路，才能对话'"
      @keydown="onKeydown"
      @paste="onPaste"
      @drop="onDrop"
      @dragover.prevent
    />

    <div class="composer-foot">
      <span class="composer-hint">
        {{ enterHint }} · Shift+Enter 换行 · Ctrl+V 贴图 · Alt+K 收起
      </span>
      <button
        v-if="store.streaming"
        type="button"
        class="composer-send is-stop"
        title="停止生成"
        @click="store.stop()"
      >
        <IconStop class="w-4 h-4" />
      </button>
      <button
        v-else
        type="button"
        class="composer-send"
        :disabled="!canSend"
        title="发送"
        @click="send"
      >
        <IconSend class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  flex: 0 0 auto;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--color-line);
}
.composer-imgs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.composer-img {
  position: relative;
  width: 56px;
  height: 38px;
  border: 1px solid var(--color-line);
  border-radius: 4px;
  overflow: hidden;
}
.composer-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.composer-img-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.6);
  color: var(--color-ink);
  cursor: pointer;
}
.composer-err {
  margin: 0 0 8px;
  color: var(--color-danger);
  font-size: 11px;
}
.composer-gen {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  min-height: 24px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 26%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-accent) 7%, transparent);
}
.composer-gen.is-stopped {
  border-color: color-mix(in srgb, var(--color-ink-4) 40%, transparent);
  background: var(--color-base);
}
.composer-gen.is-stopped .composer-gen-dot {
  background: var(--color-ink-4);
  animation: none;
}
.composer-gen-resume {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  height: 20px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
  border-radius: 3px;
  background: transparent;
  color: var(--color-accent-strong);
  font-size: 10.5px;
  cursor: pointer;
}
.composer-gen-resume:hover {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}
.composer-gen-dot {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: var(--color-accent);
  animation: gen-pulse 1.2s ease-in-out infinite;
}
@keyframes gen-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
.composer-gen-text {
  font: 400 10.5px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.04em;
  color: var(--color-ink-2);
}
.composer-ta {
  display: block;
  width: 100%;
  min-height: 44px;
  max-height: 132px;
  padding: 9px 11px;
  resize: none;
  border: 1px solid var(--color-line);
  border-radius: 4px;
  background: var(--color-raised);
  color: var(--color-ink);
  font: 400 13px/1.6 var(--font-sans, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
}
.composer-ta::placeholder {
  color: var(--color-ink-3);
}
.composer-ta:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 22%, transparent);
}
.composer-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.composer-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 400 10.5px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.composer-send {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border: none;
  border-radius: 4px;
  background: var(--color-accent);
  color: var(--color-accent-contrast);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out-quint);
}
.composer-send:hover:not(:disabled) {
  background: var(--color-accent-strong);
}
.composer-send:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.composer-send.is-stop {
  background: transparent;
  border: 1px solid var(--color-line);
  color: var(--color-danger);
}
.composer-send.is-stop:hover {
  border-color: color-mix(in srgb, var(--color-danger) 55%, transparent);
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .composer-gen-dot {
    animation: none;
    opacity: 0.8;
  }
}
</style>
