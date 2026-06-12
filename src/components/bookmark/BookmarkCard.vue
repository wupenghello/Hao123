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
    class="bookmark-card group relative cursor-pointer rounded-2xl p-4 flex flex-col items-center text-center transition-all duration-300 ease-out"
    @click="openUrl"
  >
    <!-- 操作按钮（悬浮时显示） -->
    <div
      class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10"
      @click.stop
    >
      <button
        @click="emit('edit', bookmark)"
        class="p-1.5 rounded-xl text-white/70 hover:text-white hover:bg-white/20 transition-colors"
        title="编辑"
      >
        <IconEdit class="w-3.5 h-3.5" />
      </button>
      <button
        @click="emit('delete', bookmark.id)"
        class="p-1.5 rounded-xl text-white/70 hover:text-red-300 hover:bg-red-500/20 transition-colors"
        title="删除"
      >
        <IconDelete class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- 图标 -->
    <div class="w-14 h-14 flex items-center justify-center flex-shrink-0 overflow-hidden mb-3 transition-transform duration-300 group-hover:scale-110">
      <img
        v-if="favicon"
        :src="favicon"
        :alt="bookmark.name"
        class="w-8 h-8"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <span v-else class="text-2xl">🌐</span>
    </div>

    <!-- 名称 -->
    <p class="text-sm font-medium text-white/90 leading-tight truncate w-full">
      {{ bookmark.name }}
    </p>
  </div>
</template>

<style scoped>
.bookmark-card {
  background: rgba(255, 255, 255, 0.04);
}

.bookmark-card:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}
</style>
