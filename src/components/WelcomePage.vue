<script setup lang="ts">
/**
 * 工作台首页 —— 发光深色「指挥舱」构图（全量重做，非旧 bento 修补）。
 *
 * 解剖（对齐批准的 3D 概念）：
 *   极简报头（问候 + 一句话情报 + 一句温度）／左数据柱（指派/Bug/本地，count-up）／
 *   中间 3D 数据收件箱（InboxDeck，绝对主角）／右栏（竖向队列健康仪表 + 晨报）／
 *   底部发光 dock（Dock，合并原左 icon 栏 + 顶 dev 导航 + 顶 dev 服务条）。
 * 旧六卡 bento / 顶 WbscfServicesCard / 左 NavRail 全部移除——视觉零继承旧设计。
 */
import { computed, ref, onMounted } from 'vue'
import { MorningBriefing } from '@/features/chat'
import { useWeatherStore } from '@/features/weather'
import { useTaskStore, useBugStore } from '@/features/zentao'
import { isUrgentTask, isUrgentBug } from '@/features/zentao/shared/ui'
import { useLocalTaskStore, isUrgentLocalTask } from '@/features/local-tasks'
import { useInboxInsights } from '@/features/insights'
import { setLocalStorageItem } from '@/features/storage-health'
import { useCountUp } from '@/composables/useCountUp'
import InboxDeck from '@/components/InboxDeck.vue'
import Dock from '@/components/Dock.vue'
import OnboardingGuide from '@/components/OnboardingGuide.vue'

const weather = useWeatherStore()
const taskStore = useTaskStore()
const bugStore = useBugStore()
const localStore = useLocalTaskStore()
const { summary } = useInboxInsights()

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
const dailySummary = computed(() => {
  const parts: string[] = []
  if (weather.now) parts.push(`${weather.now.text} ${weather.now.temp}°C`)
  if (taskStore.assignedCount > 0) parts.push(`${taskStore.assignedCount} 个待办任务`)
  const bc = bugStore.assignedCount
  if (bc > 0) {
    const activeBugs = bugStore.assigned.filter((b) => b.status === 'active').length
    parts.push(activeBugs > 0 ? `${activeBugs} 个待修 Bug` : `${bc} 个 Bug`)
  }
  if (localStore.openCount > 0) parts.push(`${localStore.openCount} 个本地待办`)
  if (!parts.length) return null
  const prefix = taskStore.assignedCount === 0 && bc === 0 && localStore.openCount === 0 ? '一切就绪，' : ''
  return prefix + parts.join(' · ')
})
const whisper = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了，剩下的交给明天。'
  if (h < 9) return '早，先别急——今天从最重要的那件事开始。'
  if (h < 12) return '上午脑子最清醒，把难的先啃掉。'
  if (h < 14) return '午饭后容易犯困，安排点轻省的活。'
  if (h < 18) return '下午的活，一件一件来就好。'
  if (h < 22) return '晚上适合收尾和复盘。'
  return '该歇了，硬撑的效率并不高。'
})
const hasUrgentItems = computed(() =>
  taskStore.assigned.some((t) => isUrgentTask(t)) ||
  bugStore.assigned.some((b) => isUrgentBug(b)) ||
  localStore.open.some((t) => isUrgentLocalTask(t)),
)

// 左数据柱
const signals = computed(() => [
  { key: 'task' as const, label: '指派任务', tone: 'cyan' },
  { key: 'bug' as const, label: '待修 Bug', tone: 'rose' },
  { key: 'local' as const, label: '本地待办', tone: 'teal' },
])
const signalValue = {
  task: useCountUp(() => taskStore.assignedCount),
  bug: useCountUp(() => bugStore.assignedCount),
  local: useCountUp(() => localStore.openCount),
}

// 右竖向队列健康仪表
const totalOpen = computed(() => taskStore.assignedCount + bugStore.assignedCount + localStore.openCount)
const gaugeOk = computed(() => Math.max(0, totalOpen.value - summary.value.total))
const gaugePct = computed(() => (totalOpen.value > 0 ? Math.round((gaugeOk.value / totalOpen.value) * 100) : 100))
const legend = computed(() => [
  { label: '逾期', n: summary.value.overdue, c: 'var(--color-danger)' },
  { label: '临期', n: summary.value.dueSoon, c: 'var(--color-warning)' },
  { label: '停滞', n: summary.value.stalled, c: 'var(--color-steel)' },
  { label: '正常', n: gaugeOk.value, c: 'var(--color-alive)' },
])

