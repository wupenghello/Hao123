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
import { useInboxInsights } from '@/features/insights'
import { setLocalStorageItem } from '@/features/storage-health'
import UnifiedInbox from '@/components/UnifiedInbox.vue'
import OnboardingGuide from '@/components/OnboardingGuide.vue'
import { ProgressRing, Sparkline } from '@/components/viz'
import { getWeatherIcon } from '@/features/weather'
import WbscfServicesCard from '@/components/wbscf/WbscfServicesCard.vue'

const weather = useWeatherStore()
const taskStore = useTaskStore()
const bugStore = useBugStore()
const localStore = useLocalTaskStore()
/** 风险预测汇总（纯启发式，始终可用）——驱动「风险雷达」环 */
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

// ============ 今日信号迷你瓦片（bento 单元，纯展示，复用 store 计数）============
// 只读：给左侧 bento 提供一行紧凑信号块；可视化增强（sparkline/进度环）在模块 2
const signals = computed(() => [
  { key: 'task', label: '指派任务', value: taskStore.assignedCount, tone: 'cyan' },
  { key: 'bug', label: '待修 Bug', value: bugStore.assignedCount, tone: 'rose' },
  { key: 'local', label: '本地待办', value: localStore.openCount, tone: 'teal' },
])

// ============ 风险雷达（分段环：逾期 / 临期 / 停滞 / 正常）============
// 数据来自 insights summary（纯启发式、始终可用），用 ProgressRing 分段呈现。
const riskSegments = computed(() => {
  const s = summary.value
  const ok = Math.max(0, s.total - s.overdue - s.dueSoon - s.stalled)
  return [
    { value: s.overdue, tone: 'var(--home-danger)', label: '逾期' },
    { value: s.dueSoon, tone: 'var(--home-warning)', label: '临期' },
    { value: s.stalled, tone: 'var(--home-tone-2)', label: '停滞' },
    { value: ok, tone: 'rgba(148, 163, 184, 0.42)', label: '正常' },
  ].filter((x) => x.value > 0)
})
const riskTotal = computed(() => summary.value.total)
const riskHasData = computed(() => riskTotal.value > 0)

// ============ 模块 3：沉浸式天气卡 ============
/** 当前天气图标组件（大号展示） */
const weatherIcon = computed(() => (weather.now ? getWeatherIcon(weather.now.icon) : null))

/**
 * 天气码 → 背景氛围类。按大类归并（晴 / 多云阴 / 雨 / 雷 / 雪 / 雾霾沙尘 / 夜间），
 * 让天气卡背景随天气变化而不必逐码写渐变。夜间（150~154 / 300+夜段）优先判夜。
 */
const weatherAmbient = computed(() => {
  const c = Number(weather.now?.icon)
  if (!Number.isFinite(c)) return 'default'
  if (c === 150 || (c >= 151 && c <= 154)) return 'night'
  if (c === 100) return 'clear'
  if (c >= 101 && c <= 104) return 'cloudy'
  if (c === 302 || c === 303 || c === 304) return 'storm'
  if ((c >= 300 && c <= 318) || (c >= 350 && c <= 399)) return 'rain'
  if ((c >= 400 && c <= 415) || (c >= 446 && c <= 499)) return 'snow'
  if (c >= 500 && c <= 518) return 'fog'
  return 'default'
})

