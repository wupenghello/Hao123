<script setup lang="ts">
/**
 * 本地任务新建 / 编辑表单弹窗（支持图片与文件附件）
 *
 * 受控组件：父级用 v-model:open 控制显隐，传入 task（编辑）或 null（新建），
 * submit 事件回吐表单值 + 待新增文件 + 待移除附件 id，由父级编排 store 写入
 * （附件 Blob 走 IndexedDB，由 store.addAttachment / removeAttachment 统一处理，
 * 取消时不落盘，避免产生孤立 Blob）。标题必填；Esc 关闭、Enter（标题框）提交。
 *
 * 附件生命周期（本组件只持有 File 与 object URL，不碰 IDB）：
 *   - 新选文件 → pending（File + 本地预览 URL），提交时交给 store 写 IDB
 *   - 已有附件 → 直接渲染；点 × 进 removedIds，提交时交给 store 删 IDB
 *   - 关闭/重开 → revoke 所有本地预览 URL，重置三个列表
 */
import { ref, watch, nextTick } from 'vue'
import type { LocalTask, LocalTaskPri, LocalTaskInput, LocalTaskSource, LocalTaskFormPayload } from '../types'
import { getAttachmentBlob } from '../attachments'
import { isImageMime, formatFileSize, MAX_ATTACHMENT_SIZE } from '../util'
import IconClose from '~icons/mdi/close'
import IconCloseCircle from '~icons/mdi/close-circle'
import IconUpload from '~icons/mdi/cloud-upload-outline'
import IconFile from '~icons/mdi/file-document-outline'
import IconDownload from '~icons/mdi/download'
import IconClipboardCheck from '~icons/mdi/clipboard-check-outline'
import IconLinkVariant from '~icons/mdi/link-variant'

const props = defineProps<{
  /** 是否打开 */
  open: boolean
  /** 编辑目标；null = 新建 */
  task: LocalTask | null
  /**
   * 一键导入禅道后的预填载荷（页面级把 ZentaoImportModal 的结果传进来）。
   * 仅新建态生效：非空且 open 时把字段灌入表单，交用户确认后再提交。
   */
  prefill?: { input: LocalTaskInput; source?: LocalTaskSource } | null
}>()

/** 提交载荷：表单字段 + 新增文件 + 待移除附件 id（类型见 types.ts，供面板与弹窗共用） */

const emit = defineEmits<{
  'update:open': [value: boolean]
  submit: [payload: LocalTaskFormPayload]
  /** 请求打开「导入禅道」输入台（由页面级承接，弹出层级更高的 ZentaoImportModal） */
  'request-import': []
}>()

/** 当前任务的导入来源（新建可由禅道导入预填；编辑时沿用原值），随提交回吐 */
const source = ref<LocalTaskSource | undefined>(undefined)

const title = ref('')
const note = ref('')
const pri = ref<LocalTaskPri>(3)
const deadline = ref('')
const titleRef = ref<HTMLInputElement | null>(null)

// ============ 附件状态 ============
/** 新选的文件（尚未写 IDB）：tempId 用于 v-for key，url 为本地预览 */
interface PendingFile {
  tempId: string
  file: File
  url: string
  isImage: boolean
}
const pending = ref<PendingFile[]>([])
/** 编辑态下被标记移除的已有附件 id */
const removedIds = ref<string[]>([])
/** 已有「图片」附件的预览 URL（attId → objectURL；从 IDB 读 Blob 生成） */
const existingImageUrls = ref<Record<string, string>>({})
/** 本组件持有的所有 object URL，关闭/重开时统一 revoke，避免内存泄漏 */
let ownedUrls: string[] = []
function trackUrl(url: string): string {
  ownedUrls.push(url)
  return url
}
function revokeAllUrls() {
  for (const u of ownedUrls) URL.revokeObjectURL(u)
  ownedUrls = []
  existingImageUrls.value = {}
}
/** 超限文件提示（拖入过大文件时短暂显示） */
const sizeError = ref('')
let sizeErrorTimer: ReturnType<typeof setTimeout> | null = null
function flashSizeError() {
  sizeError.value = `单个附件不能超过 ${Math.round(MAX_ATTACHMENT_SIZE / 1024 / 1024)}MB`
  if (sizeErrorTimer) clearTimeout(sizeErrorTimer)
  sizeErrorTimer = setTimeout(() => (sizeError.value = ''), 3000)
}

