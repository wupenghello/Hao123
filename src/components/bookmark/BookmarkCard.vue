<script setup lang="ts">
import { toRef } from 'vue'
import { useFavicon } from '@/composables/useFavicon'
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

const { faviconUrl, showLetter, letterColor } = useFavicon(toRef(props, 'bookmark'))

/** 书签名首字符（用于字母 fallback） */
function firstChar(name: string): string {
  return name.charAt(0).toUpperCase()
}

function openUrl() {
  window.open(props.bookmark.url, '_blank')
}
</script>

<template>
  <div
    class="bookmark-card group relative cursor-pointer rounded-2xl p-3 sm:p-4 flex flex-col items-center text-center transition-all duration-300 ease-out"
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
    <div class="w-10 h-10 sm:w-14 sm:h-14 flex items-center justify-center flex-shrink-0 overflow-hidden mb-2 sm:mb-3 transition-transform duration-300 group-hover:scale-110">
      <!-- 字母 fallback -->
      <span
        v-if="showLetter"
        class="letter-avatar w-8 h-8 sm:w-8 sm:h-8 flex items-center justify-center rounded-xl text-white text-sm font-bold select-none"
        :style="{ backgroundColor: letterColor }"
      >
        {{ firstChar(bookmark.name) }}
      </span>
      <!-- Favicon 图片 -->
      <img
        v-else-if="faviconUrl"
        :src="faviconUrl"
        :alt="bookmark.name"
        class="w-8 h-8"
        style="image-rendering: -webkit-optimize-contrast"
        @error="showLetter = true; faviconUrl = null"
      />
    </div>

    <!-- 名称 -->
    <p class="text-xs sm:text-sm font-medium text-white/90 leading-tight truncate w-full">
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

.letter-avatar {
  letter-spacing: 0;
  line-height: 1;
}
</style>
