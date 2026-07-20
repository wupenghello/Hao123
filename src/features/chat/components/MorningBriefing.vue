<script setup lang="ts">
/**
 * 每日晨报卡片（首页常驻）
 *
 * 小吴每天基于真实工作台快照生成一份「今日规划」：
 *  - agent 模式：结构化 DailyPlan（topPriority 高亮卡 + 分组列表 + 节奏 + 天气）
 *  - fallback 模式：保留 Markdown 渲染（向后兼容 agent 失败场景）
 *
 * 持久化到 localStorage：同一天复用缓存，次日或点「刷新」才更新；
 * 数据显著变化（新增逾期 / 紧急 Bug / 今日截止项状态变更 / 天气预警）时主动重排。
 * LLM 未配置时不渲染；首次生成显示骨架，失败可重试；刷新时保留旧内容可见。
 */
import { computed, ref, watch } from 'vue'
import { useBriefing, ASSISTANT_NAME, renderMarkdown } from '@/features/chat'
import { useChatStore } from '../store'
import { useWeatherStore } from '@/features/weather'
import type { DailyPlanItem } from '../daily-plan'
import IconSpark from '~icons/mdi/star-four-points'
import IconRefresh from '~icons/mdi/refresh'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconClock from '~icons/mdi/clock-outline'
import IconWeather from '~icons/mdi/weather-partly-cloudy'
import IconOpen from '~icons/mdi/open-in-new'
import IconCheck from '~icons/mdi/check'
import IconClose from '~icons/mdi/close'

const { briefing, generating, error, refresh, remainingRefreshes, progress } = useBriefing()
const chat = useChatStore()
const weatherStore = useWeatherStore()

/** 当前是否为结构化 plan 模式（agent 主产出） */
const isPlanMode = computed(() => !!briefing.value?.plan)

/** 结构化 plan */
const plan = computed(() => briefing.value?.plan ?? null)

/** 真正的风险标签集合（用于守卫红色徽标渲染）。
 *  模型会给无风险的任务也输出 riskLabel="正常"/"不紧急"，这类不该显示红色警告徽标。
 *  注意：必须排除否定前缀，避免 "不紧急" 被 includes("紧急") 误判为风险。 */
const RISK_LABELS = ['逾期', '临期', '停滞', '紧急']
const isRiskLabel = (label?: string) => {
  if (!label) return false
  if (/^(不|无|非|没)/.test(label) || label === '正常') return false
  return RISK_LABELS.some((r) => label.includes(r))
}

/**
 * 天气兜底文案：包含地区 + 天气现象 + 温度 + 体感。
 */
const weatherFallback = computed(() => {
  const now = weatherStore.now
  const city = weatherStore.cityName
  if (!now || !city) return null
  const feelsLike = now.feelsLike != null && now.feelsLike !== now.temp ? `，体感 ${now.feelsLike}°C` : ''
  return `${city} ${now.text} ${now.temp}°C${feelsLike}`
})

/**
 * 统一的天气显示文本：优先用模型生成的 weatherNote，否则用 fallback。
 * 硬性约束（缺一不可）：
 *  (1) 必须带上地区（城市名）—— 若文本已以城市名开头则不重复，否则前缀补上；
 *  (2) 必须携带温度（如 "27°C"）—— 若文本不含温度，用 weather store 当前实况温度补上。
 */
const weatherDisplayText = computed(() => {
  const city = weatherStore.cityName
  const now = weatherStore.now
  const raw = plan.value?.weatherNote || weatherFallback.value
  if (!raw) return null
  let text = raw
  // 约束 1：地区（已含城市名则不重复，避免 "北京 白天北京..."）
  if (city && !text.includes(city)) text = `${city} ${text}`
  // 约束 2：温度（匹配 "数字+°C" 或 "数字+℃" U+2103）
  if (now?.temp != null && !/\d+\s*[°℃]C?/.test(text)) {
    text = `${text}，${now.temp}°C`
  }
  return text
})

/** 分组折叠状态（默认「先处理」展开，其余折叠） */
const expandedGroups = ref<Record<string, boolean>>({})

/** plan 变化时重置折叠状态（默认先处理展开） */
watch(
  () => plan.value,
  (p) => {
    const init: Record<string, boolean> = {}
    for (const g of p?.groups ?? []) init[g.label] = g.label === '先处理'
    expandedGroups.value = init
  },
  { immediate: true },
)

function toggleGroup(label: string) {
  expandedGroups.value[label] = !expandedGroups.value[label]
}

/** fallback Markdown（无 plan 时渲染） */
const html = computed(() => {
  if (isPlanMode.value) return ''
  return briefing.value?.content ? renderMarkdown(briefing.value.content) : ''
})