// ============ 大图预览（点缩略图展开）============
const previewUrl = ref<string | null>(null)

// ============ 打开时按 task 预填（新建给默认值）============
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    // 重置：先回收上一轮的预览 URL，再清空三个列表
    revokeAllUrls()
    pending.value = []
    removedIds.value = []

    if (props.task) {
      title.value = props.task.title
      note.value = props.task.note ?? ''
      pri.value = props.task.pri
      deadline.value = props.task.deadline ?? ''
      source.value = props.task.source
      // 已有图片附件：从 IDB 读 Blob 生成预览（非图片走文件图标，无需 URL）
      for (const att of props.task.attachments ?? []) {
        if (!att.isImage) continue
        const blob = await getAttachmentBlob(att.id)
        if (blob) existingImageUrls.value[att.id] = trackUrl(URL.createObjectURL(blob))
      }
    } else if (props.prefill) {
      // 新建 · 由禅道导入预填：灌入字段 + 记住来源，交用户确认后再提交
      title.value = props.prefill.input.title
      note.value = props.prefill.input.note ?? ''
      pri.value = props.prefill.input.pri
      deadline.value = props.prefill.input.deadline ?? ''
      source.value = props.prefill.source
    } else {
      title.value = ''
      note.value = ''
      pri.value = 3
      deadline.value = ''
      source.value = undefined
    }
    await nextTick()
    titleRef.value?.focus()
  },
  { immediate: true },
)

// 导入结果晚于表单打开到达（先开表单 → 用户去导入台粘贴 → 回填）：
// prefill 变化且表单开着、非编辑态时把字段灌进来。
watch(
  () => props.prefill,
  (pf) => {
    if (!pf || !props.open || props.task) return
    title.value = pf.input.title
    note.value = pf.input.note ?? ''
    pri.value = pf.input.pri
    deadline.value = pf.input.deadline ?? ''
    source.value = pf.source
    nextTick(() => titleRef.value?.focus())
  },
)

// ============ 文件选择（点击 / 拖放）============
const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)

function pickFiles() {
  fileInput.value?.click()
}
function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) addFiles(Array.from(input.files))
  // 清空 value，使「选了同一文件」第二次也能触发 change
  input.value = ''
}
function onDrop(e: DragEvent) {
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files) addFiles(Array.from(files))
}
/**
 * 粘贴加入附件：监听整个弹窗的 paste 事件，若剪贴板含文件/图片（如截图）就接管并加入。
 * 纯文本粘贴（标题/备注输入框）不拦截，照常插入文本。
 */
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const it of Array.from(items)) {
    if (it.kind === 'file') {
      const f = it.getAsFile()
      if (f) {
        // 截图粘贴常无文件名（name 为 'image.png' 之类），补一个更可读的名字
        const named = f.name && f.name !== 'image.png' ? f : new File([f], `粘贴图片.${f.type.split('/')[1] || 'png'}`, { type: f.type })
        files.push(named)
      }
    }
  }
  if (files.length) {
    e.preventDefault()
    addFiles(files)
  }
}
function addFiles(files: File[]) {
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_SIZE) {
      flashSizeError()
      continue
    }
    pending.value.push({
      tempId: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      file,
      url: trackUrl(URL.createObjectURL(file)),
      isImage: isImageMime(file.type),
    })
  }
}
function removePending(tempId: string) {
  const idx = pending.value.findIndex((p) => p.tempId === tempId)
  if (idx >= 0) pending.value.splice(idx, 1)
}
function removeExisting(attId: string) {
  if (!removedIds.value.includes(attId)) removedIds.value.push(attId)
}

/** 当前有效的已有附件（未被标记移除） */
function existingAttachments() {
  return (props.task?.attachments ?? []).filter((a) => !removedIds.value.includes(a.id))
}

