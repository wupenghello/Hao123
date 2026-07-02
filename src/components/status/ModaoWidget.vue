<script setup lang="ts">
import { computed, onMounted } from 'vue'
import IconPrototype from '~icons/mdi/vector-square'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconLoading from '~icons/mdi/loading'
import { modaoConfigured, useModaoDashboard } from '@/features/modao'
import ModaoDashboard from '@/features/modao/components/ModaoDashboard.vue'

const dash = useModaoDashboard()

const enabled = computed(() => import.meta.env.DEV && modaoConfigured)
const unavailable = computed(() => dash.status.value?.enabled === false)
const label = computed(() => dash.currentTitle.value || dash.projectLabel)
const title = computed(() => {
  if (unavailable.value) return dash.status.value?.note || '墨刀读取不可用'
  if (!dash.renderReady.value) return '项目迭代原型：当前仅元数据可用，未检测到本地 Edge/Chrome 渲染'
  if (dash.loading.value) return '项目迭代原型：正在启动预取'
  return '项目迭代原型：点击查看已读取内容'
})
const dashboardOpen = computed({
  get: () => dash.open.value,
  set: (v: boolean) => { dash.open.value = v },
})

onMounted(() => {
  if (enabled.value) void dash.boot()
})
</script>

<template>
  <button
    v-if="enabled"
    type="button"
    class="modao-widget"
    :class="{ 'is-unavailable': unavailable }"
    :title="title"
    :aria-label="title"
    @click="dashboardOpen = true"
  >
    <IconPrototype class="modao-icon" />
    <span class="modao-label">{{ label }}</span>
    <IconLoading v-if="dash.loading.value" class="modao-warn modao-spin" />
    <IconAlert v-if="!dash.renderReady.value" class="modao-warn" />
  </button>
  <ModaoDashboard v-if="enabled" v-model:open="dashboardOpen" />
</template>

<style scoped>
.modao-widget {
  display: inline-flex;
  align-items: center;
  max-width: min(22vw, 190px);
  min-width: 0;
  gap: 5px;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(224, 242, 254, 0.86);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  overflow: hidden;
  transition: background-color 0.15s, color 0.15s, box-shadow 0.15s;
}
.modao-widget:hover {
  background: rgba(125, 211, 252, 0.1);
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.16);
}
.modao-widget:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.55);
  outline-offset: 2px;
}
.modao-widget.is-unavailable {
  color: #fecdd3;
}
.modao-icon,
.modao-warn {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
.modao-warn {
  color: #fcd34d;
}
.modao-spin {
  animation: modao-spin 0.9s linear infinite;
}
@keyframes modao-spin {
  to {
    transform: rotate(360deg);
  }
}
.modao-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 760px) {
  .modao-widget {
    max-width: 26vw;
  }
}
</style>
