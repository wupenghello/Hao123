<script setup lang="ts">
import { ref, watch } from 'vue'
import { useBookmarkStore } from '@/stores/bookmarks'
import { useCategoryStore } from '@/stores/categories'
import { useBookmarkEditor } from '@/composables/useBookmarkEditor'
import type { Bookmark } from '@/types'
import IconClose from '~icons/mdi/close'

const bookmarkStore = useBookmarkStore()
const categoryStore = useCategoryStore()
const { editingBookmark, isAdding, stopEdit } = useBookmarkEditor()

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

// 监听编辑状态变化
watch(editingBookmark, (bookmark) => {
  if (bookmark) openEditForm(bookmark)
})

// 监听添加状态变化
watch(isAdding, (val) => {
  if (val) openAddForm()
})
</script>

<template>
  <!-- 表单弹窗 -->
  <Transition name="modal">
    <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <!-- 遮罩层 -->
      <div class="absolute inset-0 bg-black/40 backdrop-blur-md" @click="closeForm" />

      <!-- 表单 -->
      <div class="form-dialog relative bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl w-full max-w-md p-7">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-lg font-semibold text-gray-800">
            {{ isEditing ? '编辑书签' : '添加书签' }}
          </h2>
          <button
            @click="closeForm"
            class="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <IconClose class="w-5 h-5" />
          </button>
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1.5">网站名称 *</label>
            <input
              v-model="name"
              type="text"
              placeholder="例如：Google"
              required
              class="w-full px-3.5 py-2.5 bg-gray-50/80 border border-gray-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-300 transition-colors placeholder-gray-400/60"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1.5">网址 URL *</label>
            <input
              v-model="url"
              type="url"
              placeholder="https://www.google.com"
              required
              class="w-full px-3.5 py-2.5 bg-gray-50/80 border border-gray-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-300 transition-colors placeholder-gray-400/60"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1.5">描述</label>
            <input
              v-model="description"
              type="text"
              placeholder="简短描述（可选）"
              class="w-full px-3.5 py-2.5 bg-gray-50/80 border border-gray-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-300 transition-colors placeholder-gray-400/60"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1.5">分类</label>
            <select
              v-model="categoryId"
              class="w-full px-3.5 py-2.5 bg-gray-50/80 border border-gray-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-300 transition-colors text-gray-700"
            >
              <option v-for="cat in categoryStore.categories" :key="cat.id" :value="cat.id">
                {{ cat.name }}
              </option>
            </select>
          </div>

          <div class="flex gap-3 pt-3">
            <button
              type="button"
              @click="closeForm"
              class="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 font-medium hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              class="flex-1 py-2.5 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors shadow-sm"
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
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .form-dialog,
.modal-leave-to .form-dialog {
  transform: scale(0.95) translateY(8px);
}
</style>