/** 点击已有文件附件 → 下载 */
async function downloadExisting(attId: string, name: string) {
  const blob = await getAttachmentBlob(attId)
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ============ 提交 / 关闭 ============
function close() {
  emit('update:open', false)
}

function submit() {
  const t = title.value.trim()
  if (!t) {
    titleRef.value?.focus()
    return
  }
  emit('submit', {
    title: t,
    note: note.value.trim() || undefined,
    pri: pri.value,
    deadline: deadline.value || undefined,
    source: source.value,
    newFiles: pending.value.map((p) => p.file),
    removeAttachmentIds: [...removedIds.value],
  })
  close()
}

function onTitleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    submit()
  }
}

const PRI_OPTIONS: LocalTaskPri[] = [1, 2, 3, 4]
const PRI_HINT: Record<number, string> = { 1: '紧急', 2: '高', 3: '中', 4: '低' }
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      leave-active-class="transition-opacity duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="lt-shell">
        <div class="lt-backdrop" @click="close" />

        <Transition
          appear
          enter-active-class="transition-all duration-200 ease-out"
          leave-active-class="transition-all duration-150 ease-in"
          enter-from-class="opacity-0 translate-y-2 scale-[0.98]"
          leave-to-class="opacity-0 translate-y-1 scale-[0.99]"
        >
          <section
            class="lt-form-card"
            role="dialog"
            aria-modal="true"
            :aria-label="task ? '编辑本地待办' : '新建本地待办'"
            @click.stop
            @paste="onPaste"
          >
            <div class="lt-form-accent" aria-hidden="true" />

            <header class="lt-form-head">
              <div class="lt-brand-mark">
                <IconClipboardCheck class="w-5 h-5" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="lt-eyebrow">{{ source ? `From ZenTao ${source.kind === 'task' ? 'Task' : 'Bug'} #${source.id}` : 'Local Task Route' }}</p>
                <h3 class="lt-title">{{ task ? '编辑本地待办' : '新建本地待办' }}</h3>
                <p class="lt-subtitle">标题、优先级、截止日和附件都会保存在本机工作台。</p>
              </div>
              <button
                v-if="!task"
                type="button"
                class="lt-import-btn"
                title="粘贴禅道链接，自动读取任务 / Bug 详情填入"
                @click="emit('request-import')"
              >
                <IconLinkVariant class="w-3.5 h-3.5" />
                导入禅道
              </button>
              <button class="lt-icon-btn" title="关闭" @click="close">
                <IconClose class="w-4 h-4" />
              </button>
            </header>

            <!-- 表单（可滚动，附件多了也不撑出视口） -->
            <div class="lt-form-scroll" @keydown.escape.prevent="close">
              <!-- 标题 -->
              <div>
                <label class="lt-form-label">标题 <span class="text-rose-300/80">*</span></label>
                <input
                  ref="titleRef"
                  v-model="title"
                  type="text"
                  maxlength="120"
                  placeholder="想做什么？"
                  class="lt-form-input"
                  @keydown="onTitleKeydown"
                >
              </div>

              <!-- 备注 -->
              <div>
                <label class="lt-form-label">备注</label>
                <textarea
                  v-model="note"
                  rows="2"
                  maxlength="500"
                  placeholder="可选：补充细节"
                  class="lt-form-input resize-none"
                />
              </div>

              <!-- 优先级（分段选择） -->
              <div>
                <label class="lt-form-label">优先级</label>
                <div class="grid grid-cols-4 gap-2">
                  <button
                    v-for="p in PRI_OPTIONS"
                    :key="p"
                    type="button"
                    class="lt-form-pri"
                    :class="{ 'is-active': pri === p }"
                    @click="pri = p"
                  >
                    <span class="font-medium">P{{ p }}</span>
                    <span class="text-[10px] opacity-60">{{ PRI_HINT[p] }}</span>
                  </button>
                </div>
              </div>

              <!-- 截止日期 -->
              <div>
                <label class="lt-form-label">截止日期</label>
                <input
                  v-model="deadline"
                  type="date"
                  class="lt-form-input"
                  style="color-scheme: dark"
                >
              </div>

              <!-- 附件 -->
              <div>
                <label class="lt-form-label">图片 / 文件附件</label>
                <!-- 拖放区 -->
                <div
                  class="lt-dropzone"
                  :class="{ 'is-drag': isDragging }"
                  @click="pickFiles"
                  @dragover.prevent="isDragging = true"
                  @dragleave.prevent="isDragging = false"
                  @drop.prevent="onDrop"
                >
                  <IconUpload class="w-5 h-5 text-teal-300/70" />
                  <span class="text-[12.5px] text-white/55">拖入 · 粘贴 · 点击选择图片 / 文件</span>
                  <span class="text-[10.5px] text-white/30">单文件 ≤ {{ Math.round(MAX_ATTACHMENT_SIZE / 1024 / 1024) }}MB（支持 Ctrl+V 粘贴截图）</span>
                  <input
                    ref="fileInput"
                    type="file"
                    multiple
                    class="hidden"
                    @change="onFileChange"
                  >
                </div>
                <p v-if="sizeError" class="mt-1.5 text-[11px] text-rose-300/90">{{ sizeError }}</p>

                <!-- 已有附件 + 新选文件 -->
                <div v-if="existingAttachments().length || pending.length" class="mt-2.5 space-y-2">
                  <!-- 已有图片 -->
                  <div class="flex flex-wrap gap-2">
                    <template v-for="att in existingAttachments()" :key="att.id">
                      <div v-if="att.isImage && existingImageUrls[att.id]" class="lt-thumb group">
                        <img :src="existingImageUrls[att.id]" :alt="att.name" @click="previewUrl = existingImageUrls[att.id]">
                        <button class="lt-thumb-remove" title="移除" @click.stop="removeExisting(att.id)">
                          <IconCloseCircle class="w-4 h-4" />
                        </button>
                      </div>
                      <div v-else class="lt-file group">
                        <IconFile class="w-4 h-4 text-sky-300/80 shrink-0" />
                        <span class="lt-file-name" :title="att.name">{{ att.name }}</span>
                        <span class="lt-file-size">{{ formatFileSize(att.size) }}</span>
                        <button class="lt-file-dl" title="下载" @click.stop="downloadExisting(att.id, att.name)">
                          <IconDownload class="w-3.5 h-3.5" />
                        </button>
                        <button class="lt-file-x" title="移除" @click.stop="removeExisting(att.id)">
                          <IconCloseCircle class="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </template>

                    <!-- 新选文件 -->
                    <template v-for="p in pending" :key="p.tempId">
                      <div v-if="p.isImage" class="lt-thumb group">
                        <img :src="p.url" :alt="p.file.name" @click="previewUrl = p.url">
                        <button class="lt-thumb-remove" title="移除" @click.stop="removePending(p.tempId)">
                          <IconCloseCircle class="w-4 h-4" />
                        </button>
                      </div>
                      <div v-else class="lt-file group">
                        <IconFile class="w-4 h-4 text-sky-300/80 shrink-0" />
                        <span class="lt-file-name" :title="p.file.name">{{ p.file.name }}</span>
                        <span class="lt-file-size">{{ formatFileSize(p.file.size) }}</span>
                        <button class="lt-file-x" title="移除" @click.stop="removePending(p.tempId)">
                          <IconCloseCircle class="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>

            <!-- 底部操作 -->
            <footer class="lt-form-actions">
              <button class="lt-form-btn lt-form-btn-ghost" @click="close">取消</button>
              <button
                class="lt-form-btn lt-form-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="!title.trim()"
                @click="submit"
              >
                {{ task ? '保存修改' : '创建待办' }}
              </button>
            </footer>
          </section>
        </Transition>

        <!-- 图片大图预览（点缩略图展开，点任意处关闭） -->
        <Transition
          enter-active-class="transition-opacity duration-150 ease-out"
          leave-active-class="transition-opacity duration-100 ease-in"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <div
            v-if="previewUrl"
            class="lt-preview-backdrop"
            @click="previewUrl = null"
          >
            <img :src="previewUrl" class="lt-preview-img" alt="附件图片预览" @click.stop>
            <button
              class="lt-preview-close"
              title="关闭"
              @click="previewUrl = null"
            >
              <IconClose class="w-6 h-6" />
            </button>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lt-shell {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.lt-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 22% 16%, rgba(34, 211, 238, 0.18), transparent 34%),
    radial-gradient(circle at 84% 80%, rgba(167, 139, 250, 0.14), transparent 32%),
    rgba(2, 6, 23, 0.78);
  backdrop-filter: blur(16px) saturate(140%);
}
.lt-form-card {
  --lt-tone: #22d3ee;
  --lt-tone-2: #a78bfa;
  --lt-success: #34d399;
  --lt-warning: #fbbf24;
  --lt-danger: #fb7185;
  --lt-border: rgba(148, 163, 184, 0.16);
  position: relative;
  z-index: 10;
  display: flex;
  width: min(560px, 92vw);
  max-height: min(760px, 90vh);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--lt-tone) 20%, rgba(148, 163, 184, 0.24));
  border-radius: 14px;
  background:
    radial-gradient(circle at 14% 0, color-mix(in srgb, var(--lt-tone) 14%, transparent), transparent 34%),
    linear-gradient(135deg, color-mix(in srgb, var(--lt-tone) 8%, transparent), transparent 30%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(2, 6, 23, 0.98));
  color: rgba(248, 250, 252, 0.92);
  box-shadow:
    0 34px 110px rgba(0, 0, 0, 0.66),
    0 0 0 1px rgba(255, 255, 255, 0.035),
    0 0 70px color-mix(in srgb, var(--lt-tone) 12%, transparent);
  backdrop-filter: blur(24px) saturate(145%);
  -webkit-backdrop-filter: blur(24px) saturate(145%);
}
.lt-form-card::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255,255,255,0.026) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: linear-gradient(135deg, rgba(0,0,0,0.55), transparent 58%);
}
.lt-form-card::after {
  position: absolute;
  inset: auto 18px 0;
  height: 1px;
  content: '';
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--lt-tone) 52%, transparent), transparent);
  opacity: 0.75;
}
.lt-form-accent {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 3px;
  flex-shrink: 0;
  background: linear-gradient(90deg, var(--lt-tone), var(--lt-tone-2), var(--lt-tone));
  background-size: 200% 100%;
  box-shadow: 0 0 18px color-mix(in srgb, var(--lt-tone) 45%, transparent);
}
.lt-form-head,
.lt-form-scroll,
.lt-form-actions {
  position: relative;
  z-index: 1;
}
.lt-form-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--lt-border);
  background:
    radial-gradient(circle at 12% 0, color-mix(in srgb, var(--lt-tone) 15%, transparent), transparent 34%),
    rgba(15, 23, 42, 0.34);
}
.lt-brand-mark {
  display: grid;
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--lt-tone) 42%, rgba(255,255,255,0.08));
  border-radius: 12px;
  background:
    radial-gradient(circle at 30% 18%, color-mix(in srgb, var(--lt-tone) 42%, transparent), transparent 45%),
    color-mix(in srgb, var(--lt-tone) 11%, rgba(255,255,255,0.04));
  color: color-mix(in srgb, var(--lt-tone) 82%, white);
  box-shadow:
    0 0 24px color-mix(in srgb, var(--lt-tone) 18%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.1);
}
.lt-eyebrow {
  margin: 0 0 3px;
  color: color-mix(in srgb, var(--lt-tone) 72%, white 8%);
  font: 850 10px/1 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.lt-title {
  margin: 0;
  color: rgba(248, 250, 252, 0.96);
  font-size: 21px;
  font-weight: 850;
  letter-spacing: -0.01em;
}
.lt-subtitle {
  margin: 5px 0 0;
  color: rgba(226, 232, 240, 0.52);
  font-size: 12px;
  line-height: 1.45;
}
.lt-icon-btn,
.lt-form-pri,
.lt-dropzone,
.lt-thumb-remove,
.lt-file-dl,
.lt-file-x,
.lt-form-btn,
.lt-preview-close {
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  cursor: pointer;
}
.lt-icon-btn {
  display: grid;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid rgba(255,255,255,0.085);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.035));
  color: rgba(226, 232, 240, 0.66);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055);
}
.lt-icon-btn:hover,
.lt-icon-btn:focus-visible {
  color: white;
  border-color: color-mix(in srgb, var(--lt-tone) 30%, transparent);
  background: color-mix(in srgb, var(--lt-tone) 9%, rgba(255,255,255,0.07));
  outline: 0;
}
.lt-import-btn {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--lt-tone) 34%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--lt-tone) 10%, rgba(255,255,255,0.04));
  color: color-mix(in srgb, var(--lt-tone) 78%, white);
  font-size: 12px;
  font-weight: 850;
  white-space: nowrap;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.lt-import-btn:hover,
