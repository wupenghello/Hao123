<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useBookmarkStore } from '@/stores/bookmarks'
import { useCategoryStore } from '@/stores/categories'
import { hashColor } from '@/utils/favicon'
import IconSearch from '~icons/mdi/magnify'
import IconOpenInNew from '~icons/mdi/open-in-new'
import type { Bookmark } from '@/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const bookmarkStore = useBookmarkStore()
const categoryStore = useCategoryStore()

const visible = ref(false)
const query = ref('')
const inputRef = ref<HTMLInputElement>()
const selectedIndex = ref(0)
const listRef = ref<HTMLElement>()

/** 分类 id → 名称映射 */
const categoryMap = computed(() => {
  const map = new Map<string, string>()
  for (const cat of categoryStore.categories) {
    map.set(cat.id, cat.name)
  }
  return map
})

/** 过滤结果 */
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return bookmarkStore.bookmarks
  return bookmarkStore.bookmarks.filter(
    (b) =>
      b.name.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      (b.description?.toLowerCase().includes(q) ?? false),
  )
})

/** 重置选中索引 */
watch(filtered, () => {
  selectedIndex.value = 0
})

/** 监听 open prop → 同步到内部 visible */
watch(
  () => props.open,
  (val) => {
    if (val) {
      visible.value = true
      query.value = ''
      selectedIndex.value = 0
      nextTick(() => inputRef.value?.focus())
    }
  },
)

/** 关闭面板 */
function close() {
  visible.value = false
  emit('close')
}

/** 打开书签 */
function openBookmark(bookmark: Bookmark) {
  window.open(bookmark.url, '_blank')
  close()
}

/** 输入框键盘事件 */
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % filtered.value.length
    scrollToSelected()
    return
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value =
      (selectedIndex.value - 1 + filtered.value.length) % filtered.value.length
    scrollToSelected()
    return
  }

  if (e.key === 'Enter' && filtered.value.length > 0) {
    e.preventDefault()
    openBookmark(filtered.value[selectedIndex.value])
    return
  }
}

/** 滚动到选中项 */
function scrollToSelected() {
  nextTick(() => {
    const el = listRef.value?.children[selectedIndex.value] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  })
}

/** 首字符 */
function firstChar(name: string): string {
  return name.charAt(0).toUpperCase()
}
</script>

<template>
  <Transition name="modal">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <!-- 遮罩层 -->
      <div class="absolute inset-0 bg-black/40 backdrop-blur-md" @click="close" />

      <!-- 面板 -->
      <div class="palette-container relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
        <!-- 搜索输入 -->
        <div class="flex items-center px-5 py-4 border-b border-white/10">
          <IconSearch class="w-5 h-5 text-white/40 flex-shrink-0" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            placeholder="搜索书签…"
            class="flex-1 ml-3 bg-transparent outline-none text-white placeholder-white/30 text-[15px]"
            @keydown="handleKeydown"
          />
          <kbd class="px-1.5 py-0.5 bg-white/8 rounded text-white/30 text-[11px] font-mono border border-white/10 flex-shrink-0">ESC</kbd>
        </div>

        <!-- 结果列表 -->
        <ul
          v-if="filtered.length > 0"
          ref="listRef"
          class="max-h-[50vh] overflow-y-auto py-2"
        >
          <li
            v-for="(bookmark, idx) in filtered"
            :key="bookmark.id"
            class="flex items-center gap-3 px-5 py-3 mx-2 rounded-xl cursor-pointer transition-colors duration-150"
            :class="idx === selectedIndex ? 'bg-white/10' : 'hover:bg-white/6'"
            @click="openBookmark(bookmark)"
            @mouseenter="selectedIndex = idx"
          >
            <!-- Favicon -->
            <div class="w-8 h-8 flex-shrink-0 flex items-center justify-center overflow-hidden rounded-lg">
              <img
                v-if="bookmark.favicon"
                :src="bookmark.favicon"
                :alt="bookmark.name"
                class="w-5 h-5"
                style="image-rendering: -webkit-optimize-contrast"
                @error="(($event.target) as HTMLImageElement).style.display = 'none'; ((($event.target) as HTMLImageElement).nextElementSibling as HTMLElement).style.display = 'flex'"
              />
              <span
                class="letter-avatar w-6 h-6 items-center justify-center rounded-md text-white text-xs font-bold select-none"
                :style="{ backgroundColor: hashColor(bookmark.url || bookmark.name), display: bookmark.favicon ? 'none' : 'flex' }"
              >
                {{ firstChar(bookmark.name) }}
              </span>
            </div>

            <!-- 信息 -->
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-white/90 truncate">{{ bookmark.name }}</p>
              <p class="text-xs text-white/40 truncate">{{ bookmark.url }}</p>
            </div>

            <!-- 分类标签 -->
            <span
              v-if="categoryMap.get(bookmark.categoryId)"
              class="flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-white/40"
            >
              {{ categoryMap.get(bookmark.categoryId) }}
            </span>

            <!-- 打开图标 -->
            <IconOpenInNew
              v-if="idx === selectedIndex"
              class="w-4 h-4 text-white/30 flex-shrink-0"
            />
          </li>
        </ul>

        <!-- 空状态 -->
        <div v-else class="py-12 text-center">
          <p class="text-3xl mb-2">🔍</p>
          <p class="text-sm text-white/30">未找到匹配的书签</p>
        </div>

        <!-- 底部提示 -->
        <div class="flex items-center justify-center gap-4 px-5 py-2.5 border-t border-white/8 text-[11px] text-white/25">
          <span>
            <kbd class="px-1 py-0.5 bg-white/8 rounded font-mono border border-white/10">↑↓</kbd>
            导航
          </span>
          <span>
            <kbd class="px-1 py-0.5 bg-white/8 rounded font-mono border border-white/10">↵</kbd>
            打开
          </span>
          <span>
            <kbd class="px-1 py-0.5 bg-white/8 rounded font-mono border border-white/10">esc</kbd>
            关闭
          </span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.palette-container {
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.letter-avatar {
  letter-spacing: 0;
  line-height: 1;
}

/* 弹窗动画 */
.modal-enter-active,
.modal-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .palette-container,
.modal-leave-to .palette-container {
  transform: scale(0.97) translateY(-8px);
}
</style>
