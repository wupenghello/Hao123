<script setup lang="ts">
/**
 * 「我的 Bug」面板：独立列表区块（与任务面板并列、互不影响）。
 * 列表项显示 #id + 标题 + 严重度/优先级/状态徽标，点击打开 Bug 详情弹窗。
 * 自身负责首次加载与刷新；未配置/加载/错误/空态均有占位。
 */
import { onMounted, onUnmounted } from 'vue'
import { useBugStore } from '../store'
import { priorityBadge } from '../../shared/ui'
import { bugStatusBadge, severityBadge } from '../ui'
import IconLoading from '~icons/mdi/loading'
import IconRefresh from '~icons/mdi/refresh'
import IconBug from '~icons/mdi/bug-outline'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconInboxOutline from '~icons/mdi/inbox-outline'
import BugDetailModal from './BugDetailModal.vue'

const store = useBugStore()

onMounted(() => {
  if (store.configured) store.load()
})
onUnmounted(() => store.stop())
</script>

<template>
  <section class="w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 backdrop-blur-sm overflow-hidden">
    <!-- 头部：标题 + 计数 + 刷新 -->
    <header class="flex items-center gap-2 px-4 h-11 border-b border-white/10">
      <IconBug class="w-4 h-4 text-rose-300/80" />
      <h2 class="text-white/90 text-sm font-medium">我的 Bug</h2>
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
      <div v-if="!store.configured" class="flex flex-col items-center gap-2 py-12 text-center text-white/50">
        <IconAlert class="w-7 h-7 text-amber-300/70" />
        <p class="text-sm">未配置禅道连接信息</p>
        <p class="text-xs text-white/40">请在 .env 中设置 VITE_ZENTAO_BASE / ACCOUNT / PASSWORD 后重启 dev</p>
      </div>

      <!-- 加载中（首次，无数据） -->
      <div
        v-else-if="store.loading && !store.count"
        class="flex flex-col items-center gap-2 py-12 text-white/50"
      >
        <IconLoading class="w-6 h-6 animate-spin" />
        <p class="text-sm">{{ store.loggingIn ? '正在登录禅道…' : '加载中…' }}</p>
      </div>

      <!-- 错误 -->
      <div v-else-if="store.error" class="flex flex-col items-center gap-2 py-12 text-center text-white/55">
        <IconAlert class="w-7 h-7 text-rose-300/70" />
        <p class="text-sm">{{ store.error }}</p>
        <button class="mt-1 px-3 h-7 rounded-md text-xs bg-white/10 text-white/80 hover:bg-white/15" @click="store.load()">
          重试
        </button>
      </div>

      <!-- 列表 -->
      <ul v-else>
        <li v-if="!store.bugs.length" class="flex flex-col items-center gap-2 py-12 text-white/45">
          <IconInboxOutline class="w-7 h-7" />
          <span class="text-sm">没有指派给我的 Bug</span>
        </li>
        <li
          v-for="b in store.bugs"
          :key="b.id"
          class="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/[0.06] cursor-pointer transition-colors"
          @click="store.openDetail(b.id)"
        >
          <span class="text-white/30 text-xs tabular-nums shrink-0 w-12">#{{ b.id }}</span>
          <span class="flex-1 min-w-0 truncate text-sm text-white/85">{{ b.title }}</span>
          <span
            v-if="severityBadge(b.severity)"
            class="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium ring-1 ring-inset"
            :class="severityBadge(b.severity)!.class"
          >{{ severityBadge(b.severity)!.label }}</span>
          <span
            v-if="priorityBadge(b.pri)"
            class="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium ring-1 ring-inset"
            :class="priorityBadge(b.pri)!.class"
          >{{ priorityBadge(b.pri)!.label }}</span>
          <span
            class="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium ring-1 ring-inset"
            :class="bugStatusBadge(b.status).class"
          >{{ bugStatusBadge(b.status).label }}</span>
        </li>
      </ul>
    </div>

    <!-- 详情弹窗（点击列表项打开） -->
    <BugDetailModal />
  </section>
</template>
