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
import IconModified from '~icons/mdi/circle-edit-outline'
import IconBranch from '~icons/mdi/source-branch'
import { useGitDashboard } from '@/features/git'
import GitDashboard from '@/components/GitDashboard.vue'

const dash = useGitDashboard()

const gitFeatureConfigured = computed(() =>
  import.meta.env.DEV && !!import.meta.env.VITE_WBSCF_WEB_ROOT?.trim(),
)
const enabled = computed(() => gitFeatureConfigured.value || !!dash.overview.value?.enabled)
const unavailable = computed(() => dash.gitUnavailable.value)
const changes = computed(() => dash.status.value.totalChanges)
const branchParts = computed(() => {
  const branch = dash.branch.value || '—'
  const cut = branch.lastIndexOf('/')
  if (cut <= 0 || cut === branch.length - 1) {
    return { scope: '', leaf: branch }
  }
  return { scope: branch.slice(0, cut + 1), leaf: branch.slice(cut + 1) }
})

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
    :aria-label="widgetTitle"
    @click="dashboardOpen = true"
  >
    <template v-if="unavailable">
      <IconBranch class="git-icon" />
      <span class="git-branch">Git 未连接</span>
      <span class="git-sync tone-danger">!</span>
    </template>
    <template v-else>
      <span class="git-icon-wrap" aria-hidden="true">
        <IconBranch class="git-icon" />
        <span class="git-led" :class="`is-${syncCue.tone}`" :title="syncCue.detail" />
      </span>
      <span class="git-branch" :title="dash.branch.value || '—'">
        <span v-if="branchParts.scope" class="git-branch-scope">{{ branchParts.scope }}</span>
        <span class="git-branch-leaf">{{ branchParts.leaf }}</span>
      </span>
      <span class="git-meta">
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
      </span>
    </template>
  </button>
  <GitDashboard v-model:open="dashboardOpen" />
</template>

<style scoped>
.git-widget {
  display: inline-flex;
  align-items: center;
  max-width: min(34vw, 360px);
  min-width: 0;
  gap: 5px;
  padding: 4px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0;
  color: rgba(224, 242, 254, 0.82);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  appearance: none;
  -webkit-appearance: none;
  overflow: hidden;
}
.git-widget:hover {
  background: rgba(0, 217, 255, 0.1);
  color: #fff;
  box-shadow:
    0 0 0 1px rgba(0, 217, 255, 0.22),
    0 6px 18px rgba(0, 217, 255, 0.16);
}
.git-widget:focus-visible {
  outline: 2px solid var(--accent, #00d9ff);
  outline-offset: 2px;
}
.git-widget.is-unavailable {
  color: #fecdd3;
}
.git-widget.is-unavailable:hover {
  background: rgba(244, 63, 94, 0.1);
}
.git-icon-wrap {
  display: inline-flex;
  align-items: center;
  color: var(--accent, #00d9ff);
  flex: 0 0 auto;
}
/* 同步状态指示灯：synced=青柠绿(运行) / ahead=琥珀 / behind=电光蓝 / danger=玫红 / muted=灰 */
.git-led {
  width: 5px;
  height: 5px;
  margin-left: 2px;
  border-radius: 999px;
  flex: 0 0 auto;
}
.git-led.is-synced { background: var(--run, #00ff94); box-shadow: 0 0 7px rgba(0, 255, 148, 0.7); }
.git-led.is-ahead { background: #fbbf24; box-shadow: 0 0 7px rgba(251, 191, 36, 0.7); }
.git-led.is-behind { background: var(--accent, #00d9ff); box-shadow: 0 0 7px rgba(0, 217, 255, 0.7); }
.git-led.is-danger { background: #fb7185; box-shadow: 0 0 7px rgba(251, 113, 133, 0.75); animation: git-led-pulse 1.2s ease-in-out infinite; }
.git-led.is-muted { background: rgba(255, 255, 255, 0.3); }
@keyframes git-led-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.git-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
.git-branch {
  display: inline-flex;
  align-items: baseline;
  min-width: 0;
  overflow: hidden;
  font: inherit;
  letter-spacing: inherit;
}
.git-branch-scope {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.55);
}
.git-branch-leaf {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: inherit;
}
.git-meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
}
.git-changes {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: #fbbf24;
  font-weight: 650;
}
.git-sync {
  font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 700;
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
  color: rgba(255, 255, 255, 0.42);
}
@media (max-width: 760px) {
  .git-widget {
    max-width: 42vw;
  }
  .git-branch-scope {
    display: none;
  }
  .git-meta {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .git-led.is-danger { animation: none; }
}
</style>
