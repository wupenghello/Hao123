<script setup lang="ts">
/**
 * 「我的任务」面板：独立列表区块（与 Bug 面板并列、互不影响）。
 * 列表项显示 #id + 标题 + 优先级/状态徽标 + 截止日期，点击打开任务详情弹窗。
 * 自身负责首次加载与刷新；未配置/加载/错误/空态均有占位。
 */
import { onMounted, onUnmounted } from 'vue'
import StateNotice from '@/components/common/StateNotice.vue'
import { useTaskStore } from '../store'
import { priorityBadge, hasDeadline } from '../../shared/ui'
import { taskStatusBadge } from '../ui'
import IconRefresh from '~icons/mdi/refresh'
import IconCheckboxOutline from '~icons/mdi/checkbox-marked-circle-outline'
import TaskDetailModal from './TaskDetailModal.vue'

const store = useTaskStore()

onMounted(() => {
  if (store.configured) store.load()
})
onUnmounted(() => store.stop())
</script>

<template>
  <section class="w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 backdrop-blur-sm overflow-hidden">
    <!-- 头部：标题 + 计数 + 刷新 -->
    <header class="flex items-center gap-2 px-4 h-11 border-b border-white/10">
      <IconCheckboxOutline class="w-4 h-4 text-sky-300/80" />
      <h2 class="text-white/90 text-sm font-medium">我的任务</h2>
      <span v-if="store.count" class="tabular-nums text-xs text-white/45">{{ store.count }}</span>

      <button
        class="ml-auto flex items-center justify-center w-7 h-7 rounded-md text-white/55 hover:text-white/90 hover:bg-white/10 transition-colors disabled:opacity-40"
        :disabled="store.loading"
        title="刷新"
        @click="store.load()"
      >
        <IconRefresh class="w-4 h-4" :class="{ 'animate-spin': store.loading }" />
      </button>
    </header>

    <!-- 内容区 -->
    <div class="max-h-[60vh] overflow-y-auto">
      <!-- 未配置 -->
      <StateNotice
        v-if="!store.configured"
        tone="warning"
        title="禅道连接未配置"
        message="请在 .env 中设置连接信息后重启 dev。"
        :details="['VITE_ZENTAO_BASE', 'VITE_ZENTAO_ACCOUNT / VITE_ZENTAO_PASSWORD']"
      />

      <!-- 加载中（首次，无数据） -->
      <StateNotice
        v-else-if="store.loading && !store.count"
        tone="loading"
        :title="store.loggingIn ? '正在登录禅道' : '正在加载任务'"
        :message="store.loggingIn ? '正在建立会话并同步指派给你的任务。' : '正在刷新禅道任务清单。'"
      />

      <!-- 错误 -->
      <StateNotice
        v-else-if="store.error"
        tone="danger"
        title="任务同步失败"
        :message="store.error"
        action-label="重试"
        @action="store.load()"
      />

      <!-- 列表 -->
      <ul v-else>
        <li v-if="!store.tasks.length">
          <StateNotice tone="empty" title="没有指派给我的任务" message="任务同步正常，当前没有待处理项。" compact />
        </li>
        <li
          v-for="t in store.tasks"
          :key="t.id"
          class="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/[0.06] cursor-pointer transition-colors"
          @click="store.openDetail(t.id)"
        >
          <span class="text-white/30 text-xs tabular-nums shrink-0 w-12">#{{ t.id }}</span>
          <span class="flex-1 min-w-0 truncate text-sm text-white/85">{{ t.name }}</span>
          <span
            v-if="priorityBadge(t.pri)"
            class="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium ring-1 ring-inset"
            :class="priorityBadge(t.pri)!.class"
          >{{ priorityBadge(t.pri)!.label }}</span>
          <span
            class="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium ring-1 ring-inset"
            :class="taskStatusBadge(t.status).class"
          >{{ taskStatusBadge(t.status).label }}</span>
          <span
            v-if="hasDeadline(t.deadline)"
            class="shrink-0 text-[11px] text-white/40 tabular-nums w-20 text-right"
          >{{ t.deadline }}</span>
        </li>
      </ul>
    </div>

    <!-- 详情弹窗（点击列表项打开） -->
    <TaskDetailModal />
  </section>
</template>
