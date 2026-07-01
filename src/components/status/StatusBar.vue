<script setup lang="ts">
/**
 * 状态栏 —— 顶部固定栏（纯外壳）
 *
 * 本组件只负责外观与布局：
 *   - 固定高度（h-9）
 *   - 三栏插槽布局
 *
 * 具体显示内容由具名插槽注入，便于后续按需追加显示组件：
 *   - #left   左栏（品牌 / 导航 / 快捷入口）
 *   - #center 中栏（居中的状态指示）
 *   - #right  右栏（天气 / 时间 / 其它）
 *
 * 新增内容组件时：直接在 Layout.vue 对应插槽内加一行即可，无需改动本文件。
 */
</script>

<template>
  <header
    class="status-bar relative z-30 h-9 shrink-0 w-full flex items-stretch select-none"
  >
    <!-- 左栏 -->
    <div class="flex flex-1 items-center gap-3 min-w-0 px-3 sm:px-4">
      <slot name="left" />
    </div>

    <!-- 中栏（始终居中） -->
    <div class="flex flex-1 items-center justify-center gap-3 min-w-0">
      <slot name="center" />
    </div>

    <!-- 右栏 -->
    <div class="flex flex-1 items-center justify-end gap-3 min-w-0 px-3 sm:px-4">
      <slot name="right" />
    </div>
  </header>
</template>

<style scoped>
.status-bar {
  background:
    linear-gradient(180deg, rgba(2, 6, 23, 0.82), rgba(2, 6, 23, 0.46)),
    linear-gradient(90deg, rgba(125, 211, 252, 0.12), transparent 28%, transparent 72%, rgba(94, 234, 212, 0.1));
  border-bottom: 1px solid var(--hud-line);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 12px 40px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(18px) saturate(130%);
}
.status-bar::before {
  content: '';
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(125, 211, 252, 0.58), rgba(94, 234, 212, 0.38), transparent);
  opacity: 0.62;
}
</style>