/** 降水概率序列（未来逐小时 pop%，最多 12 项）——驱动降水 sparkline */
const precipData = computed(() =>
  (weather.hourly ?? [])
    .slice(0, 12)
    .map((h) => Number(h.pop))
    .filter((n) => Number.isFinite(n)),
)
/** 是否有非零降水概率（全 0 时不渲染降水线，改显「无降水」） */
const hasPrecip = computed(() => precipData.value.some((n) => n > 0))
/** 峰值降水概率（卡片角标） */
const precipPeak = computed(() => (precipData.value.length ? Math.max(...precipData.value) : 0))

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
  // 降水概率 sparkline 需要逐小时数据（懒加载，按城市缓存，重复调用只发一次请求）
  weather.ensureHourly()
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
  <!-- 外层固定高度容器（body 永久 overflow:hidden，bento 内部各自滚动） -->
  <div class="welcome-shell">
    <!-- 本地 dev 服务状态卡（仅 dev + wbscf-web 配置后、且探测到服务时出现） -->
    <WbscfServicesCard class="welcome-services" />

    <!-- 平铺 bento：顶部一行小卡（hero/信号/风险/温度），底部一行两张高卡（晨报/收件箱）。
         收件箱不再是唯一主角，降级成一张普通 bento 卡。 -->
    <div class="welcome-bento">
      <!-- bento 单元 A：问候 hero —— 今日信号总览 -->
      <header class="bento-cell bento-hero">
        <p class="bento-kicker">today signal</p>
        <h1 class="bento-title">{{ greeting }} · {{ dateStr }}</h1>
        <Transition name="guide-fade">
          <p v-if="dailySummary" class="bento-summary">
            {{ dailySummary }}
            <span v-if="hasUrgentItems" class="welcome-urgent-dot" />
          </p>
        </Transition>
      </header>

      <!-- bento 单元 B：今日信号迷你瓦片（任务 / Bug / 本地，纯计数） -->
      <div class="bento-cell bento-signals" aria-label="工作项计数">
        <button
          v-for="s in signals"
          :key="s.key"
          type="button"
          class="signal-tile"
          :data-tone="s.tone"
          tabindex="-1"
          aria-hidden="true"
        >
          <span class="signal-value">{{ s.value }}</span>
          <span class="signal-label">{{ s.label }}</span>
        </button>
      </div>

      <!-- bento 单元 C：风险雷达（分段环，insights summary，始终可用） -->
      <div class="bento-cell bento-radar" aria-label="风险雷达">
        <div class="bento-section-label">
          <span class="bento-kicker">risk radar</span>
        </div>
        <div class="radar-body">
          <div class="radar-ring">
            <ProgressRing
              v-if="riskHasData"
              :segments="riskSegments"
              :size="84"
              :thickness="9"
              label="今日工作项风险分布"
            />
            <ProgressRing
              v-else
              :value="1"
              :max="1"
              tone="rgba(148, 163, 184, 0.42)"
              :size="84"
              :thickness="9"
              label="暂无风险项"
            />
            <div class="radar-center">
              <span class="radar-center-value">{{ riskTotal }}</span>
              <span class="radar-center-label">待关注</span>
            </div>
          </div>
          <ul class="radar-legend">
            <li v-for="s in riskSegments" :key="s.label" class="radar-legend-item">
              <span class="radar-dot" :style="{ background: s.tone }" />
              <span class="radar-legend-label">{{ s.label }}</span>
              <span class="radar-legend-value">{{ s.value }}</span>
            </li>
            <li v-if="!riskHasData" class="radar-legend-empty">一切正常，无风险项</li>
          </ul>
        </div>
      </div>

      <!-- bento 单元 D：沉浸式天气卡（大号等宽温度 + 天气图标 + 氛围背景 + 降水 sparkline） -->
      <div
        v-if="weather.now"
        class="bento-cell bento-weather"
        :data-ambient="weatherAmbient"
        aria-label="天气"
      >
        <!-- 顶部：城市 + 天气文字 -->
        <div class="weather-card-head">
          <span class="bento-kicker">weather</span>
          <span v-if="weather.now" class="weather-card-city">{{ weather.cityName }}</span>
        </div>

        <!-- 主体：大号温度 + 天气图标 -->
        <div v-if="weather.now" class="weather-card-main">
          <div class="weather-card-temp">
            <span class="weather-card-temp-val">{{ weather.now.temp }}</span>
            <span class="weather-card-temp-unit">°C</span>
          </div>
          <div class="weather-card-side">
            <component :is="weatherIcon" v-if="weatherIcon" class="weather-card-icon" />
            <span class="weather-card-text">{{ weather.now.text }}</span>
          </div>
        </div>

        <!-- 次要信息：体感 · 湿度 · 风 -->
        <div v-if="weather.now" class="weather-card-meta">
          <span>体感 {{ weather.now.feelsLike }}°</span>
          <span>湿度 {{ weather.now.humidity }}%</span>
          <span>{{ weather.now.windDir }}{{ weather.now.windScale }}级</span>
        </div>

        <!-- 降水概率 sparkline（有非零概率才画线，否则一句无降水） -->
        <div v-if="precipData.length >= 2" class="weather-card-precip">
          <div class="weather-card-precip-head">
            <span class="weather-card-precip-label">未来降水概率</span>
            <span v-if="hasPrecip" class="weather-card-precip-peak">峰值 {{ precipPeak }}%</span>
            <span v-else class="weather-card-precip-peak is-dry">未来无降水</span>
          </div>
          <Sparkline
            v-if="hasPrecip"
            :data="precipData"
            :width="260"
            :height="30"
            tone="var(--accent, #00D9FF)"
            :fill="true"
            :dots="false"
          />
        </div>
      </div>

      <!-- bento 单元 E：每日晨报（高卡，左侧） -->
      <MorningBriefing class="bento-cell bento-briefing" />

      <!-- bento 单元 F：统一收件箱（高卡，右侧，不再是唯一主角） -->
      <section class="bento-cell bento-inbox" aria-label="统一收件箱">
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
  --home-tone: var(--accent);
  --home-tone-2: #2dd4bf;
  --home-success: var(--run);
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
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
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
/* ===== 平铺 bento（spec 模块1：瀑布流式 bento，收件箱降级为普通卡）=====
 * 12 列；顶部 auto 行放小卡（hero/信号/风险/温度），底部 1fr 行放两张高卡（晨报/收件箱），
 * 高卡各自内部滚动，整块严丝合缝填满视口（body 永久 overflow:hidden）。 */
