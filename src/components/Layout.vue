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
    <header class="relative z-20 pt-8 pb-4 px-4">
      <div class="max-w-3xl mx-auto text-center">
        <h1 class="text-2xl font-medium text-white/90 mb-5 tracking-wide">
          Hao123 工作台
        </h1>
        <SearchBar />
      </div>
    </header>

    <!-- 主内容区域 -->
    <main class="flex-1 px-4 pb-8 overflow-y-auto">
      <div class="max-w-5xl mx-auto">
        <div class="glass rounded-3xl p-8 shadow-lg">
          <BookmarkGrid />
          <BookmarkForm />
        </div>
      </div>
    </main>

    <!-- 右上角状态栏（天气 + 时间） -->
    <StatusBar />
  </div>
</template>
