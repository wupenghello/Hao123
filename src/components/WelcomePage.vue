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
import { setLocalStorageItem } from '@/features/storage-health'
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
  setLocalStorageItem('hao123-onboarding-done', '1')
  showOnboarding.value = false
  // 复位「首次访问」标记，否则按钮 v-if="isFirstVisit && !showOnboarding" 会在关闭引导后立刻重现
  // （isFirstVisit 仅在 onMounted 读 localStorage 赋值，不重置则要等下次整页刷新才消失）
  isFirstVisit.value = false
}
</script>

<template>
  <!-- 外层固定高度容器（body 永久 overflow:hidden，内部列各自滚动，避免内容被视口裁掉） -->
  <div class="welcome-shell">
    <div class="welcome-grid">
      <aside class="welcome-left" aria-label="今日状态与简报">
        <!-- 顶部状态条：问候 + 日期 + 一句话概览，收进左侧仪表柱，右侧专注工作项 -->
        <header class="welcome-status-card">
          <div>
            <p class="welcome-status-kicker">today signal</p>
            <h1 class="welcome-status-title">{{ greeting }} · {{ dateStr }}</h1>
          </div>
          <Transition name="guide-fade">
            <p v-if="dailySummary" class="welcome-status-summary">
              {{ dailySummary }}
              <span v-if="hasUrgentItems" class="welcome-urgent-dot" />
            </p>
          </Transition>
        </header>

        <!-- 每日晨报：左侧固定情报柱，作为进入清单前的「今天先抓什么」 -->
        <MorningBriefing class="welcome-briefing" />
      </aside>

      <!-- 统一收件箱 = 主角（右侧占据剩余空间，内部自行切换清单 / 星图形态） -->
      <section class="welcome-right" aria-label="统一收件箱">
        <UnifiedInbox />
      </section>
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
/* 左右舱布局：左侧是固定情报柱，右侧是自适应工作星图 / 清单 */
.welcome-shell {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 18px;
}
.welcome-shell::before {
  content: '';
  position: absolute;
  inset: 18px;
  pointer-events: none;
  border: 1px solid rgba(125, 211, 252, 0.08);
  opacity: 0.7;
}
.welcome-grid {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(292px, 23vw) minmax(0, 1fr);
  gap: 16px;
}
.welcome-left,
.welcome-right {
  min-height: 0;
}
.welcome-left {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding-right: 2px;
}
.welcome-right {
  display: flex;
  min-width: 0;
}
.welcome-right :deep(> *) {
  min-height: 0;
  flex: 1;
}
.welcome-status-card {
  position: relative;
  overflow: hidden;
  padding: 16px;
  border-radius: 0 18px 18px 0;
  border: 1px solid var(--hud-line);
  border-left: 2px solid rgba(94, 234, 212, 0.74);
  background:
    linear-gradient(180deg, rgba(2, 6, 23, 0.74), rgba(15, 23, 42, 0.42)),
    linear-gradient(90deg, rgba(45, 212, 191, 0.1), transparent 48%),
    repeating-linear-gradient(0deg, rgba(125, 211, 252, 0.035) 0 1px, transparent 1px 32px);
  box-shadow: var(--hud-glow), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(18px) saturate(130%);
}
.welcome-status-card::after {
  content: '';
  position: absolute;
  inset: auto -20% -55% 28%;
  height: 110px;
  background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.14), rgba(45, 212, 191, 0.16), transparent);
  filter: blur(22px);
  opacity: 0.7;
  pointer-events: none;
}
.welcome-status-kicker {
  margin: 0 0 8px;
  font-family: var(--hud-font-data);
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(94, 234, 212, 0.78);
}
.welcome-status-title {
  margin: 0;
  font-size: 21px;
  line-height: 1.1;
  font-weight: 650;
  letter-spacing: -0.035em;
  color: rgba(240, 249, 255, 0.96);
  text-shadow: 0 0 20px rgba(125, 211, 252, 0.18);
}
.welcome-status-summary {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: rgba(226, 232, 240, 0.64);
}
.welcome-briefing {
  flex-shrink: 0;
}

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
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(251, 113, 133, 0.45); }
  70% { box-shadow: 0 0 0 7px rgba(251, 113, 133, 0); }
  100% { opacity: 1; box-shadow: 0 0 0 0 rgba(251, 113, 133, 0); }
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

@media (max-width: 980px) {
  .welcome-shell {
    overflow-y: auto;
    padding: 16px;
  }
  .welcome-grid {
    height: auto;
    min-height: 100%;
    grid-template-columns: 1fr;
  }
  .welcome-left {
    overflow: visible;
    padding-right: 0;
  }
  .welcome-right {
    min-height: 640px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-urgent-dot { animation: none; }
}
</style>