// 首次访问引导
const isFirstVisit = ref(false)
const showOnboarding = ref(false)
onMounted(() => {
  isFirstVisit.value = !localStorage.getItem('hao123-onboarding-done')
})
function finishOnboarding() {
  setLocalStorageItem('hao123-onboarding-done', '1')
  showOnboarding.value = false
  isFirstVisit.value = false
}
</script>

<template>
  <div class="home">
    <!-- 极简报头：问候即 display 时刻 + 一句话情报 + 一句温度 -->
    <header class="home-top enter">
      <div class="ht-left">
        <h1 class="ht-greet">{{ greeting }}<span class="ht-date">· {{ dateStr }}</span></h1>
        <p v-if="dailySummary" class="ht-sum">
          {{ dailySummary }}<i v-if="hasUrgentItems" class="ht-urg" aria-label="存在紧急项" />
        </p>
      </div>
      <p class="ht-whisper">{{ whisper }}</p>
    </header>

    <!-- 三栏：左数据柱 / 中 3D / 右仪表+晨报 -->
    <div class="home-grid">
      <aside class="home-left stagger">
        <div v-for="(s, i) in signals" :key="s.key" class="lt" :data-tone="s.tone" :style="{ '--i': i }">
          <span class="lt-v tnum">{{ signalValue[s.key].value }}</span>
          <span class="lt-k">{{ s.label }}</span>
        </div>
      </aside>

      <section class="home-center">
        <InboxDeck />
      </section>

      <aside class="home-right">
        <div class="gauge">
          <div class="g-track"><div class="g-fill" :style="{ height: gaugePct + '%' }" /></div>
          <div class="g-info">
            <div>
              <div class="g-lab">队列健康</div>
              <div class="g-big tnum">{{ gaugePct }}<span>%</span></div>
            </div>
            <ul class="g-leg">
              <li v-for="r in legend" :key="r.label" class="g-row">
                <i :style="{ background: r.c }" />{{ r.label }}<b class="tnum">{{ r.n }}</b>
              </li>
            </ul>
          </div>
        </div>
        <div class="mb-wrap">
          <MorningBriefing />
        </div>
      </aside>
    </div>

    <!-- 底部发光 dock：合并原左 icon 栏 + 顶 dev 导航 + 顶 dev 服务条 -->
    <Dock />

    <!-- 首次访问引导 + 入口 -->
    <OnboardingGuide v-if="showOnboarding" @done="finishOnboarding" />
    <button
      v-if="isFirstVisit && !showOnboarding"
      type="button"
      class="home-onboard"
      @click="showOnboarding = true"
    >
      <span class="ho-led" aria-hidden="true" />快速设置
    </button>
  </div>
</template>

<style scoped>
.home {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 22px 92px;
  /* 页面级滚动容器：body 永久 overflow:hidden，内容超出视口时在这里滚（横向恒裁） */
  overflow-x: hidden;
  overflow-y: auto;
  color: var(--color-ink);
}
/* 单一柔光顶晕 + 极淡遮罩网格（取代旧逐卡纹理；克制、不抢 3D） */
.home::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(820px 360px at 50% -8%, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent 62%),
    radial-gradient(620px 420px at 86% 108%, color-mix(in srgb, var(--color-alive) 8%, transparent), transparent 60%);
}
.home::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.5;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 46px 46px;
  -webkit-mask-image: radial-gradient(circle at 50% 42%, black, transparent 76%);
  mask-image: radial-gradient(circle at 50% 42%, black, transparent 76%);
}

/* 报头 */
.home-top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex: 0 0 auto;
}
.ht-greet {
  margin: 0;
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 600;
  line-height: 1.04;
  letter-spacing: -0.025em;
  color: var(--color-ink);
  text-shadow: 0 0 26px color-mix(in srgb, var(--color-accent) 16%, transparent);
}
.ht-date { margin-left: 10px; color: var(--color-ink-3); font-weight: 500; }
.ht-sum {
  display: flex; align-items: center; gap: 8px;
  margin: 7px 0 0; font-size: 12.5px; color: var(--color-ink-2);
}
.ht-urg {
  width: 6px; height: 6px; border-radius: 50%; background: var(--color-danger);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-danger) 50%, transparent);
  animation: ht-pulse 2s ease-in-out infinite;
}
@keyframes ht-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-danger) 45%, transparent); }
  70% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--color-danger) 0%, transparent); }
}
.ht-whisper {
  margin: 0 0 4px; max-width: 44ch; text-align: right;
  font-size: 12.5px; line-height: 1.5; color: var(--color-ink-3); font-style: italic;
}

