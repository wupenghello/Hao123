<script setup lang="ts">
/** 会话列表 popover：切换 / 行内重命名 / 两步删除 / 新建。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChatStore } from '../store'
import IconEdit from '~icons/mdi/pencil-outline'
import IconDelete from '~icons/mdi/trash-can-outline'
import IconCheck from '~icons/mdi/check'
import IconClose from '~icons/mdi/close'
import IconPlus from '~icons/mdi/plus'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useChatStore()

/** 会话列表：时间近的在前 */
const sortedSessions = computed(() =>
  [...store.sessions].sort((a, b) => b.updatedAt - a.updatedAt),
)

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function switchTo(id: string) {
  store.switchSession(id)
  emit('close')
}

function newSession() {
  store.newSession()
  emit('close')
}

// ── 行内重命名 ──
const renamingId = ref<string | null>(null)
const renameText = ref('')

function startRename(id: string, title: string) {
  renamingId.value = id
  renameText.value = title
}
function commitRename() {
  if (renamingId.value) {
    store.renameSession(renamingId.value, renameText.value.trim())
  }
  renamingId.value = null
}

// ── 两步删除：行内确认，3s 无操作自动还原 ──
const confirmDeleteId = ref<string | null>(null)
let deleteTimer: ReturnType<typeof setTimeout> | null = null

function askDelete(id: string) {
  confirmDeleteId.value = id
  if (deleteTimer) clearTimeout(deleteTimer)
  deleteTimer = setTimeout(() => {
    confirmDeleteId.value = null
  }, 3000)
}
function cancelDelete() {
  confirmDeleteId.value = null
  if (deleteTimer) clearTimeout(deleteTimer)
}
function doDelete(id: string) {
  store.deleteSession(id)
  cancelDelete()
}

// ── 关闭交互：外点 / Esc ──
const rootEl = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  if (!props.open) return
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) emit('close')
}
function onDocKeydown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKeydown, true)
  if (deleteTimer) clearTimeout(deleteTimer)
})

// 每次打开重置重命名/删除态
watch(
  () => props.open,
  (o) => {
    if (o) {
      renamingId.value = null
      confirmDeleteId.value = null
    }
  },
)
</script>

<template>
  <div
    v-if="open"
    ref="rootEl"
    class="sess-pop"
  >
    <div class="sess-head">
      <span class="sess-eyebrow">SESSIONS</span>
      <span class="sess-count">{{ store.sessions.length }}</span>
    </div>
    <ul class="sess-list">
      <li
        v-for="s in sortedSessions"
        :key="s.id"
        class="sess-row"
        :class="{ 'is-active': s.id === store.activeSessionId }"
      >
        <template v-if="renamingId === s.id">
          <input
            v-model="renameText"
            class="sess-rename-input"
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renamingId = null"
            @blur="commitRename"
          />
          <button type="button" class="sess-row-btn" title="完成" @click.stop="commitRename">
            <IconCheck class="w-3 h-3" />
          </button>
        </template>
        <template v-else-if="confirmDeleteId === s.id">
          <span class="sess-delete-ask">删除该会话？</span>
          <span class="sess-delete-btns">
            <button type="button" class="sess-row-btn is-danger" @click.stop="doDelete(s.id)">
              <IconCheck class="w-3 h-3" />
            </button>
            <button type="button" class="sess-row-btn" title="取消" @click.stop="cancelDelete">
              <IconClose class="w-3 h-3" />
            </button>
          </span>
        </template>
        <template v-else>
          <button type="button" class="sess-row-main" @click="switchTo(s.id)">
            <span class="sess-dot" aria-hidden="true" />
            <span class="sess-title">{{ s.title }}</span>
            <span class="sess-time">{{ relativeTime(s.updatedAt) }}</span>
          </button>
          <span class="sess-row-ops">
            <button type="button" class="sess-row-btn" title="重命名" @click.stop="startRename(s.id, s.title)">
              <IconEdit class="w-3 h-3" />
            </button>
            <button type="button" class="sess-row-btn" title="删除" @click.stop="askDelete(s.id)">
              <IconDelete class="w-3 h-3" />
            </button>
          </span>
        </template>
      </li>
      <li v-if="!store.sessions.length" class="sess-empty">还没有会话</li>
    </ul>
    <button type="button" class="sess-new" @click="newSession">
      <IconPlus class="w-3.5 h-3.5" />
      <span>新建会话</span>
    </button>
  </div>
</template>

<style scoped>
.sess-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 12px;
  z-index: 30;
  width: 268px;
  padding: 6px;
  background: var(--color-raised);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.5);
  font-size: 12.5px;
}
.sess-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 6px;
}
.sess-eyebrow {
  font: 700 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.12em;
  color: var(--color-ink-3);
}
.sess-count {
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.sess-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.sess-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 3px 4px 3px 8px;
  border-radius: 4px;
}
.sess-row:hover {
  background: var(--color-base);
}
.sess-row.is-active {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}
.sess-row-main {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.sess-dot {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: 1.5px;
  background: var(--color-ink-3);
}
.is-active .sess-dot {
  background: var(--color-accent);
}
.sess-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-ink-2);
}
.is-active .sess-title {
  color: var(--color-ink);
  font-weight: 650;
}
.sess-time {
  flex: 0 0 auto;
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.sess-row-ops {
  display: none;
  gap: 2px;
  flex: 0 0 auto;
}
.sess-row:hover .sess-row-ops {
  display: flex;
}
.sess-row-btn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--color-ink-3);
  cursor: pointer;
}
.sess-row-btn:hover {
  background: var(--color-raised);
  color: var(--color-ink);
}
.sess-row-btn.is-danger:hover {
  color: var(--color-danger);
}
.sess-rename-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
  border-radius: 3px;
  background: var(--color-base);
  color: var(--color-ink);
  font-size: 12px;
}
.sess-delete-ask {
  flex: 1;
  color: var(--color-danger);
  font-size: 12px;
}
.sess-delete-btns {
  display: flex;
  gap: 2px;
}
.sess-empty {
  padding: 12px 8px;
  color: var(--color-ink-3);
  font-size: 12px;
  text-align: center;
}
.sess-new {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 30px;
  margin-top: 4px;
  padding: 0 10px;
  border: none;
  border-top: 1px solid var(--color-line);
  background: transparent;
  color: var(--color-ink-2);
  font-size: 12px;
  cursor: pointer;
}
.sess-new:hover {
  color: var(--color-accent-strong);
  background: var(--color-base);
}
</style>
