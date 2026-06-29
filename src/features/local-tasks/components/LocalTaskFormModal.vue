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
import type { LocalTask, LocalTaskPri, LocalTaskFormPayload } from '../types'
import { getAttachmentBlob } from '../attachments'
import { isImageMime, formatFileSize, MAX_ATTACHMENT_SIZE } from '../util'
import IconClose from '~icons/mdi/close'
import IconCloseCircle from '~icons/mdi/close-circle'
import IconUpload from '~icons/mdi/cloud-upload-outline'
import IconFile from '~icons/mdi/file-document-outline'
import IconDownload from '~icons/mdi/download'

const props = defineProps<{
  /** 是否打开 */
  open: boolean
  /** 编辑目标；null = 新建 */
  task: LocalTask | null
}>()

/** 提交载荷：表单字段 + 新增文件 + 待移除附件 id（类型见 types.ts，供面板与弹窗共用） */

const emit = defineEmits<{
  'update:open': [value: boolean]
  submit: [payload: LocalTaskFormPayload]
}>()

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
      // 已有图片附件：从 IDB 读 Blob 生成预览（非图片走文件图标，无需 URL）
      for (const att of props.task.attachments ?? []) {
        if (!att.isImage) continue
        const blob = await getAttachmentBlob(att.id)
        if (blob) existingImageUrls.value[att.id] = trackUrl(URL.createObjectURL(blob))
      }
    } else {
      title.value = ''
      note.value = ''
      pri.value = 3
      deadline.value = ''
    }
    await nextTick()
    titleRef.value?.focus()
  },
  { immediate: true },
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
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" @click="close" />

        <Transition
          appear
          enter-active-class="transition-all duration-200 ease-out"
          leave-active-class="transition-all duration-150 ease-in"
          enter-from-class="opacity-0 translate-y-2 scale-[0.98]"
          leave-to-class="opacity-0 translate-y-1 scale-[0.99]"
        >
          <div
            class="lt-form-card relative z-10 w-[92vw] max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
            @click.stop
            @paste="onPaste"
          >
            <!-- 顶部渐变条（呼应主题） -->
            <div class="lt-form-accent" />

            <!-- 头部 -->
            <div class="px-5 pt-4 pb-3 flex items-center gap-2 flex-shrink-0">
              <h3 class="text-white/90 text-sm font-medium">
                {{ task ? '编辑任务' : '新建任务' }}
              </h3>
              <button
                class="ml-auto text-white/40 hover:text-white/80 hover:bg-white/10 rounded-lg p-1.5 transition-colors"
                title="关闭"
                @click="close"
              >
                <IconClose class="w-4 h-4" />
              </button>
            </div>

            <!-- 表单（可滚动，附件多了也不撑出视口） -->
            <div class="lt-form-scroll px-5 pb-5 space-y-4 overflow-y-auto" @keydown.escape.prevent="close">
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
            <div class="flex-shrink-0 px-5 py-3 border-t border-white/8 flex justify-end gap-2">
              <button class="lt-form-btn lt-form-btn-ghost" @click="close">取消</button>
              <button
                class="lt-form-btn lt-form-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="!title.trim()"
                @click="submit"
              >
                {{ task ? '保存' : '创建' }}
              </button>
            </div>
          </div>
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
            class="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-950/85 backdrop-blur-sm cursor-zoom-out"
            @click="previewUrl = null"
          >
            <img :src="previewUrl" class="max-w-[94vw] max-h-[90vh] rounded-lg shadow-2xl" @click.stop>
            <button
              class="absolute top-5 right-5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg p-2 transition-colors"
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
/* 卡片：与项目其它弹窗一致的 navy→teal 玻璃质感（简化版，无 HUD 角 / 流光） */
.lt-form-card {
  border-radius: 16px;
  background: linear-gradient(160deg, rgba(30, 58, 95, 0.92) 0%, rgba(15, 23, 42, 0.94) 100%);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 24px 70px -12px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(45, 212, 191, 0.15);
}

.lt-form-accent {
  height: 3px;
  width: 100%;
  flex-shrink: 0;
  background: linear-gradient(90deg, #1e3a5f, #2dd4bf, #1e3a5f);
  box-shadow: 0 0 10px rgba(45, 212, 191, 0.4);
}

.lt-form-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

.lt-form-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}

.lt-form-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}
.lt-form-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}
.lt-form-input:focus {
  border-color: rgba(94, 234, 212, 0.5);
  background: rgba(255, 255, 255, 0.07);
}

/* 优先级分段按钮 */
.lt-form-pri {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 6px 0;
  border-radius: 8px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  transition: all 0.15s;
}
.lt-form-pri:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}
.lt-form-pri.is-active {
  color: #5eead4;
  background: rgba(45, 212, 191, 0.14);
  border-color: rgba(94, 234, 212, 0.5);
}

/* 拖放区 */
.lt-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 14px 10px;
  border-radius: 10px;
  border: 1.5px dashed rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.lt-dropzone:hover {
  border-color: rgba(94, 234, 212, 0.45);
  background: rgba(45, 212, 191, 0.05);
}
.lt-dropzone.is-drag {
  border-color: rgba(94, 234, 212, 0.8);
  background: rgba(45, 212, 191, 0.1);
}

/* 图片缩略图 */
.lt-thumb {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
}
.lt-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
}
.lt-thumb-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  color: rgba(255, 255, 255, 0.9);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  opacity: 0;
  transition: opacity 0.15s;
}
.lt-thumb:hover .lt-thumb-remove {
  opacity: 1;
}

/* 文件 chip */
.lt-file {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.lt-file-name {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lt-file-size {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  flex-shrink: 0;
}
.lt-file-dl,
.lt-file-x {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.4);
  transition: color 0.15s;
}
.lt-file-dl:hover,
.lt-file-x:hover {
  color: rgba(255, 255, 255, 0.85);
}

.lt-form-btn {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  transition: all 0.15s;
  cursor: pointer;
}
.lt-form-btn-ghost {
  color: rgba(255, 255, 255, 0.65);
  background: transparent;
}
.lt-form-btn-ghost:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.08);
}
.lt-form-btn-primary {
  color: #042f2e;
  font-weight: 500;
  background: linear-gradient(135deg, #5eead4, #2dd4bf);
}
.lt-form-btn-primary:not(:disabled):hover {
  filter: brightness(1.08);
  box-shadow: 0 4px 14px -4px rgba(45, 212, 191, 0.5);
}
</style>
