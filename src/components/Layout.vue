<script setup lang="ts">
import { provideBookmarkEditor } from '@/composables/useBookmarkEditor'
import SearchBar from '@/components/search/SearchBar.vue'
import BookmarkGrid from '@/components/bookmark/BookmarkGrid.vue'
import BookmarkForm from '@/components/bookmark/BookmarkForm.vue'
import StatusBar from '@/components/status/StatusBar.vue'

provideBookmarkEditor()
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- 顶部搜索区域 -->
    <header class="relative z-20 pt-8 pb-6 px-4">
      <div class="max-w-3xl mx-auto text-center">
        <h1 class="text-2xl font-medium text-white/90 mb-5 tracking-wide">
          Hao123 工作台
        </h1>
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

    <!-- 右上角状态栏（天气 + 时间） -->
    <StatusBar />
  </div>
</template>
