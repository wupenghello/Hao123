<script setup lang="ts">
/**
 * Bars —— 纯 CSS 微条形图（无轴无坐标系，与 Sparkline 同级原语）
 *
 * 用途：提交频次 / 分布这类「一眼看高低」的微型可视化。
 * 真坐标系图表（多序列 / tooltip / 缩放）请用 viz/echarts/BaseChart。
 * 无障碍：aria-hidden 装饰，由父组件用文字说明数据含义。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 数值序列（等宽条，高度按最大值归一） */
    data: number[]
    /** 条形主色（CSS 字面量），默认主色 */
    tone?: string
    /** 画布高度 px，默认 48 */
    height?: number
    /** 每条标签（hover title 提示用） */
    labels?: string[]
  }>(),
  {
    tone: 'var(--color-accent)',
    height: 48,
    labels: () => [],
  },
)

/** 归一化分母（全 0 时兜底 1，避免除零） */
const hi = computed(() => Math.max(1, ...props.data))
</script>

<template>
  <div class="bars" :style="{ height: `${height}px` }" aria-hidden="true">
    <div
      v-for="(v, i) in data"
      :key="i"
      class="bars-col"
      :title="labels[i] ? `${labels[i]} · ${v}` : String(v)"
    >
      <div
        class="bars-bar"
        :style="{
          height: `${Math.max(4, (v / hi) * 100)}%`,
          background: `linear-gradient(180deg, ${tone}, color-mix(in srgb, ${tone} 10%, transparent))`,
        }"
      />
    </div>
  </div>
</template>

<style scoped>
.bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
}
.bars-col {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.bars-bar {
  width: 100%;
  border-radius: 2px 2px 0 0;
  transition: height var(--duration-base) var(--ease-out-expo);
}
@media (prefers-reduced-motion: reduce) {
  .bars-bar {
    transition: none;
  }
}
</style>
