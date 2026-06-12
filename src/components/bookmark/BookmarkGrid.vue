<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBookmarkStore } from '@/stores/bookmarks'
import { useCategoryStore } from '@/stores/categories'
import { useBookmarkEditor } from '@/composables/useBookmarkEditor'
import BookmarkCard from '@/components/bookmark/BookmarkCard.vue'
import CategoryTabs from '@/components/bookmark/CategoryTabs.vue'
import IconPlus from '~icons/mdi/plus'
import type { Bookmark } from '@/types'

const bookmarkStore = useBookmarkStore()
const categoryStore = useCategoryStore()
const { startEdit, startAdd } = useBookmarkEditor()

const activeCategoryId = ref<string>(categoryStore.categories[0]?.id ?? '')

const currentBookmarks = computed(() =>
  bookmarkStore.getBookmarksByCategory(activeCategoryId.value)
)

function handleEdit(bookmark: Bookmark) {
  startEdit(bookmark)
}

function handleDelete(id: string) {
  if (confirm('确定要删除这个书签吗？')) {
    bookmarkStore.deleteBookmark(id)
  }
}
</script>

<template>
  <CategoryTabs v-model="activeCategoryId" />
  <div class="mt-4">
    <div
      class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-3"
    >
      <!-- 添加书签按钮（网格第一位） -->
      <button
        @click="startAdd"
        class="add-card group relative cursor-pointer rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center transition-all duration-300 ease-out min-h-[100px] sm:min-h-[120px]"
      >
        <div class="w-10 h-10 sm:w-14 sm:h-14 flex items-center justify-center mb-2 sm:mb-3 transition-transform duration-300 group-hover:scale-110">
          <IconPlus class="w-6 h-6 sm:w-7 sm:h-7 text-white/20 group-hover:text-white/50 transition-colors" />
        </div>
        <span class="text-[10px] sm:text-[11px] font-medium text-white/20 group-hover:text-white/40 transition-colors">添加</span>
      </button>

      <BookmarkCard
        v-for="bookmark in currentBookmarks"
        :key="bookmark.id"
        :bookmark="bookmark"
        @edit="handleEdit"
        @delete="handleDelete"
      />
    </div>
    <div v-if="currentBookmarks.length === 0" class="text-center py-16 text-white/30">
      <p class="text-4xl mb-3">📭</p>
      <p class="text-sm">该分类下暂无书签</p>
    </div>
  </div>
</template>

<style scoped>
.add-card {
  background: rgba(255, 255, 255, 0.04);
}

.add-card:hover {
  background: rgba(255, 255, 255, 0.08);
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}
</style>
