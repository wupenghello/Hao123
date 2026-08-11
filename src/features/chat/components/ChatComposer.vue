<script setup lang="ts">
/** 输入栏：自增高 textarea + 图片粘贴/拖放（VL 模型门控）+ 发送/停止。 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useChatStore } from '../store'
import { useChatSettings } from '../settings'
import { validateImageAdd } from '../utils'
import { currentModelSupportsVision } from '../vision-models'
import IconSend from '~icons/mdi/send'
import IconStop from '~icons/mdi/stop-circle-outline'
import IconClose from '~icons/mdi/close'

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

/** 当前激活模型是否支持视觉：不支持时禁用图片入口并引导换 VL 模型，
 *  避免「发图必收模型错误红条」的必坏路径。 */
const visionCapable = computed(() => currentModelSupportsVision())
const hintLine = computed(() =>
  `${enterHint.value} · Shift+Enter 换行 · ${visionCapable.value ? 'Ctrl+V 贴图' : '当前模型不支持图片'} · Esc 收起`,
)

const canSend = computed(() => text.value.trim().length > 0 || images.value.length > 0)

/** 面板打开时聚焦输入框（用户召唤面板后可直接打字） */
onMounted(() => {
  const ta = taRef.value
  if (ta) {
    ta.focus()
    if (ta.setSelectionRange) ta.setSelectionRange(ta.value.length, ta.value.length)
  }
})

function autoGrow() {
  const ta = taRef.value
  if (!ta) return
  ta.style.height = 'auto'
  ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`
}
watch(text, () => nextTick(autoGrow))

// ── 图片：粘贴 / 拖放 / 选择 ──
function addFiles(files: FileList | File[]) {
  if (!visionCapable.value) {
    imageErr.value = '当前模型不支持识图，请先在模型设置中切换 VL 模型（如 qwen-vl-max / gpt-4o）'
    setTimeout(() => (imageErr.value = ''), 5000)
    return
  }
  const v = validateImageAdd(Array.from(files), {
    maxImages: settings.value.maxImages,
    maxImageSizeMB: settings.value.maxImageSizeMB,
    currentCount: images.value.length,
  })
  if (v.error) {
    imageErr.value = v.error
    setTimeout(() => (imageErr.value = ''), 4000)
    return
  }
  for (const f of v.accepted) {
    images.value.push({ url: URL.createObjectURL(f), file: f })
  }
  if (v.ignoredNonImages > 0) {
    imageErr.value = `已忽略 ${v.ignoredNonImages} 个非图片文件（仅支持图片）`
    setTimeout(() => (imageErr.value = ''), 3000)
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
  if (!img) return
  URL.revokeObjectURL(img.url)
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
    if (store.streaming) {
      // 生成中按 Enter：有内容 → 打断并直接发送新消息（一步到位）；空 → 仅停止
      if (text.value.trim() || images.value.length) {
        void store.stop().then(() => send())
      } else {
        void store.stop()
      }
    } else {
      send()
    }
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
      <span class="composer-hint">{{ hintLine }}</span>
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
.composer-ta {
  display: block;
  width: 100%;
  min-height: 44px;
  max-height: 132px;
  padding: 9px 11px;
  resize: none;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  /* 内嵌玻璃输入：半透明 + 顶部高光，聚焦时青辉光（对齐项目输入框配方） */
  background: color-mix(in srgb, var(--color-base) 62%, transparent);
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
  color: var(--color-ink);
  font: 400 13px/1.6 var(--font-sans, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
}
.composer-ta::placeholder {
  color: var(--color-ink-3);
}
.composer-ta:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 22%, transparent), 0 0 18px -6px color-mix(in srgb, var(--color-accent) 40%, transparent);
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
  border-radius: 6px;
  /* 对齐 .btn-primary：渐变 + 内高光 + 青辉光（唯一交互主色） */
  background: linear-gradient(180deg, var(--color-accent-strong), var(--color-accent));
  color: var(--color-accent-contrast);
  cursor: pointer;
  box-shadow: 0 4px 14px -4px color-mix(in srgb, var(--color-accent) 60%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  transition: background var(--duration-fast) var(--ease-out-quint), box-shadow var(--duration-fast) var(--ease-out-quint);
}
.composer-send:hover:not(:disabled) {
  background: linear-gradient(180deg, var(--color-accent-strong), var(--color-accent));
  box-shadow: 0 6px 18px -4px color-mix(in srgb, var(--color-accent) 75%, transparent), 0 0 14px -2px color-mix(in srgb, var(--color-accent) 55%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.4);
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
</style>
