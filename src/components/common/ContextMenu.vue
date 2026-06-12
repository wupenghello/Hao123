<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useContextMenu } from '@/composables/useContextMenu'
import { useCategoryStore } from '@/stores/categories'
import { useBookmarkStore } from '@/stores/bookmarks'
import { useBookmarkEditor } from '@/composables/useBookmarkEditor'
import IconOpenInNew from '~icons/mdi/open-in-new'
import IconContentCopy from '~icons/mdi/content-copy'
import IconPencil from '~icons/mdi/pencil'
import IconFolderMove from '~icons/mdi/folder-move'
import IconDelete from '~icons/mdi/delete'

const { visible, bookmark, x, y, close } = useContextMenu()
const categoryStore = useCategoryStore()
const bookmarkStore = useBookmarkStore()
const { startEdit } = useBookmarkEditor()

/** 获取其他分类（排除当前书签所在分类） */
const otherCategories = computed(() => {
  if (!bookmark.value) return []
  return categoryStore
    .getSortedCategories()
    .filter((c) => c.id !== bookmark.value!.categoryId)
})

function openLink() {
  if (bookmark.value) window.open(bookmark.value.url, '_blank')
  close()
}

async function copyLink() {
  if (bookmark.value) {
    try {
      await navigator.clipboard.writeText(bookmark.value.url)
    } catch {
      // fallback: 不做任何处理
    }
  }
  close()
}

function edit() {
  if (bookmark.value) startEdit(bookmark.value)
  close()
}

function moveTo(categoryId: string) {
  if (bookmark.value) {
    bookmarkStore.updateBookmark(bookmark.value.id, { categoryId })
  }
  close()
}

function deleteBookmark() {
  if (bookmark.value && confirm('确定要删除这个书签吗？')) {
    bookmarkStore.deleteBookmark(bookmark.value.id)
  }
  close()
}

/** 点击任意区域关闭菜单 */
function handleDocumentClick(e: MouseEvent) {
  if (!visible.value) return
  // 点击菜单内部不关闭（由 @click.stop 处理）
  if ((e.target as HTMLElement).closest('.context-menu')) return
  close()
}

function handleDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && visible.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick, true)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick, true)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="menu">
      <div
        v-if="visible && bookmark"
        class="context-menu fixed z-[60] rounded-xl py-1.5 min-w-[180px]"
        :style="{ left: `${x}px`, top: `${y}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <button class="menu-item" @click="openLink">
          <IconOpenInNew class="w-4 h-4" />
          <span>打开链接</span>
        </button>

        <button class="menu-item" @click="copyLink">
          <IconContentCopy class="w-4 h-4" />
          <span>复制链接</span>
        </button>

        <div class="menu-divider" />

        <button class="menu-item" @click="edit">
          <IconPencil class="w-4 h-4" />
          <span>编辑书签</span>
        </button>

        <!-- 移动到其他分类 -->
        <template v-if="otherCategories.length > 0">
          <div class="menu-divider" />
          <div class="menu-label">
            <IconFolderMove class="w-3.5 h-3.5 inline-block -mt-0.5 mr-1" />
            移动到…
          </div>
          <button
            v-for="cat in otherCategories"
            :key="cat.id"
            class="menu-item pl-8 text-xs"
            @click="moveTo(cat.id)"
          >
            <span>{{ cat.name }}</span>
          </button>
        </template>

        <div class="menu-divider" />

        <button class="menu-item danger" @click="deleteBookmark">
          <IconDelete class="w-4 h-4" />
          <span>删除</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.context-menu {
  background: rgba(15, 23, 42, 0.9);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  transition: background-color 0.15s;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.menu-item.danger {
  color: rgba(248, 113, 113, 0.9);
}

.menu-item.danger:hover {
  background: rgba(239, 68, 68, 0.15);
}

.menu-label {
  padding: 4px 14px 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  user-select: none;
  pointer-events: none;
}

.menu-divider {
  height: 1px;
  margin: 4px 8px;
  background: rgba(255, 255, 255, 0.08);
}

/* 弹出动画 */
.menu-enter-active,
.menu-leave-active {
  transition: all 0.15s ease;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
