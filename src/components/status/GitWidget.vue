<script setup lang="ts">
/**
 * 状态栏 Git 组件
 *
 * 在状态栏显示 wbscf-web 仓库的当前分支名和未提交变更数，
 * 点击打开 GitDashboard 查看完整仓库信息。
 *
 * 仅 dev 且配置了 VITE_WBSCF_WEB_ROOT 时显示；
 * 生产环境或未配置时整个组件不渲染。
 *
 * 通过 useGitDashboard() 单例共享状态，不再独立轮询——
 * Dashboard 打开时由 composable 统一管理轮询，关闭后自动恢复 widget 轮询。
 */
import { computed, onMounted, onUnmounted } from 'vue'
import IconGit from '~icons/mdi/source-branch'
import IconModified from '~icons/mdi/circle-edit-outline'
import { useGitDashboard } from '@/features/git'
import GitDashboard from '@/components/GitDashboard.vue'

const dash = useGitDashboard()

const enabled = computed(() => !!dash.overview.value?.enabled)
const changes = computed(() => dash.status.value.totalChanges)
const dashboardOpen = computed({
  get: () => dash.open.value,
  set: (v: boolean) => { dash.open.value = v },
})

onMounted(() => dash.startWidgetPolling())
onUnmounted(() => dash.stopWidgetPolling())
</script>

<template>
  <button
    v-if="enabled"
    class="git-widget"
    title="查看 wbscf-web 仓库信息"
    @click="dashboardOpen = true"
  >
    <IconGit class="w-3.5 h-3.5" />
    <span class="git-branch">{{ dash.branch.value }}</span>
    <span v-if="changes > 0" class="git-changes" title="未提交变更">
      <IconModified class="w-3 h-3" />
      {{ changes }}
    </span>
  </button>
  <GitDashboard v-model:open="dashboardOpen" />
</template>

<style scoped>
.git-widget {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.git-widget:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(45, 212, 191, 0.25);
  color: rgba(255, 255, 255, 0.9);
}
.git-branch {
  font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace;
  font-weight: 500;
}
.git-changes {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: #fbbf24;
  font-weight: 500;
  margin-left: 2px;
}
</style>