.welcome-bento {
  position: relative;
  z-index: 1;
  display: grid;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  grid-template-columns: repeat(12, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--space-3);
  grid-auto-flow: dense;
}
.bento-hero { grid-column: span 4; grid-row: 1; }
.bento-signals { grid-column: span 4; grid-row: 1; }
.bento-radar { grid-column: span 4; grid-row: 1; }
.bento-weather { display: none; } /* 默认隐藏；宽屏 ≥1280 独占一格 */
.bento-briefing { grid-column: span 5; grid-row: 2; min-height: 0; }
.bento-inbox { grid-column: span 7; grid-row: 2; min-height: 0; display: flex; }
.bento-inbox > :deep(*) {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
/* 宽屏：顶部四张小卡并排（各 span 3），天气独占一格 */
@media (min-width: 1280px) {
  .bento-hero,
  .bento-signals,
  .bento-radar { grid-column: span 3; }
  .bento-weather {
    grid-column: span 3;
    grid-row: 1;
    display: flex;
    flex-direction: column;
  }
}
/* ===== bento 单元基座：统一毛玻璃 + 信号轨 + 网格纹理（对齐 HUD skill 约定）===== */
.bento-cell {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--home-border);
  border-radius: var(--radius-card);
  background: rgba(10, 11, 14, 0.4);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    var(--elev-2);
  backdrop-filter: blur(18px) saturate(130%);
  -webkit-backdrop-filter: blur(18px) saturate(130%);
}
/* bento 单元 B（信号瓦片）横向铺开，自身是瓦片容器而非卡片 */
.bento-signals {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-md);
}

.bento-hero {
  padding: var(--space-4) var(--space-4) var(--space-3);
  border-color: color-mix(in srgb, var(--home-tone) 18%, var(--home-border));
  background:
    radial-gradient(circle at 18px 18px, color-mix(in srgb, var(--home-tone) 16%, transparent), transparent 64px),
    linear-gradient(135deg, color-mix(in srgb, var(--home-tone) 8%, transparent), transparent 40%),
    rgba(10, 11, 14, 0.4);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.055),
    0 18px 54px rgba(0, 0, 0, 0.22);
}
.bento-hero::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--home-tone), transparent);
  opacity: 0.76;
}
.bento-hero::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.042) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.032) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: linear-gradient(120deg, rgba(0, 0, 0, 0.46), transparent 64%);
}
.bento-hero > * {
  position: relative;
  z-index: 1;
}
.bento-kicker {
  margin: 0 0 8px;
  color: color-mix(in srgb, var(--home-tone) 78%, white 5%);
  font: 850 10px/1 var(--font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.bento-title {
  margin: 0;
  color: rgba(248, 250, 252, 0.96);
  font-size: var(--text-xl);
  font-weight: 850;
  line-height: 1.12;
  letter-spacing: -0.02em;
  text-shadow: 0 0 20px color-mix(in srgb, var(--home-tone) 18%, transparent);
}
.bento-summary {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 14px 0 0;
  color: rgba(226, 232, 240, 0.64);
  font-size: var(--text-sm);
  line-height: 1.55;
}

/* ===== 信号迷你瓦片：每个计数一块，按来源上色 ===== */
.signal-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--tile-tone, var(--home-tone)) 22%, transparent);
  border-radius: var(--radius-sm);
  background:
    radial-gradient(circle at 80% 0, color-mix(in srgb, var(--tile-tone, var(--home-tone)) 16%, transparent), transparent 70%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.5), rgba(2, 6, 23, 0.42));
  text-align: left;
  cursor: default;
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}
.signal-tile[data-tone='cyan'] { --tile-tone: var(--home-tone); }
.signal-tile[data-tone='rose'] { --tile-tone: var(--home-danger); }
.signal-tile[data-tone='teal'] { --tile-tone: var(--home-success); }
.signal-tile:hover {
  border-color: color-mix(in srgb, var(--tile-tone, var(--home-tone)) 48%, transparent);
  transform: translateY(-1px);
  box-shadow: 0 8px 22px color-mix(in srgb, var(--tile-tone, var(--home-tone)) 16%, transparent);
}
.signal-value {
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  color: rgba(248, 250, 252, 0.96);
  text-shadow: 0 0 18px color-mix(in srgb, var(--tile-tone, var(--home-tone)) 30%, transparent);
  font-variant-numeric: tabular-nums;
}
.signal-label {
  font-size: 10.5px;
  letter-spacing: 0.02em;
  color: rgba(226, 232, 240, 0.5);
}