/** 「X 分钟前」相对时间 */
const relTime = computed(() => {
  if (!briefing.value) return ''
  const diff = Date.now() - briefing.value.generatedAt
  if (diff < 60_000) return '刚刚'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  return `${h} 小时前`
})

/** plan 版本标签 */
const versionLabel = computed(() => {
  const v = briefing.value?.planVersion ?? 0
  if (!v) return ''
  return `第 ${v} 版`
})

/** 剩余可自动重排次数标签 */
const remainingLabel = computed(() => {
  const r = remainingRefreshes()
  return r > 0 ? `可自动重排 ${r} 次` : '今日重排次数已满'
})

/** aria-live 播报文案（读屏用，氛围向不堆信息） */
const ariaStatus = computed(() => (generating.value ? `${ASSISTANT_NAME} 正在思考` : ''))

/** 打开禅道项（任务 / Bug） */
function openInZentao(item: DailyPlanItem) {
  const m = item.key.match(/^(task|bug)-(.+)$/)
  if (!m) return
  const [, kind, id] = m
  const base = import.meta.env.VITE_ZENTAO_BASE || ''
  if (!base) return
  const path = kind === 'task' ? `task-view-${id}.html` : `bug-view-${id}.html`
  window.open(`${base.replace(/\/$/, '')}/${path}`, '_blank')
}

/** 在聊天里问这条工作项 */
function askAbout(it: DailyPlanItem) {
  if (!chat.configured) return
  chat.show()
  void chat.send(`请查看${it.source}「${it.title}」的详情，帮我评估今天具体怎么推进。`)
}

/** 通用的「让 chat 接手今日规划」深聊入口 */
function startPlanChat() {
  if (!chat.configured || !plan.value) return
  const tp = plan.value.topPriority
  const focus = plan.value.focus
  chat.show()
  void chat.send(
    `我看了今天的规划（「${tp.title}」最优先，主线：${focus}）。请接手今天的执行：先确认「先处理」这几项的具体下一步动作，需要查详情的就查。`,
  )
}

/** fallback 模式：把 Markdown 简报交给小吴深聊 */
function startFallbackChat() {
  const c = (briefing.value?.content || '').trim()
  if (!chat.configured || !c) return
  chat.show()
  void chat.send(`我看了今天的简报，请你继续：\n${c}`)
}
</script>

