<script setup lang="ts">
/**
 * 首页待办提醒（指派给我的任务 / Bug）
 *
 * 把「指派给我」(assignedTo) 的任务与 Bug 合并成一个待办清单，放在首页第一屏，
 * 让用户进来即看到「有什么压在手上」。每条可点击 → 复用各自模块的详情弹窗
 * （TaskDetailModal / BugDetailModal，监听对应 store.detailOpen）。
 *
 * 样式统一到项目玻璃面板语言（rounded-xl + bg-white/[0.04] + ring-white/10），
 * 与禅道面板、状态栏一致。未配置 / 空态时整体不渲染（由父组件用 v-if 控制或自身判空）。
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { useTaskStore } from '../task'
import { useBugStore } from '../bug'
import { priorityBadge, hasDeadline, isOverdue, isUrgentTask, isUrgentBug } from '../shared/ui'
import { taskStatusBadge } from '../task/ui'
import { bugStatusBadge, severityBadge } from '../bug/ui'
import TaskDetailModal from '../task/components/TaskDetailModal.vue'
import BugDetailModal from '../bug/components/BugDetailModal.vue'
import IconCheckboxOutline from '~icons/mdi/checkbox-marked-circle-outline'
import IconBug from '~icons/mdi/bug-outline'
import IconClipboardCheck from '~icons/mdi/clipboard-check-outline'
import IconAlert from '~icons/mdi/alert-circle-outline'

const taskStore = useTaskStore()
const bugStore = useBugStore()

const total = computed(() => taskStore.assignedCount + bugStore.assignedCount)
const loading = computed(
  () => (taskStore.assignedLoading || bugStore.assignedLoading) && !total.value,
)
/** 已加载完成（不在 loading）且没有任何待办 */
const empty = computed(
  () =>
    !loading.value &&
    !taskStore.assignedLoading &&
    !bugStore.assignedLoading &&
    total.value === 0,
)
/** 有错误（任意一个模块加载失败） */
const hasError = computed(
  () => taskStore.assignedError || bugStore.assignedError,
)
/** 统一的错误文案 */
const errorMessage = computed(() => {
  if (taskStore.assignedError) return taskStore.assignedError
  if (bugStore.assignedError) return bugStore.assignedError
  return null
})

// ============ 紧急项检测（逻辑集中在 shared/ui，与 WelcomePage 共用）============
const urgentCount = computed(() => {
  let n = 0
  for (const t of taskStore.assigned) {
    if (isUrgentTask(t)) n++
  }
  for (const b of bugStore.assigned) {
    if (isUrgentBug(b)) n++
  }
  return n
})

onMounted(() => {
  if (taskStore.configured) taskStore.loadAssigned()
  if (bugStore.configured) bugStore.loadAssigned()
})
onUnmounted(() => {
  taskStore.stop()
  bugStore.stop()
})
</script>

