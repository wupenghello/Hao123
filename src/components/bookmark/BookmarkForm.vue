<script setup lang="ts">
import { ref, watch } from 'vue'
import { useBookmarkStore } from '@/stores/bookmarks'
import { useCategoryStore } from '@/stores/categories'
import { useBookmarkEditor } from '@/composables/useBookmarkEditor'
import type { Bookmark } from '@/types'
import IconPlus from '~icons/mdi/plus'
import IconClose from '~icons/mdi/close'

const bookmarkStore = useBookmarkStore()
const categoryStore = useCategoryStore()
const { editingBookmark, stopEdit } = useBookmarkEditor()

const showForm = ref(false)
const isEditing = ref(false)
const editingId = ref('')

const name = ref('')
const url = ref('')
const description = ref('')
const categoryId = ref('')

function openAddForm() {
  isEditing.value = false
  editingId.value = ''
  name.value = ''
  url.value = ''
  description.value = ''
  categoryId.value = categoryStore.categories[0]?.id ?? ''
  showForm.value = true
}

function openEditForm(bookmark: Bookmark) {
  isEditing.value = true
  editingId.value = bookmark.id
  name.value = bookmark.name
  url.value = bookmark.url
  description.value = bookmark.description ?? ''
  categoryId.value = bookmark.categoryId
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  stopEdit()
}

function handleSubmit() {
  if (!name.value.trim() || !url.value.trim()) return

  if (isEditing.value) {
    bookmarkStore.updateBookmark(editingId.value, {
      name: name.value.trim(),
      url: url.value.trim(),
      description: description.value.trim() || undefined,
      categoryId: categoryId.value,
    })
  } else {
    bookmarkStore.addBookmark({
      name: name.value.trim(),
      url: url.value.trim(),
      description: description.value.trim() || undefined,
      categoryId: categoryId.value,
    })
  }

  closeForm()
}

// 监听编辑状态变化，自动打开编辑表单
watch(editingBookmark, (bookmark) => {
  if (bookmark) {
    openEditForm(bookmark)
  }
})
</script>

<template>
  <!-- 添加按钮 -->
  <button
    @click="openAddForm"
    class="mt-4 flex items-center gap-2 text-sm text-blue-500 hover:text-blue-600 transition-colors"
  >
    <IconPlus class="w-5 h-5" />
    <span>添加书签</span>
  </button>

  <!-- 表单弹窗 -->
  <Transition name="modal">
    <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <!-- 遮罩层 -->
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="closeForm" />

      <!-- 表单 -->
      <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-lg font-semibold text-gray-800">
            {{ isEditing ? '编辑书签' : '添加书签' }}
          </h2>
          <button
            @click="closeForm"
            class="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <IconClose class="w-5 h-5" />
          </button>
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">网站名称 *</label>
            <input
              v-model="name"
              type="text"
              placeholder="例如：Google"
              required
              class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">网址 URL *</label>
            <input
              v-model="url"
              type="url"
              placeholder="https://www.google.com"
              required
              class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">描述</label>
            <input
              v-model="description"
              type="text"
              placeholder="简短描述（可选）"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">分类</label>
            <select
              v-model="categoryId"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            >
              <option v-for="cat in categoryStore.categories" :key="cat.id" :value="cat.id">
                {{ cat.name }}
              </option>
            </select>
          </div>

          <div class="flex gap-3 pt-2">
            <button
              type="button"
              @click="closeForm"
              class="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              class="flex-1 py-2.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            >
              {{ isEditing ? '保存' : '添加' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative,
.modal-leave-to .relative {
  transform: scale(0.95);
}
</style>