<template>
  <Transition name="mb-fade">
    <section v-if="briefing || generating || error" class="mb-card" :class="{ 'is-refreshing': generating && briefing, 'is-plan': isPlanMode }">
      <header class="mb-head">
        <span class="mb-icon"><IconSpark class="w-3.5 h-3.5" /></span>
        <span class="mb-title">今日简报</span>
        <span v-if="briefing" class="mb-time" :class="{ 'is-live': generating }">
          {{ generating ? '正在更新' : relTime }}
        </span>
        <span v-if="briefing && versionLabel" class="mb-version">{{ versionLabel }}</span>
        <span v-if="briefing && isPlanMode" class="mb-remaining" :title="remainingLabel">{{ remainingLabel }}</span>
        <button
          v-if="isPlanMode && plan"
          class="mb-plan"
          title="让小吴接手今天的执行"
          @click="startPlanChat"
        >
          <IconSpark class="w-3 h-3" />
          <span>让 {{ ASSISTANT_NAME }} 接手</span>
        </button>
        <button
          class="mb-refresh"
          :class="{ 'is-spinning': generating }"
          :disabled="generating"
          :title="generating ? '生成中…' : '刷新规划'"
          @click="refresh"
        >
          <IconRefresh class="w-3.5 h-3.5" />
        </button>
      </header>

      <div class="mb-scroll" role="status" aria-live="polite" :aria-label="ariaStatus || '晨报加载区'">
        <div v-if="generating && briefing" class="mb-refreshing">
          <span class="mb-refreshing-pulse" />
          <span>正在重新整理简报，旧内容先留着给你看</span>
        </div>

        <!-- ========== 生成中：思考动效（氛围向，非信息向） ========== -->
        <div v-if="generating && !briefing" class="mb-thinking">
          <div class="mb-thinking-orb">
            <span class="mb-thinking-core" />
            <span class="mb-thinking-ring" />
            <span class="mb-thinking-ring is-2" />
            <span class="mb-thinking-ring is-3" />
          </div>
          <p class="mb-thinking-text">
            {{ progress?.message || `${ASSISTANT_NAME} 正在思考` }}
            <span class="mb-thinking-dots"><i /><i /><i /></span>
          </p>
          <!-- 工作步骤（三态：✓ 已完成 / ⏳ 进行中 / ○ 待做） -->
          <ul v-if="progress?.steps?.length" class="mb-steps">
            <li v-for="s in progress.steps" :key="s.id" class="mb-step" :class="`is-${s.status}`">
              <span class="mb-step-icon">
                <IconCheck v-if="s.status === 'done'" class="w-3 h-3" />
                <span v-else-if="s.status === 'running'" class="mb-step-pulse" />
                <IconClose v-else-if="s.status === 'error'" class="w-3 h-3" />
                <span v-else class="mb-step-dot" />
              </span>
              <span class="mb-step-label">{{ s.label }}</span>
              <span v-if="s.summary" class="mb-step-summary">{{ s.summary }}</span>
            </li>
          </ul>
          <span class="mb-thinking-scan" />
        </div>

        <!-- 错误且无缓存可兜底 -->
        <div v-else-if="error && !briefing" class="mb-error">
          <IconAlert class="w-4 h-4 shrink-0" />
          <span class="flex-1 min-w-0 truncate">{{ error }}</span>
          <button class="mb-retry" @click="refresh">重试</button>
        </div>

        <!-- ========== agent 模式：结构化 plan 卡片 ========== -->
        <template v-else-if="plan">
          <!-- topPriority 高亮卡 -->
          <div class="mb-top">
            <div class="mb-top-kicker">
              <span class="mb-top-dot" />
              <span>今天先抓</span>
              <span
                v-if="plan.topPriority.riskLabel"
                :class="isRiskLabel(plan.topPriority.riskLabel) ? 'mb-top-risk' : 'mb-top-risk-normal'"
              >{{ plan.topPriority.riskLabel }}</span>
              <span v-if="plan.topPriority.deadline" class="mb-top-deadline">截止 {{ plan.topPriority.deadline }}</span>
              <span v-if="weatherDisplayText" class="mb-top-weather">
                <IconWeather class="w-3 h-3" />
                <span>{{ weatherDisplayText }}</span>
              </span>
            </div>
            <div class="mb-top-title-row">
              <strong class="mb-top-title" :title="plan.topPriority.title">{{ plan.topPriority.title }}</strong>
              <span class="mb-top-pri">{{ plan.topPriority.priorityLabel }}</span>
            </div>
            <p v-if="plan.topPriority.reason" class="mb-top-reason">{{ plan.topPriority.reason }}</p>
            <div class="mb-top-actions">
              <button class="mb-top-action" title="查看详情" @click="openInZentao(plan.topPriority)">
                <IconOpen class="w-3.5 h-3.5" />在禅道打开
              </button>
              <button class="mb-top-action" title="让小吴评估" @click="askAbout(plan.topPriority)">
                <IconSpark class="w-3.5 h-3.5" />让小吴评估
              </button>
            </div>
          </div>

          <!-- focus 主线一句话 -->
          <p class="mb-focus">
            <IconSpark class="w-3.5 h-3.5 shrink-0" />
            <span>{{ plan.focus }}</span>
          </p>

          <!-- 分组列表 -->
          <div class="mb-groups">
            <div v-for="g in plan.groups" :key="g.label" class="mb-group" :class="{ 'is-expanded': expandedGroups[g.label], 'is-empty': !g.items.length }">
              <button class="mb-group-head" :disabled="!g.items.length" @click="toggleGroup(g.label)">
                <span class="mb-group-label">{{ g.label }}</span>
                <span class="mb-group-count">{{ g.items.length }}</span>
                <svg class="mb-group-chevron" :class="{ 'is-open': expandedGroups[g.label] }" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <Transition name="mb-expand">
                <ul v-if="expandedGroups[g.label] && g.items.length" class="mb-group-list">
                  <li v-for="it in g.items" :key="it.key" class="mb-item">
                    <span class="mb-item-bullet" :data-tone="isRiskLabel(it.riskLabel) ? 'risk' : 'normal'" />
                    <div class="mb-item-body">
                      <div class="mb-item-title-row">
                        <span class="mb-item-title" :title="it.title">{{ it.title }}</span>
                        <span
                          v-if="it.riskLabel"
                          :class="isRiskLabel(it.riskLabel) ? 'mb-item-risk' : 'mb-item-risk-normal'"
                        >{{ it.riskLabel }}</span>
                        <span class="mb-item-pri">{{ it.priorityLabel }}</span>
                      </div>
                      <p v-if="it.reason" class="mb-item-reason">{{ it.reason }}</p>
                      <p v-if="it.action" class="mb-item-action"><IconBullet class="w-3 h-3 shrink-0" />{{ it.action }}</p>
                    </div>
                    <div class="mb-item-ops">
                      <button class="mb-item-op" title="在禅道打开" @click="openInZentao(it)"><IconOpen class="w-3.5 h-3.5" /></button>
                      <button class="mb-item-op" title="让小吴评估" @click="askAbout(it)"><IconSpark class="w-3.5 h-3.5" /></button>
                    </div>
                  </li>
                </ul>
              </Transition>
            </div>
          </div>

          <!-- 时间节奏 -->
          <div class="mb-timing">
            <div class="mb-timing-head"><IconClock class="w-3.5 h-3.5" /><span>今天节奏</span></div>
            <div class="mb-timing-grid">
              <div class="mb-timing-slot">
                <span class="mb-timing-kicker">上午</span>
                <span class="mb-timing-text">{{ plan.timing.morning }}</span>
              </div>
              <div class="mb-timing-slot">
                <span class="mb-timing-kicker">下午</span>
                <span class="mb-timing-text">{{ plan.timing.afternoon }}</span>
              </div>
              <div class="mb-timing-slot">
                <span class="mb-timing-kicker">收尾</span>
                <span class="mb-timing-text">{{ plan.timing.evening }}</span>
              </div>
            </div>
          </div>

        </template>

        <!-- ========== fallback 模式：Markdown 渲染（向后兼容） ========== -->
        <div v-else-if="html" class="mb-body" :class="{ 'is-muted': generating }" v-html="html" />

        <!-- fallback 模式：深聊入口 -->
        <div v-if="!isPlanMode && html" class="mb-foot">
          <button class="mb-ask" @click="startFallbackChat">
            <IconSpark class="w-3 h-3" />
            <span>让 {{ ASSISTANT_NAME }} 看看这篇简报</span>
          </button>
        </div>

        <!-- LLM 未配置引导 -->
        <div v-if="!chat.configured && !generating && !error && !briefing" class="mb-unconfigured">
          <IconAlert class="w-4 h-4 shrink-0" />
          <span class="flex-1 min-w-0 truncate">配置大模型后即可为你生成「今日简报」</span>
          <button class="mb-config" title="打开模型设置" @click="chat.openModelConfig()">去配置 →</button>
        </div>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
