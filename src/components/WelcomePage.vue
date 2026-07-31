<script setup lang="ts">
/**
 * 工作台首页 —— 发光深色「指挥舱」构图（全量重做，非旧 bento 修补）。
 *
 * 解剖（方案 B「环绕 HUD」改版）：
 *   极简报头（问候 + 一句话情报 + 一句温度）／
 *   中间 3D 数据收件箱（InboxDeck，绝对主角——总数 / 来源计数 / 队列进度收拢为舞台环绕 HUD）／
 *   底部发光 dock（Dock，合并原左 icon 栏 + 顶 dev 导航 + 顶 dev 服务条）。
 * 旧六卡 bento / 顶 WbscfServicesCard / 左 NavRail / 左数据柱全部移除——视觉零继承旧设计。
 */
import { computed } from 'vue'
import { useWeatherStore } from '@/features/weather'
import { useTaskStore, useBugStore } from '@/features/zentao'
import { isUrgentTask, isUrgentBug } from '@/features/zentao/shared/ui'
import { useLocalTaskStore, isUrgentLocalTask } from '@/features/local-tasks'
import InboxDeck from '@/components/InboxDeck.vue'
import Dock from '@/components/Dock.vue'

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

    <!-- 单栏：3D 舞台即主角，计数 / 进度收拢为舞台环绕 HUD（InboxDeck 内部承担） -->
    <div class="home-grid">
      <section class="home-center">
        <InboxDeck />
      </section>
    </div>

    <!-- 底部发光 dock：合并原左 icon 栏 + 顶 dev 导航 + 顶 dev 服务条 -->
    <Dock />
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
  /* 首屏固定构图，页面级不允许出现滚动条（body 永久 overflow:hidden 约定的延续）：
     三栏各自守住高度，长文本面板（晨报等）在各自卡片内部滚动；
     窄屏堆叠布局退回容器内滚动（见 ≤980px 媒体查询） */
  overflow: hidden;
  color: var(--color-ink);
}
/* 静态底层：柔光顶晕 + 极淡遮罩网格（克制、不抢 3D，全程静态不被带晃） */
.home::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    radial-gradient(820px 360px at 50% -8%, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent 62%),
    radial-gradient(620px 420px at 86% 108%, color-mix(in srgb, var(--color-alive) 8%, transparent), transparent 60%);
  background-size: 46px 46px, 46px 46px, auto, auto;
  -webkit-mask-image: radial-gradient(circle at 50% 42%, black, transparent 76%);
  mask-image: radial-gradient(circle at 50% 42%, black, transparent 76%);
}
/* 呼吸光晕层：在静态底层之上缓慢漂移 + 亮度呼吸，给场景一个「活的大气」 */
.home::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(760px 340px at 50% -6%, color-mix(in srgb, var(--color-accent) 4%, transparent), transparent 65%),
    radial-gradient(560px 380px at 88% 110%, color-mix(in srgb, var(--color-alive) 3%, transparent), transparent 62%);
  animation: home-breath 10s ease-in-out infinite;
}
@keyframes home-breath {
  0%   { background-position: 50% -6%, 88% 110%; opacity: 0.82; }
  35%  { background-position: 47% -3%, 91% 106%; opacity: 1; }
  65%  { background-position: 53% -9%, 85% 112%; opacity: 0.9; }
  100% { background-position: 50% -6%, 88% 110%; opacity: 0.82; }
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

/* 两栏 */
.home-grid {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0; /* 允许在 flex 列里收缩到比内容矮，首屏才撑不出滚动条 */
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  /* 行高锁定为容器实高（min 0 可收缩）：两栏随视口伸缩，而非按内容反推页面高度 */
  grid-template-rows: minmax(0, 1fr);
  gap: 16px;
}
.home-center { position: relative; min-width: 0; min-height: 0; overflow: hidden; }

@media (max-width: 980px) {
  .home { padding-bottom: 104px; overflow-y: auto; } /* 窄屏堆叠布局内容必超视口，退回容器内滚动 */
  .home-grid { grid-template-columns: 1fr; grid-template-rows: none; grid-auto-rows: auto; min-height: 100%; }
  .home-center { min-height: 540px; overflow: visible; }
}
@media (prefers-reduced-motion: reduce) {
  .ht-urg { animation: none; }
  .home::after { animation: none; }
  .lt { transition: none; }
}
</style>
