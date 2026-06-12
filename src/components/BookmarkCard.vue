<script setup lang="ts">
import { getFaviconUrl } from '@/utils/favicon'
import type { Bookmark } from '@/types'
import IconEdit from '~icons/mdi/pencil'
import IconDelete from '~icons/mdi/delete'
import IconOpen from '~icons/mdi/open-in-new'

const props = defineProps<{
  bookmark: Bookmark
}>()

const emit = defineEmits<{
  edit: [bookmark: Bookmark]
  delete: [id: string]
}>()

const favicon = props.bookmark.favicon || getFaviconUrl(props.bookmark.url)

function openUrl() {
  window.open(props.bookmark.url, '_blank')
}
</script>

<template>
  <div
    class="card-hover relative group bg-white rounded-xl p-4 border border-gray-100 shadow-sm cursor-pointer"
    @click="openUrl"
  >
    <!-- 操作按钮（悬浮时显示） -->
    <div
      class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
      @click.stop
    >
      <button
        @click="emit('edit', bookmark)"
        class="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-500 transition-colors"
        title="编辑"
      >
        <IconEdit class="w-4 h-4" />
      </button>
      <button
        @click="emit('delete', bookmark.id)"
        class="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors"
        title="删除"
      >
        <IconDelete class="w-4 h-4" />
      </button>
    </div>

    <!-- 网站图标 -->
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
        <img
          v-if="favicon"
          :src="favicon"
          :alt="bookmark.name"
          class="w-6 h-6"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
        <span v-else class="text-lg">🌐</span>
      </div>

      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold text-gray-800 truncate">
          {{ bookmark.name }}
        </h3>
        <p v-if="bookmark.description" class="text-xs text-gray-500 mt-0.5 truncate">
          {{ bookmark.description }}
        </p>
      </div>
    </div>
  </div>
</template>
