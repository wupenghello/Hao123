<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBookmarkStore } from '@/stores/bookmarks'
import { useCategoryStore } from '@/stores/categories'
import { useBookmarkEditor } from '@/composables/useBookmarkEditor'
import BookmarkCard from '@/components/bookmark/BookmarkCard.vue'
import CategoryTabs from '@/components/bookmark/CategoryTabs.vue'
import type { Bookmark } from '@/types'

const bookmarkStore = useBookmarkStore()
const categoryStore = useCategoryStore()
const { startEdit } = useBookmarkEditor()

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
      v-if="currentBookmarks.length > 0"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
    >
      <BookmarkCard
        v-for="bookmark in currentBookmarks"
        :key="bookmark.id"
        :bookmark="bookmark"
        @edit="handleEdit"
        @delete="handleDelete"
      />
    </div>
    <div v-else class="text-center py-12 text-gray-400">
      <p class="text-lg">📭</p>
      <p class="mt-2 text-sm">该分类下暂无书签</p>
    </div>
  </div>
</template>