/* —— 原有基座保留，微调适配 plan 模式 —— */
.mb-card {
  --mb-tone: var(--accent);
  --mb-tone-2: #2dd4bf;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--mb-tone) 18%, rgba(148, 163, 184, 0.16));
  border-radius: 12px;
  background: radial-gradient(circle at 18px 18px, color-mix(in srgb, var(--mb-tone) 17%, transparent), transparent 66px), linear-gradient(135deg, color-mix(in srgb, var(--mb-tone) 8%, transparent), transparent 44%), rgba(2, 6, 23, 0.32);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055), 0 18px 54px rgba(0,0,0,0.2);
  backdrop-filter: blur(18px) saturate(130%);
}
.mb-card.is-plan { border-color: color-mix(in srgb, var(--mb-tone) 28%, rgba(148, 163, 184, 0.16)); }
.mb-card::before { position: absolute; inset: 0 auto 0 0; width: 3px; content: ''; background: linear-gradient(180deg, transparent, var(--mb-tone), transparent); opacity: 0.78; }
.mb-card::after { position: absolute; inset: 0; pointer-events: none; content: ''; background: linear-gradient(90deg, rgba(255,255,255,0.044) 1px, transparent 1px), linear-gradient(180deg, rgba(255,255,255,0.032) 1px, transparent 1px); background-size: 28px 28px; mask-image: linear-gradient(115deg, rgba(0,0,0,0.48), transparent 66%); }
.mb-card > * { position: relative; z-index: 1; }
.mb-card.is-refreshing { border-color: color-mix(in srgb, var(--mb-tone) 34%, rgba(148, 163, 184, 0.22)); }