/* 三栏 */
.home-grid {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr) 312px;
  gap: 16px;
}
.home-left { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.lt {
  position: relative;
  display: flex; flex-direction: column; gap: 4px;
  padding: 15px 16px;
  border-radius: 15px;
  border: 1px solid color-mix(in srgb, var(--tile-c, var(--color-accent)) 22%, var(--color-line));
  background:
    radial-gradient(120px 80px at 88% -10%, color-mix(in srgb, var(--tile-c, var(--color-accent)) 16%, transparent), transparent 70%),
    linear-gradient(160deg, #141b29, #0e1422);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 16px 40px -22px rgba(0, 8, 16, 0.7);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  transition: transform 0.3s var(--ease-out-expo), border-color 0.3s, box-shadow 0.3s;
}
.lt:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--tile-c, var(--color-accent)) 46%, var(--color-line));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 22px 48px -20px rgba(0, 8, 16, 0.8), 0 0 26px -10px color-mix(in srgb, var(--tile-c, var(--color-accent)) 50%, transparent);
}
.lt[data-tone='cyan'] { --tile-c: var(--color-accent); }
.lt[data-tone='rose'] { --tile-c: var(--color-danger); }
.lt[data-tone='teal'] { --tile-c: var(--color-alive); }
.lt-v {
  font-family: var(--font-display);
  font-size: 32px; font-weight: 700; line-height: 1; letter-spacing: -0.02em;
  color: var(--color-ink);
  text-shadow: 0 0 20px color-mix(in srgb, var(--tile-c, var(--color-accent)) 30%, transparent);
}
.lt-k { font-size: 11px; letter-spacing: 0.02em; color: var(--color-ink-2); }

.home-center { position: relative; min-width: 0; min-height: 0; }

.home-right { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.gauge {
  display: flex; gap: 13px;
  padding: 15px 16px; border-radius: 15px;
  border: 1px solid var(--color-line);
  background: linear-gradient(160deg, #131a28, #0e1422);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 16px 40px -24px rgba(0, 8, 16, 0.7);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.g-track { position: relative; width: 9px; border-radius: 6px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.g-fill {
  position: absolute; left: 0; right: 0; bottom: 0; border-radius: 6px;
  background: linear-gradient(0deg, var(--color-alive), var(--color-accent));
  box-shadow: 0 0 12px color-mix(in srgb, var(--color-alive) 60%, transparent);
  transition: height 0.6s var(--ease-out-expo);
}
.g-info { display: flex; flex-direction: column; justify-content: space-between; flex: 1; gap: 8px; }
.g-lab { font: 600 9.5px/1 var(--font-mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-ink-2); }
.g-big { font-family: var(--font-display); font-weight: 700; font-size: 28px; letter-spacing: -0.02em; color: var(--color-ink); line-height: 1; }
.g-big span { font-size: 13px; color: var(--color-alive); margin-left: 2px; }
.g-leg { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; }
.g-row { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--color-ink-2); }
.g-row i { width: 7px; height: 7px; border-radius: 2px; flex-shrink: 0; }
.g-row b { margin-left: auto; color: var(--color-ink); font-weight: 600; font-size: 11px; }

.mb-wrap { flex: 1 1 auto; min-height: 0; display: flex; }
.mb-wrap :deep(.mb-card) { width: 100%; height: 100%; }

/* 首次访问入口 */
.home-onboard {
  position: fixed; right: 22px; bottom: 22px; z-index: 40;
  display: inline-flex; align-items: center; gap: 8px;
  min-height: 38px; padding: 0 14px; border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 34%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 16%, rgba(8, 13, 22, 0.84)), rgba(8, 13, 22, 0.72));
  color: var(--color-ink); font-size: 13px; font-weight: 600; cursor: pointer;
  box-shadow: 0 14px 36px -12px color-mix(in srgb, var(--color-accent) 30%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  -webkit-backdrop-filter: blur(12px) saturate(130%); backdrop-filter: blur(12px) saturate(130%);
  transition: transform 0.18s var(--ease-out-expo), border-color 0.18s;
}
.home-onboard:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--color-accent) 52%, transparent); }
.ho-led { width: 8px; height: 8px; border-radius: 999px; background: var(--color-accent); box-shadow: 0 0 12px var(--color-accent); }

@media (max-width: 980px) {
  .home { padding-bottom: 104px; }
  .home-grid { grid-template-columns: 1fr; grid-auto-rows: auto; min-height: 100%; }
  .home-left { flex-direction: row; }
  .lt { flex: 1 1 0; }
  .home-center { min-height: 540px; }
  .mb-wrap { min-height: 320px; }
}
@media (prefers-reduced-motion: reduce) {
  .ht-urg { animation: none; }
  .lt, .g-fill, .home-onboard { transition: none; }
}
</style>
