<script setup lang="ts">
import { getFaviconUrl } from '@/utils/favicon'
import type { Bookmark } from '@/types'
import IconEdit from '~icons/mdi/pencil'
import IconDelete from '~icons/mdi/delete'

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
    class="icon-card relative group bg-white/70 backdrop-blur-sm rounded-2xl p-3 pb-2 border border-white/60 shadow-sm cursor-pointer flex flex-col items-center"
    @click="openUrl"
  >
    <!-- 操作按钮（悬浮时显示） -->
    <div
      class="absolute -top-1 -right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
      @click.stop
    >
      <button
        @click="emit('edit', bookmark)"
        class="p-1 rounded-full bg-white/90 shadow-sm hover:bg-blue-50 text-gray-400 hover:text-blue-500 transition-colors"
        title="编辑"
      >
        <IconEdit class="w-3 h-3" />
      </button>
      <button
        @click="emit('delete', bookmark.id)"
        class="p-1 rounded-full bg-white/90 shadow-sm hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
        title="删除"
      >
        <IconDelete class="w-3 h-3" />
      </button>
    </div>

    <!-- 图标区域 -->
    <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden mt-1 transition-transform duration-250 group-hover:scale-108">
      <img
        v-if="favicon"
        :src="favicon"
        :alt="bookmark.name"
        class="w-7 h-7"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <span v-else class="text-xl">🌐</span>
    </div>

    <!-- 名称 -->
    <p class="text-xs font-medium text-gray-700 mt-2 text-center truncate w-full leading-tight">
      {{ bookmark.name }}
    </p>
  </div>
</template>
