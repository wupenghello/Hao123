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
  <div class="mt-5">
    <div
      v-if="currentBookmarks.length > 0"
      class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-4"
    >
      <BookmarkCard
        v-for="bookmark in currentBookmarks"
        :key="bookmark.id"
        :bookmark="bookmark"
        @edit="handleEdit"
        @delete="handleDelete"
      />
    </div>
    <div v-else class="text-center py-16 text-gray-400">
      <p class="text-3xl mb-2">📭</p>
      <p class="text-sm">该分类下暂无书签</p>
    </div>
  </div>
</template>
