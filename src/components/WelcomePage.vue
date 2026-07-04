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
        <span class="welcome-onboard-led" aria-hidden="true" />
        <span>快速设置</span>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.welcome-shell {
  --home-tone: #22d3ee;
  --home-tone-2: #a78bfa;
  --home-success: #34d399;
  --home-warning: #fbbf24;
  --home-danger: #fb7185;
  --home-border: rgba(148, 163, 184, 0.16);
  --home-text: rgba(248, 250, 252, 0.92);
  --home-muted: rgba(226, 232, 240, 0.52);
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 18px;
  color: var(--home-text);
}
.welcome-shell::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    radial-gradient(circle at 18% 8%, color-mix(in srgb, var(--home-tone) 13%, transparent), transparent 32%),
    radial-gradient(circle at 88% 82%, color-mix(in srgb, var(--home-tone-2) 10%, transparent), transparent 34%);
}
.welcome-shell::after {
  position: absolute;
  inset: 18px;
  pointer-events: none;
  content: '';
  border: 1px solid color-mix(in srgb, var(--home-tone) 12%, transparent);
  border-radius: 16px;
  background:
    linear-gradient(90deg, rgba(255,255,255,0.026) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: linear-gradient(135deg, rgba(0,0,0,0.5), transparent 62%);
  opacity: 0.9;
}
.welcome-grid {
  position: relative;
  z-index: 1;
  display: grid;
  width: 100%;
  height: 100%;
  grid-template-columns: minmax(304px, 24vw) minmax(0, 1fr);
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
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.24) transparent;
}
.welcome-left::-webkit-scrollbar { width: 6px; }
.welcome-left::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.24);
  border-radius: 999px;
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
  padding: 17px;
  border: 1px solid color-mix(in srgb, var(--home-tone) 18%, var(--home-border));
  border-radius: 12px;
  background:
    radial-gradient(circle at 18px 18px, color-mix(in srgb, var(--home-tone) 16%, transparent), transparent 64px),
    linear-gradient(135deg, color-mix(in srgb, var(--home-tone) 8%, transparent), transparent 40%),
    rgba(2, 6, 23, 0.34);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.055),
    0 18px 54px rgba(0,0,0,0.22);
  backdrop-filter: blur(18px) saturate(130%);
}
.welcome-status-card::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--home-tone), transparent);
  opacity: 0.76;
}
.welcome-status-card::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, rgba(255,255,255,0.042) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255,255,255,0.032) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: linear-gradient(120deg, rgba(0,0,0,0.46), transparent 64%);
}
.welcome-status-card > * {
  position: relative;
  z-index: 1;
}
.welcome-status-kicker {
  margin: 0 0 8px;
  color: color-mix(in srgb, var(--home-tone) 78%, white 5%);
  font: 850 10px/1 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.welcome-status-title {
  margin: 0;
  color: rgba(248, 250, 252, 0.96);
  font-size: 21px;
  font-weight: 850;
  line-height: 1.12;
  letter-spacing: -0.02em;
  text-shadow: 0 0 20px color-mix(in srgb, var(--home-tone) 18%, transparent);
}
.welcome-status-summary {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 0;
  color: rgba(226, 232, 240, 0.64);
  font-size: 12.5px;
  line-height: 1.55;
}
.welcome-briefing {
  flex-shrink: 0;
}
.welcome-urgent-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--home-danger);
  animation: urgent-pulse 2s ease-in-out infinite;
}
@keyframes urgent-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(251, 113, 133, 0.45); opacity: 1; }
  70% { box-shadow: 0 0 0 7px rgba(251, 113, 133, 0); }
}
.welcome-onboard-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid color-mix(in srgb, var(--home-tone) 34%, transparent);
  border-radius: 999px;
  background:
    radial-gradient(circle at 30% 0, rgba(255,255,255,0.2), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--home-tone) 16%, rgba(2,6,23,0.84)), rgba(2,6,23,0.72));
  color: rgba(236, 254, 255, 0.92);
  font-size: 13px;
  font-weight: 800;
  box-shadow:
    0 14px 36px color-mix(in srgb, var(--home-tone) 14%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.1);
  backdrop-filter: blur(12px) saturate(130%);
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}
.welcome-onboard-btn:hover,
.welcome-onboard-btn:focus-visible {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--home-tone) 52%, transparent);
  background:
    radial-gradient(circle at 30% 0, rgba(255,255,255,0.25), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--home-tone) 22%, rgba(2,6,23,0.84)), rgba(2,6,23,0.76));
  outline: 0;
}
.welcome-onboard-led {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--home-tone);
  box-shadow: 0 0 12px color-mix(in srgb, var(--home-tone) 62%, transparent);
}
.guide-fade-enter-active { transition: opacity 0.4s ease, transform 0.4s ease; }
.guide-fade-leave-active { transition: opacity 0.25s ease; }
.guide-fade-enter-from { opacity: 0; transform: translateY(-6px); }
.guide-fade-leave-to { opacity: 0; }
@media (max-width: 980px) {
  .welcome-shell {
    overflow-y: auto;
    padding: 16px;
  }
  .welcome-shell::after { inset: 16px; }
  .welcome-grid {
    height: auto;
    min-height: 100%;
    grid-template-columns: 1fr;
  }
  .welcome-left {
    overflow: visible;
    padding-right: 0;
  }
  .welcome-right { min-height: 640px; }
}
@media (prefers-reduced-motion: reduce) {
  .welcome-urgent-dot { animation: none; }
  .welcome-onboard-btn,
  .guide-fade-enter-active,
  .guide-fade-leave-active { transition: none; }
  .welcome-onboard-btn:hover { transform: none; }
}
</style>
