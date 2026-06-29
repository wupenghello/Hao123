<script setup lang="ts">
/**
 * 工作台首页（信息仪表盘形态）
 *
 * 设计取向：首页是「工作面」而非「聊天欢迎页」。
 *   - 顶部 1 行状态条：问候 + 日期 + 一句话概览（天气/任务/Bug），替代零信息密度的 orb+tagline 块；
 *   - 每日晨报：小吴基于工作台快照生成的「今日简报」，开头一句话即「今天先抓什么」的行动建议，
 *     想细聊可在卡片底部拉起小吴——行动建议已并入晨报，不再单列一条（避免同源建议重复）；
 *   - 收件箱（指派给我的任务/Bug）= 视觉主角，占据主空间；
 *   - AI 入口不在首页中央，而是退成 Layout 里固定左下角的小药丸（见 ChatLauncher）。
 *
 * 能力 chips / 快捷卡片网格 / 独立的「下一步建议」条已移除——它们要么是「教你怎么用」的脚手架，
 * 要么与每日晨报同源同意图（已合并进晨报卡）；快捷问题保留在命令面板（ChatCommandPalette）空态。
 */
import { computed, ref, onMounted } from 'vue'
import { MorningBriefing } from '@/features/chat'
import { useWeatherStore } from '@/features/weather'
import { useTaskStore, useBugStore } from '@/features/zentao'
import { isUrgentTask, isUrgentBug } from '@/features/zentao/shared/ui'
import { useLocalTaskStore, isUrgentLocalTask } from '@/features/local-tasks'
import UnifiedInbox from '@/components/UnifiedInbox.vue'
import OnboardingGuide from '@/components/OnboardingGuide.vue'

const weather = useWeatherStore()
const taskStore = useTaskStore()
const bugStore = useBugStore()
const localStore = useLocalTaskStore()

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const dateStr = computed(() => {
  const d = new Date()
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()} ${week}`
})

// ============ 今日概览（聚合天气 + 任务 + Bug + 本地待办 为一句话情报条）============
const dailySummary = computed(() => {
  const parts: string[] = []

  if (weather.now) {
    parts.push(`${weather.now.text} ${weather.now.temp}°C`)
  }

  const tc = taskStore.assignedCount
  if (tc > 0) {
    parts.push(`${tc} 个待办任务`)
  }

  const bc = bugStore.assignedCount
  if (bc > 0) {
    const activeBugs = bugStore.assigned.filter(b => b.status === 'active').length
    parts.push(activeBugs > 0 ? `${activeBugs} 个待修 Bug` : `${bc} 个 Bug`)
  }

  const lc = localStore.openCount
  if (lc > 0) {
    parts.push(`${lc} 个本地待办`)
  }

  if (!parts.length) return null

  // 无任何待办时给一句「一切就绪」收尾；否则纯数据，不加 emoji（项目统一用 Iconify 图标）
  const prefix = tc === 0 && bc === 0 && lc === 0 ? '一切就绪，' : ''
  return prefix + parts.join(' · ')
})

// ============ 紧急项检测（禅道口径集中在 zentao/shared/ui，本地待办口径在 local-tasks/ui）============
const hasUrgentItems = computed(() =>
  taskStore.assigned.some(t => isUrgentTask(t)) ||
  bugStore.assigned.some(b => isUrgentBug(b)) ||
  localStore.open.some(t => isUrgentLocalTask(t)),
)

// ============ 首次访问引导 ============
const isFirstVisit = ref(false)
const showOnboarding = ref(false)

onMounted(() => {
  isFirstVisit.value = !localStorage.getItem('hao123-onboarding-done')
})

function finishOnboarding() {
  localStorage.setItem('hao123-onboarding-done', '1')
  showOnboarding.value = false
  // 复位「首次访问」标记，否则按钮 v-if="isFirstVisit && !showOnboarding" 会在关闭引导后立刻重现
  // （isFirstVisit 仅在 onMounted 读 localStorage 赋值，不重置则要等下次整页刷新才消失）
  isFirstVisit.value = false
}
</script>

<template>
  <!-- 外层滚动容器（body 永久 overflow:hidden，滚动必须放在这里，否则内容超出视口会被裁掉） -->
  <div class="w-full h-full overflow-y-auto">
    <div class="min-h-full flex flex-col px-6 py-6">
      <div class="mx-auto w-full max-w-3xl flex flex-col">
        <!-- 顶部状态条：问候 + 日期 + 一句话概览（低视觉权重，让收件箱成为唯一锚点） -->
        <header class="flex items-center gap-3 flex-wrap px-1">
          <span class="text-sm text-white/80 shrink-0">{{ greeting }} · {{ dateStr }}</span>
          <Transition name="guide-fade">
            <span
              v-if="dailySummary"
              class="ml-auto inline-flex items-center gap-2 text-[12.5px] text-white/50"
            >
              {{ dailySummary }}
              <span v-if="hasUrgentItems" class="welcome-urgent-dot" />
            </span>
          </Transition>
        </header>

        <!-- 每日晨报：小吴基于真实工作台快照生成的今日简报（开头即「今天先抓什么」的行动建议 + 关键事项 + 节奏提示），
             卡片底部可拉起小吴深聊——行动建议已并入晨报，不再单列一条 -->
        <MorningBriefing class="mt-3" />

        <!-- 统一收件箱 = 主角（指派给我的禅道任务/Bug + 本地待办，整合为一条清单） -->
        <div class="mt-3">
          <UnifiedInbox />
        </div>
      </div>
    </div>

    <!-- 首次访问引导（覆盖层） -->
    <Transition name="guide-fade">
      <OnboardingGuide v-if="showOnboarding" @done="finishOnboarding" />
    </Transition>
    <Transition name="guide-fade">
      <button
        v-if="isFirstVisit && !showOnboarding"
        class="welcome-onboard-btn fixed bottom-6 right-6 z-40"
        @click="showOnboarding = true"
      >
        <span>🚀 快速设置</span>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
/* 紧急点：状态条里有紧急项时脉冲提示 */
.welcome-urgent-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fb7185;
  flex-shrink: 0;
  animation: urgent-pulse 2s ease-in-out infinite;
}
@keyframes urgent-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* 首次设置按钮 */
.welcome-onboard-btn {
  padding: 8px 16px;
  border-radius: 12px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(45, 212, 191, 0.15);
  border: 1px solid rgba(94, 234, 212, 0.3);
  backdrop-filter: blur(8px);
  transition: all 0.18s;
}
.welcome-onboard-btn:hover {
  background: rgba(45, 212, 191, 0.25);
  border-color: rgba(94, 234, 212, 0.5);
  transform: translateY(-2px);
}

.guide-fade-enter-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.guide-fade-leave-active {
  transition: opacity 0.25s ease;
}
.guide-fade-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.guide-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .welcome-urgent-dot { animation: none; }
}
</style>
