<script setup lang="ts">
import { provideBookmarkEditor } from '@/composables/useBookmarkEditor'
import SearchBar from '@/components/search/SearchBar.vue'
import BookmarkGrid from '@/components/bookmark/BookmarkGrid.vue'
import BookmarkForm from '@/components/bookmark/BookmarkForm.vue'
import CommandPalette from '@/components/command/CommandPalette.vue'
import StatusBar from '@/components/status/StatusBar.vue'

provideBookmarkEditor()
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- 顶部搜索区域 -->
    <header class="relative z-20 pt-14 sm:pt-8 pb-4 sm:pb-6 px-4">
      <div class="max-w-3xl mx-auto text-center">
        <SearchBar />
      </div>
    </header>

    <!-- 主内容区域 — 直接浮在渐变背景上 -->
    <main class="flex-1 px-4 pb-8 overflow-y-auto">
      <div class="max-w-5xl mx-auto">
        <BookmarkGrid />
        <BookmarkForm />
      </div>
    </main>

    <!-- 书签快速搜索面板 -->
    <CommandPalette />

    <!-- 右上角状态栏（天气 + 时间） -->
    <StatusBar />
  </div>
</template>