<template>
  <section class="w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 backdrop-blur-sm overflow-hidden">
    <!-- 头部 -->
    <header class="flex items-center gap-2 px-4 h-11 border-b border-white/10">
      <span class="zt-inbox-pulse" :class="{ 'is-active': total > 0, 'is-urgent': urgentCount > 0 }" />
      <h2 class="text-white/90 text-sm font-medium">指派给我</h2>
      <span
        v-if="total"
        class="tabular-nums text-[11px] font-medium px-1.5 py-0.5 rounded-full text-teal-200 bg-teal-400/15 ring-1 ring-teal-400/25"
      >{{ total }}</span>
      <span
        v-if="urgentCount > 0"
        class="tabular-nums text-[11px] font-medium px-1.5 py-0.5 rounded-full text-rose-200 bg-rose-400/15 ring-1 ring-rose-400/25"
      >{{ urgentCount }} 紧急</span>
      <span v-if="taskStore.configured && bugStore.configured" class="ml-auto text-[11px] text-white/35">
        {{ taskStore.assignedCount }} 任务 · {{ bugStore.assignedCount }} Bug
      </span>
    </header>

    <!-- 未配置 -->
    <div v-if="!taskStore.configured && !bugStore.configured" class="flex flex-col items-center gap-2 py-8 text-center text-white/50">
      <IconAlert class="w-7 h-7 text-amber-300/70" />
      <p class="text-sm">未配置禅道连接信息</p>
      <p class="text-xs text-white/40">请在 .env 中设置 VITE_ZENTAO_BASE / ACCOUNT / PASSWORD 后重启 dev</p>
    </div>

    <!-- 加载中 -->
    <div v-else-if="loading" class="px-4 py-8 text-center text-sm text-white/45">
      {{ taskStore.loggingIn || bugStore.loggingIn ? '正在登录禅道…' : '加载中…' }}
    </div>

    <!-- 错误 -->
    <div v-else-if="hasError" class="flex flex-col items-center gap-2 py-8 text-center text-white/55">
      <IconAlert class="w-7 h-7 text-rose-300/70" />
      <p class="text-sm">{{ errorMessage }}</p>
      <button
        class="mt-1 px-3 h-7 rounded-md text-xs bg-white/10 text-white/80 hover:bg-white/15"
        @click="taskStore.loadAssigned(); bugStore.loadAssigned()"
      >
        重试
      </button>
    </div>

    <!-- 空态：清闲卡片（图标光晕 + 标题 + 副文案），撑起首页主角的视觉分量 -->
    <div v-else-if="empty" class="zt-inbox-empty">
      <span class="zt-inbox-empty-icon">
        <IconClipboardCheck class="w-6 h-6" />
      </span>
      <p class="zt-inbox-empty-title">没有指派给你的任务或 Bug</p>
      <p class="zt-inbox-empty-sub">新的指派会出现在这里，趁现在喘口气</p>
    </div>

    <!-- 待办列表（任务在前、Bug 在后） -->
    <ul v-else class="max-h-[42vh] overflow-y-auto">
      <li
        v-for="t in taskStore.assigned"
        :key="`task-${t.id}`"
        class="zt-inbox-row"
        :class="{ 'is-urgent': isUrgentTask(t) }"
        @click="taskStore.openDetail(t.id)"
      >
        <IconCheckboxOutline class="w-4 h-4 text-sky-300/80 shrink-0" />
        <span class="zt-inbox-kind text-sky-200/90 bg-sky-400/10">任务</span>
        <span class="flex-1 min-w-0 truncate text-sm text-white/85">{{ t.name }}</span>
        <span
          v-if="isOverdue(t.deadline)"
          class="zt-inbox-badge ring-1 ring-inset text-rose-300 bg-rose-400/10 ring-rose-400/30"
        >逾期</span>
        <span
          v-if="priorityBadge(t.pri)"
          class="zt-inbox-badge ring-1 ring-inset"
          :class="priorityBadge(t.pri)!.class"
        >{{ priorityBadge(t.pri)!.label }}</span>
        <span class="zt-inbox-badge ring-1 ring-inset" :class="taskStatusBadge(t.status).class">
          {{ taskStatusBadge(t.status).label }}
        </span>
        <span
          v-if="hasDeadline(t.deadline)"
          class="hidden sm:inline shrink-0 text-[11px] text-white/40 tabular-nums w-[4.5rem] text-right"
          :class="{ '!text-rose-300/80': isOverdue(t.deadline) }"
        >{{ t.deadline }}</span>
      </li>

      <li
        v-for="b in bugStore.assigned"
        :key="`bug-${b.id}`"
        class="zt-inbox-row"
        :class="{ 'is-urgent': isUrgentBug(b) }"
        @click="bugStore.openDetail(b.id)"
      >
        <IconBug class="w-4 h-4 text-rose-300/80 shrink-0" />
        <span class="zt-inbox-kind text-rose-200/90 bg-rose-400/10">Bug</span>
        <span class="flex-1 min-w-0 truncate text-sm text-white/85">{{ b.title }}</span>
        <span
          v-if="severityBadge(b.severity)"
          class="zt-inbox-badge ring-1 ring-inset"
          :class="severityBadge(b.severity)!.class"
        >{{ severityBadge(b.severity)!.label }}</span>
        <span class="zt-inbox-badge ring-1 ring-inset" :class="bugStatusBadge(b.status).class">
          {{ bugStatusBadge(b.status).label }}
        </span>
      </li>
    </ul>

    <!-- 详情弹窗（点击行打开，复用各模块自身的 Modal） -->
    <TaskDetailModal />
    <BugDetailModal />
  </section>
</template>

<style scoped>
.zt-inbox-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  cursor: pointer;
  transition: background-color 0.15s;
}
.zt-inbox-row:last-child {
  border-bottom: 0;
}
.zt-inbox-row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.zt-inbox-row.is-urgent {
  background: rgba(244, 63, 94, 0.04);
  border-left: 2px solid rgba(244, 63, 94, 0.5);
  padding-left: 14px;
}
.zt-inbox-row.is-urgent:hover {
  background: rgba(244, 63, 94, 0.08);
}

.zt-inbox-kind {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 5px;
}

.zt-inbox-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
}

/* 空态：清闲卡片 —— 无待办时撑起主角视觉分量，沿用 header 脉冲的青色调，不喧宾夺主 */
.zt-inbox-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 36px 16px;
  text-align: center;
}
.zt-inbox-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-bottom: 4px;
  border-radius: 9999px;
  color: #5eead4;
  background: rgba(45, 212, 191, 0.1);
  box-shadow: 0 0 22px rgba(45, 212, 191, 0.15);
}
.zt-inbox-empty-title {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.72);
}
.zt-inbox-empty-sub {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.4);
}

/* 头部状态点：有待办时青色脉冲，无则灰静止 */
.zt-inbox-pulse {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: rgba(148, 163, 184, 0.5);
  flex-shrink: 0;
}
.zt-inbox-pulse.is-active {
  background: #2dd4bf;
  box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.6);
  animation: zt-inbox-ping 2s ease-out infinite;
}
.zt-inbox-pulse.is-urgent {
  background: #fb7185;
  box-shadow: 0 0 0 0 rgba(251, 113, 133, 0.6);
  animation: zt-inbox-ping-urgent 2s ease-out infinite;
}
@keyframes zt-inbox-ping {
  0% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.5); }
  70% { box-shadow: 0 0 0 7px rgba(45, 212, 191, 0); }
  100% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0); }
}
@keyframes zt-inbox-ping-urgent {
  0% { box-shadow: 0 0 0 0 rgba(251, 113, 133, 0.5); }
  70% { box-shadow: 0 0 0 7px rgba(251, 113, 133, 0); }
  100% { box-shadow: 0 0 0 0 rgba(251, 113, 133, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .zt-inbox-pulse.is-active,
  .zt-inbox-pulse.is-urgent { animation: none; }
}
</style>