.bento-briefing {
  /* 高卡 bento 单元（grid item）：填满网格格，内部 .mb-card → .mb-scroll 滚动 */
  min-height: 0;
}

/* ===== bento 单元通用：内边距 + 分区标签 ===== */
.bento-radar {
  padding: var(--space-3) var(--space-4);
}
.bento-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

/* ===== 风险雷达卡 ===== */
.radar-body {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.radar-ring {
  position: relative;
  flex-shrink: 0;
  width: 92px;
  height: 92px;
}
.radar-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.radar-center-value {
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  color: rgba(248, 250, 252, 0.96);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 18px color-mix(in srgb, var(--home-tone) 24%, transparent);
}
.radar-center-label {
  margin-top: 3px;
  font-size: 10px;
  color: rgba(226, 232, 240, 0.46);
  letter-spacing: 0.02em;
}
.radar-legend {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
}
.radar-legend-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}
.radar-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 2px;
  box-shadow: 0 0 6px color-mix(in srgb, var(--home-tone) 20%, transparent);
}
.radar-legend-label {
  color: rgba(226, 232, 240, 0.6);
}
.radar-legend-value {
  margin-left: auto;
  font-family: var(--font-mono);
  font-weight: 600;
  color: rgba(248, 250, 252, 0.9);
  font-variant-numeric: tabular-nums;
}
.radar-legend-empty {
  font-size: 12px;
  color: rgba(226, 232, 240, 0.44);
  font-style: italic;
}

/* ===== 模块 3：沉浸式天气卡 ===== */
.bento-weather {
  padding: 12px 14px;
  justify-content: space-between;
}
/* 氛围背景：随天气码变化（晴/多云/雨/雷/雪/雾/夜间），半透明叠在 bento 基座之上 */
.bento-weather::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  z-index: 0;
  opacity: 0.9;
}
.bento-weather > * { position: relative; z-index: 1; }
.bento-weather[data-ambient='clear']::before {
  background: radial-gradient(circle at 78% 18%, rgba(250, 204, 21, 0.22), transparent 60%),
    radial-gradient(circle at 12% 88%, rgba(56, 189, 248, 0.14), transparent 58%);
}
.bento-weather[data-ambient='cloudy']::before {
  background: radial-gradient(circle at 80% 20%, rgba(148, 163, 184, 0.18), transparent 62%),
    radial-gradient(circle at 14% 86%, rgba(100, 116, 139, 0.14), transparent 60%);
}
.bento-weather[data-ambient='rain']::before {
  background: radial-gradient(circle at 78% 16%, rgba(56, 189, 248, 0.2), transparent 60%),
    radial-gradient(circle at 16% 88%, rgba(14, 165, 233, 0.16), transparent 58%);
}
.bento-weather[data-ambient='storm']::before {
  background: radial-gradient(circle at 76% 14%, rgba(167, 139, 250, 0.2), transparent 58%),
    radial-gradient(circle at 18% 88%, rgba(56, 189, 248, 0.18), transparent 60%);
}
.bento-weather[data-ambient='snow']::before {
  background: radial-gradient(circle at 80% 18%, rgba(226, 232, 240, 0.2), transparent 62%),
    radial-gradient(circle at 14% 86%, rgba(165, 243, 252, 0.16), transparent 60%);
}
.bento-weather[data-ambient='fog']::before {
  background: radial-gradient(circle at 50% 30%, rgba(203, 213, 225, 0.16), transparent 66%),
    radial-gradient(circle at 50% 90%, rgba(148, 163, 184, 0.12), transparent 60%);
}
.bento-weather[data-ambient='night']::before {
  background: radial-gradient(circle at 80% 16%, rgba(125, 211, 252, 0.14), transparent 60%),
    radial-gradient(circle at 14% 86%, rgba(30, 41, 59, 0.4), transparent 58%);
}
.bento-weather[data-ambient='default']::before {
  background: radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--home-tone) 14%, transparent), transparent 60%);
}

