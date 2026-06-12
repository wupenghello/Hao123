<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBookmarkStore } from '@/stores/bookmarks'
import BookmarkCard from '@/components/BookmarkCard.vue'
import CategoryTabs from '@/components/CategoryTabs.vue'

const store = useBookmarkStore()
const categoryTabs = ref<InstanceType<typeof CategoryTabs> | null>(null)

const currentCategoryId = computed(
  () => categoryTabs.value?.activeCategoryId ?? store.categories[0]?.id
)

const currentBookmarks = computed(() =>
  store.getBookmarksByCategory(currentCategoryId.value ?? '')
)

function handleEdit(bookmark: any) {
  window.dispatchEvent(
    new CustomEvent('edit-bookmark', { detail: bookmark })
  )
}

function handleDelete(id: string) {
  if (confirm('确定要删除这个书签吗？')) {
    store.deleteBookmark(id)
  }
}
</script>

<template>
  <CategoryTabs ref="categoryTabs" />
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
