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

const gitFeatureConfigured = computed(() =>
  import.meta.env.DEV && !!import.meta.env.VITE_WBSCF_WEB_ROOT?.trim(),
)
const enabled = computed(() => gitFeatureConfigured.value || !!dash.overview.value?.enabled)
const unavailable = computed(() => dash.gitUnavailable.value)
const changes = computed(() => dash.status.value.totalChanges)

const syncCue = computed(() => {
  const sync = dash.sync.value
  if (!sync.hasUpstream) {
    return { text: '无上游', tone: 'muted', detail: '当前分支尚未设置 upstream' }
  }
  if (sync.ahead > 0 && sync.behind > 0) {
    return { text: `↑${sync.ahead} ↓${sync.behind}`, tone: 'danger', detail: `本地领先 ${sync.ahead} 个提交，落后 ${sync.behind} 个提交` }
  }
  if (sync.ahead > 0) {
    return { text: `↑${sync.ahead}`, tone: 'ahead', detail: `本地有 ${sync.ahead} 个提交待推送` }
  }
  if (sync.behind > 0) {
    return { text: `↓${sync.behind}`, tone: 'behind', detail: `远端有 ${sync.behind} 个提交待拉取` }
  }
  return { text: '', tone: 'synced', detail: '当前分支已与远端同步' }
})

const widgetTitle = computed(() => {
  if (unavailable.value) return dash.error.value || 'Git 未连接，点击查看配置提示'
  const branch = dash.branch.value || '—'
  const changeText = changes.value > 0 ? `${changes.value} 个未提交变更` : '工作区干净'
  return `查看 wbscf-web 仓库信息：${branch} · ${changeText} · ${syncCue.value.detail}`
})

const dashboardOpen = computed({
  get: () => dash.open.value,
  set: (v: boolean) => { dash.open.value = v },
})

onMounted(() => {
  if (gitFeatureConfigured.value) dash.startWidgetPolling()
})
onUnmounted(() => dash.stopWidgetPolling())
</script>

<template>
  <button
    v-if="enabled"
    class="git-widget"
    :class="{ 'is-unavailable': unavailable }"
    :title="widgetTitle"
    @click="dashboardOpen = true"
  >
    <IconGit class="w-3.5 h-3.5" />
    <template v-if="unavailable">
      <span class="git-branch">Git 未连接</span>
      <span class="git-sync tone-danger">!</span>
    </template>
    <template v-else>
      <span class="git-branch">{{ dash.branch.value }}</span>
      <span v-if="changes > 0" class="git-changes" title="未提交变更">
        <IconModified class="w-3 h-3" />
        {{ changes }}
      </span>
      <span
        v-if="syncCue.text"
        class="git-sync"
        :class="`tone-${syncCue.tone}`"
        :title="syncCue.detail"
      >{{ syncCue.text }}</span>
    </template>
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
.git-widget.is-unavailable {
  background: rgba(244, 63, 94, 0.08);
  border-color: rgba(244, 63, 94, 0.22);
  color: #fecdd3;
}
.git-widget.is-unavailable:hover {
  background: rgba(244, 63, 94, 0.13);
  border-color: rgba(244, 63, 94, 0.34);
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
.git-sync {
  margin-left: 2px;
  font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 600;
}
.git-sync.tone-ahead {
  color: #fbbf24;
}
.git-sync.tone-behind {
  color: #7dd3fc;
}
.git-sync.tone-danger {
  color: #fb7185;
}
.git-sync.tone-muted {
  color: rgba(255, 255, 255, 0.38);
}
</style>