.weather-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.weather-card-city {
  font-size: 11px;
  color: rgba(226, 232, 240, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.weather-card-main {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}
.weather-card-temp {
  display: flex;
  align-items: flex-start;
  line-height: 0.9;
}
.weather-card-temp-val {
  font-family: var(--font-mono);
  font-size: 40px;
  font-weight: 700;
  color: rgba(248, 250, 252, 0.98);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  text-shadow: 0 0 22px rgba(255, 255, 255, 0.12);
}
.weather-card-temp-unit {
  margin-top: 4px;
  margin-left: 2px;
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
  color: rgba(226, 232, 240, 0.6);
}
.weather-card-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.weather-card-icon {
  width: 30px;
  height: 30px;
  color: rgba(226, 232, 240, 0.9);
}
.weather-card-text {
  font-size: 11.5px;
  color: rgba(226, 232, 240, 0.72);
}
.weather-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 6px;
  font-size: 11px;
  color: rgba(226, 232, 240, 0.5);
  font-variant-numeric: tabular-nums;
}
.weather-card-precip {
  margin-top: 8px;
}
.weather-card-precip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 2px;
}
.weather-card-precip-label {
  font-size: 10px;
  color: rgba(226, 232, 240, 0.46);
  letter-spacing: 0.02em;
}
.weather-card-precip-peak {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--accent, #00d9ff);
  font-variant-numeric: tabular-nums;
}
.weather-card-precip-peak.is-dry {
  color: rgba(226, 232, 240, 0.42);
  font-family: var(--font-sans);
  font-weight: 500;
}
.bento-weather :deep(.sparkline) {
  width: 100%;
  height: 30px;
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

/* ===== bento 进场：错峰淡入上浮，呼吸感 ===== */
.welcome-services { animation: bento-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
.bento-hero { animation: bento-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
.bento-signals { animation: bento-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.06s both; }
.bento-radar { animation: bento-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both; }
.bento-weather { animation: bento-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.14s both; }
.bento-briefing { animation: bento-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.18s both; }
.bento-inbox { animation: bento-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.22s both; }
@keyframes bento-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
/* 窄屏：bento 退回单列堆叠，整页可滚 */
@media (max-width: 980px) {
  .welcome-shell {
    overflow-y: auto;
    padding: 16px;
  }
  .welcome-shell::after { inset: 16px; }
  .welcome-bento {
    height: auto;
    min-height: 100%;
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }
  .bento-hero,
  .bento-signals,
  .bento-radar,
  .bento-weather,
  .bento-briefing,
  .bento-inbox {
    grid-column: 1 / -1;
    grid-row: auto;
  }
  .bento-weather { display: flex; flex-direction: column; }
  .bento-inbox { min-height: 560px; }
}
@media (prefers-reduced-motion: reduce) {
  .welcome-urgent-dot { animation: none; }
  .bento-hero,
  .bento-signals,
  .bento-radar,
  .bento-weather,
  .bento-briefing,
  .bento-inbox { animation: none; }
  .signal-tile { transition: none; }
  .signal-tile:hover { transform: none; box-shadow: none; }
  .welcome-onboard-btn,
  .guide-fade-enter-active,
  .guide-fade-leave-active { transition: none; }
  .welcome-onboard-btn:hover { transform: none; }
}
</style>