.lt-import-btn:focus-visible {
  border-color: color-mix(in srgb, var(--lt-tone) 52%, transparent);
  background: color-mix(in srgb, var(--lt-tone) 16%, rgba(255,255,255,0.05));
  color: color-mix(in srgb, var(--lt-tone) 92%, white);
  transform: translateY(-1px);
  outline: 0;
}
.lt-form-scroll {
  display: grid;
  gap: 16px;
  overflow-y: auto;
  padding: 18px 22px 20px;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.24) transparent;
}
.lt-form-scroll::-webkit-scrollbar { width: 6px; }
.lt-form-scroll::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.24);
  border-radius: 999px;
}
.lt-form-label {
  display: block;
  margin-bottom: 7px;
  color: rgba(226,232,240,0.62);
  font-size: 11px;
  font-weight: 850;
}
.lt-form-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.58), rgba(2, 6, 23, 0.46));
  color: rgba(248,250,252,0.92);
  outline: none;
  font-size: 13.5px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}
.lt-form-input::placeholder { color: rgba(226,232,240,0.32); }
.lt-form-input:focus {
  border-color: color-mix(in srgb, var(--lt-tone) 50%, transparent);
  background: rgba(2, 6, 23, 0.58);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--lt-tone) 14%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.06);
}
.lt-form-pri {
  position: relative;
  display: flex;
  min-height: 54px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 10px;
  background: rgba(2, 6, 23, 0.28);
  color: rgba(255,255,255,0.7);
  font-size: 13px;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}
