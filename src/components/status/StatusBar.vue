<script setup lang="ts">
/**
 * 状态栏 —— 顶部固定栏（纯外壳）
 *
 * 本组件只负责外观与布局：
 *   - 固定高度
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
  <header class="status-bar">
    <!-- 左栏 -->
    <div class="status-bar-zone status-bar-left">
      <slot name="left" />
    </div>

    <!-- 中栏（始终居中） -->
    <div class="status-bar-zone status-bar-center">
      <slot name="center" />
    </div>

    <!-- 右栏 -->
    <div class="status-bar-zone status-bar-right">
      <slot name="right" />
    </div>
  </header>
</template>

<style scoped>
.status-bar {
  position: relative;
  z-index: 30;
  display: flex;
  width: 100%;
  height: 40px;
  flex-shrink: 0;
  align-items: stretch;
  user-select: none;
  background:
    linear-gradient(180deg, rgba(2, 6, 23, 0.88), rgba(2, 6, 23, 0.56)),
    linear-gradient(90deg, rgba(125, 211, 252, 0.08), transparent 34%, transparent 68%, rgba(94, 234, 212, 0.06));
  border-bottom: 1px solid rgba(125, 211, 252, 0.12);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.035),
    0 10px 30px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(18px) saturate(130%);
  -webkit-backdrop-filter: blur(18px) saturate(130%);
  overflow: visible;
}
.status-bar::after {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(125, 211, 252, 0.32), transparent);
  content: '';
  opacity: 0.55;
}
.status-bar-zone {
  position: relative;
  z-index: 1;
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.status-bar-left {
  flex: 1 1 auto;
  padding-left: 14px;
  padding-right: 8px;
  overflow: visible;
}
.status-bar-center {
  flex: 0 0 auto;
  justify-content: center;
  padding-inline: 8px;
}
.status-bar-right {
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 12px;
  padding-left: 8px;
  padding-right: 14px;
}
.status-bar-right :slotted(*) {
  flex-shrink: 0;
}
@media (max-width: 1320px) {
  .status-bar-center {
    display: none;
  }
}
@media (max-width: 720px) {
  .status-bar {
    height: 40px;
  }
  .status-bar-left {
    padding-left: 10px;
  }
  .status-bar-right {
    padding-right: 10px;
    gap: 6px;
  }
}
</style>