.mb-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; flex-shrink: 0; border-bottom: 1px solid color-mix(in srgb, var(--mb-tone) 15%, transparent); background: linear-gradient(90deg, color-mix(in srgb, var(--mb-tone) 8%, transparent), transparent); }
.mb-icon { display: grid; width: 24px; height: 24px; flex-shrink: 0; place-items: center; border: 1px solid color-mix(in srgb, var(--mb-tone) 36%, rgba(255,255,255,0.08)); border-radius: 8px; background: color-mix(in srgb, var(--mb-tone) 13%, rgba(255,255,255,0.04)); color: color-mix(in srgb, var(--mb-tone) 80%, white); }
.mb-title { color: rgba(248,250,252,0.92); font-size: 13px; font-weight: 850; letter-spacing: -0.01em; }
.mb-time { margin-left: auto; color: rgba(226,232,240,0.42); font-size: 11px; }
.mb-time.is-live { color: color-mix(in srgb, var(--mb-tone-2) 72%, white); font-weight: 750; }
.mb-version { color: rgba(226,232,240,0.5); font: 700 10px/1 var(--font-mono, ui-monospace, monospace); letter-spacing: 0.04em; padding: 2px 6px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); }
.mb-remaining { color: rgba(226,232,240,0.42); font-size: 10px; }
.mb-refresh, .mb-retry, .mb-plan, .mb-config { appearance: none; -webkit-appearance: none; cursor: pointer; }
.mb-refresh { display: grid; width: 27px; height: 27px; margin-left: auto; place-items: center; border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; background: rgba(255,255,255,0.045); color: rgba(226,232,240,0.45); transition: color 0.15s, background 0.15s, border-color 0.15s; }
.mb-refresh:hover:not(:disabled) { color: white; border-color: color-mix(in srgb, var(--mb-tone) 30%, transparent); }
.mb-refresh:disabled { cursor: default; opacity: 0.7; }
.mb-refresh.is-spinning svg { animation: mb-spin 0.9s linear infinite; }
.mb-plan { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; margin: 0; padding: 0 10px; border: 1px solid color-mix(in srgb, var(--mb-tone) 28%, transparent); border-radius: 9px; background: color-mix(in srgb, var(--mb-tone) 12%, rgba(255,255,255,0.04)); color: rgba(224,231,255,0.94); font-size: 11.5px; font-weight: 800; flex-shrink: 0; transition: transform 0.15s, background 0.15s; }
.mb-plan:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--mb-tone) 44%, transparent); background: color-mix(in srgb, var(--mb-tone) 20%, rgba(255,255,255,0.05)); color: #fff; }

.mb-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: none; }
.mb-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }

/* ========== 生成中：思考动效（氛围向，非信息向） ========== */
.mb-thinking { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 48px 24px; min-height: 280px; overflow: hidden; }
/* 中心光晕容器 */
.mb-thinking-orb { position: relative; width: 56px; height: 56px; display: grid; place-items: center; }
/* 中心实心圆：青色渐变 + 呼吸 + 辉光 */
.mb-thinking-core { position: relative; width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle, #fff 0%, var(--mb-tone, #38bdf8) 55%, color-mix(in srgb, var(--mb-tone, #38bdf8) 40%, transparent) 100%); box-shadow: 0 0 18px color-mix(in srgb, var(--mb-tone, #38bdf8) 65%, transparent), 0 0 36px color-mix(in srgb, var(--mb-tone, #38bdf8) 35%, transparent); animation: mb-core-breath 2.4s ease-in-out infinite; z-index: 2; }
/* 同心圆波纹：3 层延迟扩散 */
.mb-thinking-ring { position: absolute; inset: 0; border: 1px solid color-mix(in srgb, var(--mb-tone, #38bdf8) 50%, transparent); border-radius: 50%; opacity: 0; animation: mb-ring-spread 2.4s ease-out infinite; }
.mb-thinking-ring.is-2 { animation-delay: 0.8s; }
.mb-thinking-ring.is-3 { animation-delay: 1.6s; }
/* 阶段文字 + 呼吸省略号 */
.mb-thinking-text { margin: 0; color: rgba(226, 232, 240, 0.72); font-size: 13px; font-weight: 600; letter-spacing: 0.02em; display: inline-flex; align-items: baseline; gap: 2px; animation: mb-text-fade 2.4s ease-in-out infinite; }
.mb-thinking-dots { display: inline-flex; gap: 3px; margin-left: 4px; }
.mb-thinking-dots i { width: 4px; height: 4px; border-radius: 50%; background: color-mix(in srgb, var(--mb-tone, #38bdf8) 70%, white); opacity: 0.4; animation: mb-dot-breath 1.5s ease-in-out infinite; }
.mb-thinking-dots i:nth-child(2) { animation-delay: 0.2s; }
.mb-thinking-dots i:nth-child(3) { animation-delay: 0.4s; }
/* 工作步骤列表（三态：已完成 / 进行中 / 待做） */
.mb-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; width: 100%; max-width: 240px; }
.mb-step { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; transition: opacity 0.2s; }
.mb-step-icon { display: grid; width: 16px; height: 16px; flex-shrink: 0; place-items: center; }
.mb-step.is-done .mb-step-icon { color: #2dd4bf; }
.mb-step.is-running .mb-step-icon { color: color-mix(in srgb, var(--mb-tone, #38bdf8) 80%, white); }
.mb-step.is-error .mb-step-icon { color: #fda4af; }
.mb-step.is-pending .mb-step-icon { color: rgba(148, 163, 184, 0.45); }
.mb-step-pulse { width: 8px; height: 8px; border-radius: 50%; background: color-mix(in srgb, var(--mb-tone, #38bdf8) 80%, white); box-shadow: 0 0 8px color-mix(in srgb, var(--mb-tone, #38bdf8) 60%, transparent); animation: mb-step-breath 1.2s ease-in-out infinite; }
.mb-step-dot { width: 7px; height: 7px; border-radius: 50%; border: 1px solid currentColor; background: transparent; }
.mb-step-label { flex: 1 1 auto; min-width: 0; color: rgba(226, 232, 240, 0.7); }
.mb-step.is-done .mb-step-label { color: rgba(148, 163, 184, 0.6); }
.mb-step.is-running .mb-step-label { color: rgba(248, 250, 252, 0.95); font-weight: 700; }
.mb-step.is-pending .mb-step-label { color: rgba(148, 163, 184, 0.4); }
.mb-step-summary { color: rgba(148, 163, 184, 0.55); font-size: 10.5px; font-weight: 500; }
.mb-step.is-done .mb-step-summary { color: rgba(45, 212, 191, 0.7); }
@keyframes mb-step-breath { 0%, 100% { opacity: 0.5; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.1); } }

/* 背景流光：卡片底部横向扫描 */
.mb-thinking-scan { position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--mb-tone, #38bdf8) 70%, white), transparent); animation: mb-scan-flow 2.8s ease-in-out infinite; }
/* 动画关键帧 */
@keyframes mb-core-breath { 0%, 100% { transform: scale(0.82); opacity: 0.7; } 50% { transform: scale(1.12); opacity: 1; } }
@keyframes mb-ring-spread { 0% { transform: scale(0.4); opacity: 0.75; } 100% { transform: scale(1.8); opacity: 0; } }
@keyframes mb-text-fade { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.92; } }
@keyframes mb-dot-breath { 0%, 100% { opacity: 0.3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }
@keyframes mb-scan-flow { 0% { transform: translateX(-100%); opacity: 0; } 50% { opacity: 0.9; } 100% { transform: translateX(100%); opacity: 0; } }

.mb-refreshing { display: flex; align-items: center; gap: 8px; padding: 7px 14px; border-bottom: 1px solid color-mix(in srgb, var(--mb-tone-2) 16%, transparent); background: color-mix(in srgb, var(--mb-tone-2) 7%, rgba(2,6,23,0.18)); color: rgba(224,242,254,0.76); font-size: 12px; font-weight: 700; }
.mb-refreshing-pulse { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: color-mix(in srgb, var(--mb-tone-2) 78%, white); animation: mb-pulse 1.1s ease-in-out infinite; }
.mb-loading { display: flex; align-items: center; gap: 8px; padding: 18px 14px; }
.mb-loading-text { margin-left: 6px; color: rgba(255,255,255,0.52); font-size: 13px; }
.mb-dot { width: 5px; height: 5px; border-radius: 50%; background: color-mix(in srgb, var(--mb-tone) 70%, white); animation: mb-bounce 1.2s ease-in-out infinite; }
.mb-dot:nth-child(2) { animation-delay: 0.15s; }
.mb-dot:nth-child(3) { animation-delay: 0.3s; }
.mb-error { display: flex; align-items: center; gap: 8px; padding: 18px 14px; color: rgba(252,165,165,0.85); font-size: 12.5px; }
.mb-retry { height: 25px; flex-shrink: 0; padding: 0 10px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.82); font-size: 12px; }
.mb-unconfigured { display: flex; align-items: center; gap: 8px; padding: 14px; color: rgba(255,255,255,0.55); font-size: 12.5px; }
.mb-unconfigured svg { color: color-mix(in srgb, var(--mb-tone) 70%, white); }
.mb-config { height: 25px; flex-shrink: 0; padding: 0 10px; border: 1px solid color-mix(in srgb, var(--mb-tone) 30%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--mb-tone) 10%, rgba(255,255,255,0.04)); color: rgba(224,231,255,0.9); font-size: 11.5px; font-weight: 800; }
.mb-config:hover { border-color: color-mix(in srgb, var(--mb-tone) 44%, transparent); }

/* ========== plan 模式：topPriority 高亮卡 ========== */
.mb-top { padding: 14px; border-bottom: 1px solid color-mix(in srgb, var(--mb-tone) 12%, transparent); background: linear-gradient(180deg, color-mix(in srgb, var(--mb-tone) 10%, transparent), transparent); }
.mb-top-kicker { display: flex; align-items: center; gap: 6px; color: color-mix(in srgb, var(--mb-tone) 82%, white 6%); font: 850 10.5px/1 var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
.mb-top-dot { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: var(--mb-danger, #fb7185); box-shadow: 0 0 8px var(--mb-danger, #fb7185); }
.mb-top-risk { padding: 1px 6px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--mb-danger, #fb7185) 40%, transparent); background: color-mix(in srgb, var(--mb-danger, #fb7185) 12%, transparent); color: #fda4af; font-size: 9.5px; font-weight: 800; }
.mb-top-risk-normal { padding: 1px 6px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--mb-tone-2) 30%, transparent); background: color-mix(in srgb, var(--mb-tone-2) 10%, transparent); color: rgba(226,232,240,0.6); font-size: 9.5px; font-weight: 600; }
.mb-top-deadline { color: rgba(226,232,240,0.5); font-size: 10px; font-weight: 600; }
.mb-top-weather { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; padding: 3px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--mb-tone-2) 28%, transparent); background: color-mix(in srgb, var(--mb-tone-2) 12%, transparent); color: color-mix(in srgb, var(--mb-tone-2) 92%, white); font-size: 12.5px; font-weight: 700; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 50%; }
.mb-top-title-row { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
.mb-top-title { flex: 1 1 auto; min-width: 0; color: rgba(255,255,255,0.96); font-size: 16px; font-weight: 800; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mb-top-pri { flex-shrink: 0; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: rgba(226,232,240,0.7); font: 800 10px/1 var(--font-mono); }
.mb-top-reason { margin: 6px 0 0; color: rgba(226,232,240,0.7); font-size: 12px; line-height: 1.55; }
.mb-top-actions { display: flex; gap: 6px; margin-top: 8px; }
.mb-top-action { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: rgba(255,255,255,0.04); color: rgba(226,232,240,0.75); font-size: 10.5px; font-weight: 600; transition: border-color 0.15s, color 0.15s, background 0.15s; }
.mb-top-action:hover { border-color: color-mix(in srgb, var(--mb-tone) 30%, transparent); color: rgba(255,255,255,0.95); background: color-mix(in srgb, var(--mb-tone) 10%, transparent); }

/* ========== focus 主线一句话 ========== */
.mb-focus { display: flex; align-items: flex-start; gap: 6px; margin: 0; padding: 10px 14px; border-bottom: 1px solid color-mix(in srgb, var(--mb-tone) 10%, transparent); color: rgba(226,232,240,0.75); font-size: 12.5px; line-height: 1.55; }
.mb-focus svg { margin-top: 2px; color: color-mix(in srgb, var(--mb-tone) 70%, white); }

/* ========== 分组列表 ========== */
.mb-groups { padding: 0 14px 12px; }
.mb-group { border-bottom: 1px solid rgba(255,255,255,0.05); }
.mb-group.is-empty { opacity: 0.5; }
.mb-group-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 0; background: none; border: 0; cursor: pointer; text-align: left; transition: color 0.15s; }
.mb-group-head:disabled { cursor: default; }
.mb-group-head:hover:not(:disabled) { color: rgba(255,255,255,0.95); }
.mb-group-label { color: rgba(248,250,252,0.85); font-size: 12px; font-weight: 750; }
.mb-group-count { padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); color: rgba(226,232,240,0.55); font: 700 10px/1 var(--font-mono); }
.mb-group-chevron { margin-left: auto; width: 12px; height: 12px; color: rgba(226,232,240,0.4); transition: transform 0.18s; }
.mb-group-chevron.is-open { transform: rotate(180deg); }
.mb-group-list { margin: 0; padding: 0 0 10px; list-style: none; }
.mb-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 4px; border-radius: 6px; transition: background 0.15s; }
.mb-item:hover { background: rgba(255,255,255,0.03); }
.mb-item-bullet { width: 5px; height: 5px; flex-shrink: 0; margin-top: 7px; border-radius: 50%; background: rgba(148,163,184,0.5); }
.mb-item-bullet[data-tone='risk'] { background: var(--mb-danger, #fb7185); box-shadow: 0 0 6px var(--mb-danger, #fb7185); }
.mb-item-body { flex: 1 1 auto; min-width: 0; }
.mb-item-title-row { display: flex; align-items: baseline; gap: 6px; }
.mb-item-title { flex: 1 1 auto; min-width: 0; color: rgba(248,250,252,0.92); font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mb-item-risk { padding: 1px 5px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--mb-danger, #fb7185) 35%, transparent); background: color-mix(in srgb, var(--mb-danger, #fb7185) 10%, transparent); color: #fda4af; font-size: 9px; font-weight: 800; }
.mb-item-risk-normal { padding: 1px 5px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--mb-tone-2) 25%, transparent); background: color-mix(in srgb, var(--mb-tone-2) 8%, transparent); color: rgba(226,232,240,0.5); font-size: 9px; font-weight: 600; }
.mb-item-pri { padding: 1px 5px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: rgba(226,232,240,0.55); font: 700 9px/1 var(--font-mono); }
.mb-item-reason { margin: 3px 0 0; color: rgba(226,232,240,0.6); font-size: 11.5px; line-height: 1.5; }
.mb-item-action { display: flex; align-items: flex-start; gap: 4px; margin: 3px 0 0; color: color-mix(in srgb, var(--mb-tone) 70%, white 10%); font-size: 11.5px; line-height: 1.5; }
.mb-item-ops { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.mb-item:hover .mb-item-ops { opacity: 1; }
.mb-item-op { display: grid; width: 24px; height: 24px; place-items: center; border: 1px solid rgba(255,255,255,0.08); border-radius: 5px; background: rgba(255,255,255,0.04); color: rgba(226,232,240,0.55); transition: border-color 0.15s, color 0.15s; }
.mb-item-op:hover { border-color: color-mix(in srgb, var(--mb-tone) 30%, transparent); color: rgba(255,255,255,0.95); }

/* ========== 时间节奏 ========== */
.mb-timing { padding: 12px 14px; border-top: 1px solid color-mix(in srgb, var(--mb-tone) 10%, transparent); }
.mb-timing-head { display: flex; align-items: center; gap: 6px; color: color-mix(in srgb, var(--mb-tone) 82%, white 6%); font: 850 10.5px/1 var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 8px; }
.mb-timing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.mb-timing-slot { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid rgba(255,255,255,0.06); border-radius: 7px; background: rgba(255,255,255,0.02); }
.mb-timing-kicker { color: rgba(226,232,240,0.45); font: 800 10px/1 var(--font-mono); }
.mb-timing-text { color: rgba(248,250,252,0.85); font-size: 11.5px; line-height: 1.45; }

/* ========== 天气提示 ========== */
.mb-weather { display: flex; align-items: flex-start; gap: 8px; margin: 0 14px 14px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--mb-tone-2) 20%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--mb-tone-2) 8%, transparent); color: rgba(224,242,254,0.85); font-size: 12px; line-height: 1.5; }
.mb-weather svg { color: color-mix(in srgb, var(--mb-tone-2) 70%, white); }

/* ========== fallback Markdown ========== */
.mb-body { padding: 14px; color: rgba(255,255,255,0.84); font-size: 14px; line-height: 1.8; }
.mb-body :deep(p) { margin: 0 0 7px; }
.mb-body :deep(p:last-child) { margin-bottom: 0; }
.mb-body :deep(strong) { color: #fff; font-weight: 700; }
.mb-body :deep(ul) { margin: 4px 0 2px; padding: 0; list-style: none; }
.mb-body :deep(li) { position: relative; margin: 3px 0; padding-left: 14px; }
.mb-body :deep(li)::before { position: absolute; top: 9px; left: 2px; width: 4px; height: 4px; border-radius: 50%; background: color-mix(in srgb, var(--mb-tone) 72%, transparent); content: ''; }
.mb-body.is-muted { opacity: 0.72; filter: saturate(0.86); }

/* ========== 过渡与动画 ========== */
.mb-expand-enter-active, .mb-expand-leave-active { transition: opacity 0.18s ease, max-height 0.22s ease; overflow: hidden; }
.mb-expand-enter-from, .mb-expand-leave-to { opacity: 0; max-height: 0; }
.mb-expand-enter-to, .mb-expand-leave-from { max-height: 600px; }
.mb-fade-enter-active { transition: opacity 0.4s ease, transform 0.4s ease; }
.mb-fade-leave-active { transition: opacity 0.25s ease; }
.mb-fade-enter-from { opacity: 0; transform: translateY(-6px); }
.mb-fade-leave-to { opacity: 0; }
@keyframes mb-spin { to { transform: rotate(360deg); } }
@keyframes mb-pulse { 0%, 100% { opacity: 0.45; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }
@keyframes mb-bounce { 0%, 80%, 100% { opacity: 0.3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }

@media (prefers-reduced-motion: reduce) {
  .mb-refresh.is-spinning svg, .mb-dot, .mb-refreshing-pulse, .mb-thinking-core, .mb-thinking-ring, .mb-thinking-text, .mb-thinking-dots i, .mb-thinking-scan, .mb-step-pulse, .mb-fade-enter-active, .mb-fade-leave-active, .mb-expand-enter-active, .mb-expand-leave-active { animation: none; transition: none; }
  .mb-plan:hover { transform: none; }
}
</style>