.lt-form-pri::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--lt-tone), transparent);
  opacity: 0;
}
.lt-form-pri:hover,
.lt-form-pri:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--lt-tone) 30%, transparent);
  background: color-mix(in srgb, var(--lt-tone) 8%, rgba(255,255,255,0.04));
  color: rgba(255,255,255,0.92);
  outline: 0;
}
.lt-form-pri.is-active {
  border-color: color-mix(in srgb, var(--lt-tone) 48%, transparent);
  background:
    radial-gradient(circle at 12px 10px, color-mix(in srgb, var(--lt-tone) 18%, transparent), transparent 44px),
    color-mix(in srgb, var(--lt-tone) 11%, rgba(2,6,23,0.42));
  color: color-mix(in srgb, var(--lt-tone) 82%, white);
  box-shadow: 0 0 18px color-mix(in srgb, var(--lt-tone) 12%, transparent), inset 0 1px 0 rgba(255,255,255,0.06);
}
.lt-form-pri.is-active::before { opacity: 0.76; }
.lt-dropzone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  padding: 16px 10px;
  border: 1px dashed color-mix(in srgb, var(--lt-tone) 28%, rgba(255,255,255,0.14));
  border-radius: 12px;
  background:
    radial-gradient(circle at 50% 0, color-mix(in srgb, var(--lt-tone) 10%, transparent), transparent 56%),
    rgba(2, 6, 23, 0.25);
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}
.lt-dropzone::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 24px 24px;
  mask-image: linear-gradient(110deg, rgba(0,0,0,0.44), transparent 66%);
}
.lt-dropzone:hover,
.lt-dropzone:focus-visible,
.lt-dropzone.is-drag {
  border-color: color-mix(in srgb, var(--lt-tone) 58%, transparent);
  background: color-mix(in srgb, var(--lt-tone) 9%, rgba(2,6,23,0.34));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lt-tone) 14%, transparent);
  outline: 0;
}
.lt-thumb {
  position: relative;
  width: 58px;
  height: 58px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 10px;
  background: rgba(0,0,0,0.22);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}
.lt-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
}
.lt-thumb-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  place-items: center;
  color: rgba(255,255,255,0.9);
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.65));
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.lt-thumb:hover .lt-thumb-remove,
.lt-thumb-remove:focus-visible { opacity: 1; outline: 0; }
.lt-file {
  display: flex;
  max-width: 100%;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 10px;
  background: rgba(2,6,23,0.28);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
}
.lt-file-name {
  max-width: 190px;
  overflow: hidden;
  color: rgba(255,255,255,0.82);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lt-file-size {
  flex-shrink: 0;
  color: rgba(255,255,255,0.36);
  font-size: 11px;
}
.lt-file-dl,
.lt-file-x {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  border-radius: 7px;
  color: rgba(255,255,255,0.42);
  transition: color 0.15s, background 0.15s;
}
.lt-file-dl:hover,
.lt-file-dl:focus-visible,
.lt-file-x:hover,
.lt-file-x:focus-visible {
  color: rgba(255,255,255,0.88);
  background: rgba(255,255,255,0.08);
  outline: 0;
}
.lt-form-actions {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 9px;
  padding: 13px 22px;
  border-top: 1px solid var(--lt-border);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.52), rgba(2, 6, 23, 0.34));
}
.lt-form-btn {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 850;
  transition: transform 0.15s ease, filter 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.lt-form-btn:hover:not(:disabled),
.lt-form-btn:focus-visible:not(:disabled) {
  transform: translateY(-1px);
  outline: 0;
}
.lt-form-btn-ghost {
  border: 1px solid rgba(255,255,255,0.085);
  background: linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.035));
  color: rgba(226,232,240,0.68);
}
.lt-form-btn-ghost:hover,
.lt-form-btn-ghost:focus-visible {
  border-color: color-mix(in srgb, var(--lt-tone) 28%, transparent);
  background: color-mix(in srgb, var(--lt-tone) 8%, rgba(255,255,255,0.06));
  color: white;
}
.lt-form-btn-primary {
  background:
    radial-gradient(circle at 30% 0, rgba(255,255,255,0.32), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--lt-tone) 92%, white 5%), var(--lt-tone));
  color: #03131a;
  box-shadow:
    0 10px 26px color-mix(in srgb, var(--lt-tone) 18%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.24);
}
.lt-form-btn-primary:not(:disabled):hover { filter: brightness(1.08); }
.lt-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(2,6,23,0.86);
  backdrop-filter: blur(12px) saturate(130%);
  cursor: zoom-out;
}
.lt-preview-img {
  max-width: 94vw;
  max-height: 90vh;
  border: 1px solid rgba(148,163,184,0.18);
  border-radius: 12px;
  box-shadow: 0 30px 90px rgba(0,0,0,0.62);
}
.lt-preview-close {
  position: absolute;
  top: 20px;
  right: 20px;
  display: grid;
  padding: 8px;
  place-items: center;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.72);
  transition: color 0.15s, background 0.15s;
}
.lt-preview-close:hover,
.lt-preview-close:focus-visible {
  background: rgba(255,255,255,0.12);
  color: white;
  outline: 0;
}
@media (max-width: 640px) {
  .lt-shell { padding: 10px; }
  .lt-form-card { width: 100%; max-height: 94vh; }
  .lt-form-head { padding: 16px; }
  .lt-title { font-size: 19px; }
  .lt-form-scroll { padding: 16px; }
  .lt-form-actions { padding: 12px 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .lt-form-pri,
  .lt-form-btn,
  .lt-dropzone { transition: none; }
  .lt-form-pri:hover,
  .lt-form-btn:hover:not(:disabled) { transform: none; }
}
</style>
