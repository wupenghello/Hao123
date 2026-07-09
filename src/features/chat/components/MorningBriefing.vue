<script setup lang="ts">
/**
 * 每日晨报卡片（首页常驻）
 *
 * 小吴每天基于真实工作台快照（天气 + 指派给我的禅道任务/Bug + 本地待办）生成一份
 * 「今日简报」：一句话点出今天最该先抓的事 + 关键事项要点 + 贴心提示。
 * 持久化到 localStorage——同一天只自动生成一次，刷新页面复用，次日或点「刷新」才更新，
 * 避免每次进首页都跑一次 LLM。LLM 未配置时不渲染；首次生成显示骨架，失败可重试；
 * 刷新时保留旧简报可见、仅按钮转圈，生成完替换。
 *
 * 视觉沿用首页「AI 内容」语言（玻璃渐变卡），但用 indigo/sky 区别于收件箱的 teal，
 * 让「AI 简报」与「待办清单」一眼可分。
 */
import { computed } from 'vue'
import { useBriefing, renderMarkdown, ASSISTANT_NAME, buildBriefingActionFlowPrompt } from '@/features/chat'
import { useInboxInsights, deadlineDays } from '@/features/insights'
import {
  useTaskStore,
  useBugStore,
  priorityBadge as ztPri,
  severityBadge,
  taskStatusBadge,
  bugStatusBadge,
  isUrgentTask,
  isUrgentBug,
} from '@/features/zentao'
import type { ZentaoTask, ZentaoBug } from '@/features/zentao'
import { useLocalTaskStore, priBadge, isUrgentLocalTask } from '@/features/local-tasks'
import type { LocalTask } from '@/features/local-tasks'
import { useChatStore } from '../store'
import IconSpark from '~icons/mdi/star-four-points'
import IconRefresh from '~icons/mdi/refresh'
import IconAlert from '~icons/mdi/alert-circle-outline'

const { briefing, generating, error, refresh } = useBriefing()
const chat = useChatStore()
const taskStore = useTaskStore()
const bugStore = useBugStore()
const localStore = useLocalTaskStore()
const { predictions, summary } = useInboxInsights()

type MorningKind = 'task' | 'bug' | 'local'
interface MorningItem {
  key: string
  kind: MorningKind
  title: string
  source: string
  priority: number
  priorityLabel: string
  status: string
  deadline?: string
  urgent: boolean
  riskLabel?: string
  riskWhy?: string
}

function cleanDeadline(deadline?: string): string | undefined {
  if (!deadline || /^0000/.test(deadline)) return undefined
  return String(deadline).slice(0, 10)
}

function deadlineSort(deadline?: string): number {
  const days = deadlineDays(deadline)
  return days == null ? 999 : days
}

function fromTask(t: ZentaoTask): MorningItem {
  const key = `task-${t.id}`
  const risk = predictions.value.get(key)
  const pri = Number(t.pri) || 4
  return {
    key,
    kind: 'task',
    title: t.name,
    source: '禅道任务',
    priority: pri,
    priorityLabel: ztPri(t.pri)?.label || `P${pri}`,
    status: taskStatusBadge(t.status).label,
    deadline: cleanDeadline(t.deadline),
    urgent: isUrgentTask(t),
    riskLabel: risk?.label,
    riskWhy: risk?.why,
  }
}

function fromBug(b: ZentaoBug): MorningItem {
  const key = `bug-${b.id}`
  const risk = predictions.value.get(key)
  const pri = Number(b.severity || b.pri) || 4
  return {
    key,
    kind: 'bug',
    title: b.title,
    source: '禅道 Bug',
    priority: pri,
    priorityLabel: severityBadge(b.severity)?.label || ztPri(b.pri)?.label || `P${pri}`,
    status: bugStatusBadge(b.status).label,
    deadline: cleanDeadline(b.deadline),
    urgent: isUrgentBug(b),
    riskLabel: risk?.label,
    riskWhy: risk?.why,
  }
}

function fromLocal(t: LocalTask): MorningItem {
  const key = `local-${t.id}`
  const risk = predictions.value.get(key)
  return {
    key,
    kind: 'local',
    title: t.title,
    source: '本地待办',
    priority: t.pri,
    priorityLabel: priBadge(t.pri).label,
    status: t.done ? '已完成' : '未完成',
    deadline: cleanDeadline(t.deadline),
    urgent: isUrgentLocalTask(t),
    riskLabel: risk?.label,
    riskWhy: risk?.why,
  }
}

const morningItems = computed<MorningItem[]>(() => [
  ...taskStore.assigned.map(fromTask),
  ...bugStore.assigned.map(fromBug),
  ...localStore.open.map(fromLocal),
])

function itemRank(it: MorningItem): number {
  const riskWeight = it.riskLabel?.includes('逾期') ? 0 : it.riskLabel?.includes('今天') || it.riskLabel?.includes('明天') ? 1 : it.riskLabel ? 2 : 3
  return riskWeight * 1000 + (it.urgent ? 0 : 100) + it.priority * 10 + deadlineSort(it.deadline)
}

const sortedItems = computed(() => [...morningItems.value].sort((a, b) => itemRank(a) - itemRank(b)))
const firstAction = computed(() => sortedItems.value[0] ?? null)
const riskItems = computed(() => sortedItems.value.filter((it) => it.riskLabel || it.urgent).slice(0, 3))
const deferrableItems = computed(() =>
  sortedItems.value
    .filter((it) => !it.riskLabel && !it.urgent && it.priority >= 3 && deadlineSort(it.deadline) > 1)
    .slice(0, 3),
)

const actionContext = computed(() => [
  `今天先抓：${firstAction.value ? `${firstAction.value.source}「${firstAction.value.title}」` : '当前没有明显优先项'}`,
  `风险项：${riskItems.value.length ? riskItems.value.map((it) => `${it.source}「${it.title}」(${it.riskLabel || '紧急'})`).join('；') : '暂无'}`,
  `可推迟项：${deferrableItems.value.length ? deferrableItems.value.map((it) => `${it.source}「${it.title}」`).join('；') : '暂无'}`,
  briefing.value?.content ? `晨报正文：\n${briefing.value.content}` : '',
].filter(Boolean).join('\n'))

/** 看完简报后进入行动流，而不是只打开空聊天 */
function startActionFlow() {
  if (!actionContext.value) return
  chat.show()
  void chat.send(buildBriefingActionFlowPrompt(actionContext.value))
}

const html = computed(() => (briefing.value ? renderMarkdown(briefing.value.content) : ''))

/** 「X 分钟前」相对时间（让用户知道这简报是多久前生成的） */
const relTime = computed(() => {
  if (!briefing.value) return ''
  const diff = Date.now() - briefing.value.generatedAt
  if (diff < 60_000) return '刚刚'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  return `${h} 小时前`
})
</script>

<template>
  <Transition name="mb-fade">
    <section v-if="briefing || generating || error" class="mb-card" :class="{ 'is-refreshing': generating && briefing }">
      <header class="mb-head">
        <span class="mb-icon"><IconSpark class="w-3.5 h-3.5" /></span>
        <span class="mb-title">今日简报</span>
        <span v-if="briefing" class="mb-time" :class="{ 'is-live': generating }">
          {{ generating ? '正在更新' : relTime }}
        </span>
        <button
          class="mb-refresh"
          :class="{ 'is-spinning': generating }"
          :disabled="generating"
          :title="generating ? '生成中…' : '刷新简报'"
          @click="refresh"
        >
          <IconRefresh class="w-3.5 h-3.5" />
        </button>
      </header>

      <!-- 内容滚动区：header 钉住，正文超长时内部滚动，不被裁、不挤走其它 bento 单元 -->
      <div class="mb-scroll">
      <div v-if="generating && briefing" class="mb-refreshing">
        <span class="mb-refreshing-pulse" />
        <span>正在重新整理简报，旧内容先留着给你看</span>
      </div>

      <!-- 首次生成中（无缓存） -->
      <div v-if="generating && !briefing" class="mb-loading">
        <span class="mb-dot" />
        <span class="mb-dot" />
        <span class="mb-dot" />
        <span class="mb-loading-text">{{ ASSISTANT_NAME }} 正在整理今日简报…</span>
      </div>

      <!-- 错误且无缓存可兜底（有缓存时不遮蔽已有简报，只在无缓存时显示错误态） -->
      <div v-else-if="error && !briefing" class="mb-error">
        <IconAlert class="w-4 h-4 shrink-0" />
        <span class="flex-1 min-w-0 truncate">{{ error }}</span>
        <button class="mb-retry" @click="refresh">重试</button>
      </div>

      <!-- 可操作结论区：先给今天怎么动，再读自然语言简报 -->
      <div v-if="html" class="mb-action" :class="{ 'is-muted': generating }">
        <p class="mb-action-kicker">今天先抓什么</p>

        <section class="mb-first">
          <template v-if="firstAction">
            <div class="mb-first-line">
              <span class="mb-first-title" :title="firstAction.title">{{ firstAction.title }}</span>
              <span class="mb-action-meta">
                <span>{{ firstAction.source }}</span>
                <span>{{ firstAction.priorityLabel }}</span>
                <span>{{ firstAction.status }}</span>
                <span v-if="firstAction.deadline">截止 {{ firstAction.deadline }}</span>
              </span>
            </div>
            <p v-if="firstAction.riskWhy" class="mb-action-why">{{ firstAction.riskWhy }}</p>
          </template>
          <template v-else>
            <div class="mb-first-line">
              <span class="mb-first-title">没有明显优先项</span>
            </div>
            <p class="mb-action-why">当前清单比较平稳，可以按自己的节奏推进。</p>
          </template>
        </section>

        <div class="mb-action-foot">
          <div class="mb-action-summary">
            <span class="mb-stat is-risk" :class="{ 'is-zero': !summary.total }" :title="summary.total ? `${summary.total} 项逾期/临期/停滞` : '没有逾期、临期或停滞项'">
              <b>{{ summary.total }}</b> 风险项
            </span>
            <span class="mb-stat" :class="{ 'is-zero': !deferrableItems.length }" :title="deferrableItems.length ? '低优且不紧迫，可往后排' : '没有明显可推迟项'">
              <b>{{ deferrableItems.length }}</b> 可推迟
            </span>
          </div>
          <button class="mb-plan" :title="`让${ASSISTANT_NAME}排出今天的处理顺序`" @click="startActionFlow">
            <IconSpark class="w-3 h-3" />
            <span>让 {{ ASSISTANT_NAME }} 排期 →</span>
          </button>
        </div>
      </div>

      <!-- 简报正文（refresh 时保留旧内容，按钮转圈，生成完替换） -->
      <div v-if="html" class="mb-body" :class="{ 'is-muted': generating }" v-html="html" />

      <!-- LLM 未配置：引导去模型设置开启「今日简报」 -->
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
.mb-card {
  --mb-tone: var(--accent);
  --mb-tone-2: #2dd4bf;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--mb-tone) 18%, rgba(148, 163, 184, 0.16));
  border-radius: 12px;
  background:
    radial-gradient(circle at 18px 18px, color-mix(in srgb, var(--mb-tone) 17%, transparent), transparent 66px),
    linear-gradient(135deg, color-mix(in srgb, var(--mb-tone) 8%, transparent), transparent 44%),
    rgba(2, 6, 23, 0.32);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.055),
    0 18px 54px rgba(0,0,0,0.2);
  backdrop-filter: blur(18px) saturate(130%);
}
.mb-card::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--mb-tone), transparent);
  opacity: 0.78;
}
.mb-card::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(90deg, rgba(255,255,255,0.044) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255,255,255,0.032) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: linear-gradient(115deg, rgba(0,0,0,0.48), transparent 66%);
}
.mb-card > * {
  position: relative;
  z-index: 1;
}
.mb-card.is-refreshing {
  border-color: color-mix(in srgb, var(--mb-tone) 34%, rgba(148, 163, 184, 0.22));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.075),
    0 18px 54px rgba(0,0,0,0.2),
    0 0 0 1px color-mix(in srgb, var(--mb-tone) 12%, transparent);
}
.mb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  flex-shrink: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--mb-tone) 15%, transparent);
  background: linear-gradient(90deg, color-mix(in srgb, var(--mb-tone) 8%, transparent), transparent);
}
/* 内容滚动区：撑满卡片剩余高度，内部滚动，滚动条隐藏（项目偏好） */
.mb-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
}
.mb-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
.mb-icon {
  display: grid;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--mb-tone) 36%, rgba(255,255,255,0.08));
  border-radius: 8px;
  background: color-mix(in srgb, var(--mb-tone) 13%, rgba(255,255,255,0.04));
  color: color-mix(in srgb, var(--mb-tone) 80%, white);
  box-shadow: 0 0 18px color-mix(in srgb, var(--mb-tone) 18%, transparent);
}
.mb-title {
  color: rgba(248,250,252,0.92);
  font-size: 13px;
  font-weight: 850;
  letter-spacing: -0.01em;
}
.mb-time {
  color: rgba(226,232,240,0.42);
  font-size: 11px;
}
.mb-time.is-live {
  color: color-mix(in srgb, var(--mb-tone-2) 72%, white);
  font-weight: 750;
}
.mb-time.is-live::after {
  display: inline-block;
  width: 12px;
  content: '...';
  animation: mb-ellipsis 1.1s steps(3, end) infinite;
}
.mb-refresh,
.mb-retry,
.mb-plan,
.mb-ask {
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}
.mb-refresh {
  display: grid;
  width: 27px;
  height: 27px;
  margin-left: auto;
  place-items: center;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 9px;
  background: rgba(255,255,255,0.045);
  color: rgba(226,232,240,0.45);
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.mb-refresh:hover:not(:disabled),
.mb-refresh:focus-visible {
  color: white;
  border-color: color-mix(in srgb, var(--mb-tone) 30%, transparent);
  background: color-mix(in srgb, var(--mb-tone) 10%, rgba(255,255,255,0.06));
  outline: 0;
}
.mb-refresh:disabled { cursor: default; opacity: 0.7; }
.mb-refresh.is-spinning svg { animation: mb-spin 0.9s linear infinite; }
@keyframes mb-spin { to { transform: rotate(360deg); } }
@keyframes mb-ellipsis { 0% { clip-path: inset(0 100% 0 0); } 100% { clip-path: inset(0 0 0 0); } }
.mb-refreshing {
  display: flex;
  position: relative;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--mb-tone-2) 16%, transparent);
  background: color-mix(in srgb, var(--mb-tone-2) 7%, rgba(2,6,23,0.18));
  color: rgba(224,242,254,0.76);
  font-size: 12px;
  font-weight: 700;
}
.mb-refreshing::after {
  position: absolute;
  inset: auto 0 0;
  height: 1px;
  content: '';
  background: linear-gradient(90deg, transparent, var(--mb-tone-2), transparent);
  animation: mb-scan 1.2s ease-in-out infinite;
}
.mb-refreshing-pulse {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mb-tone-2) 78%, white);
  box-shadow: 0 0 14px color-mix(in srgb, var(--mb-tone-2) 45%, transparent);
  animation: mb-pulse 1.1s ease-in-out infinite;
}
@keyframes mb-scan {
  0% { transform: translateX(-100%); opacity: 0.25; }
  45% { opacity: 0.9; }
  100% { transform: translateX(100%); opacity: 0.25; }
}
@keyframes mb-pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.15); }
}
.mb-action {
  padding: 12px 14px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--mb-tone) 13%, transparent);
  background:
    linear-gradient(120deg, color-mix(in srgb, var(--mb-tone) 8%, transparent), color-mix(in srgb, var(--mb-tone-2) 4%, transparent)),
    rgba(2, 6, 23, 0.16);
}
.mb-action.is-muted,
.mb-body.is-muted {
  opacity: 0.72;
  filter: saturate(0.86);
  transition: opacity 0.18s, filter 0.18s;
}
.mb-first {
  position: relative;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--mb-tone) 15%, rgba(148,163,184,0.12));
  border-radius: 10px;
  background:
    radial-gradient(circle at 12px 10px, color-mix(in srgb, var(--mb-tone) 10%, transparent), transparent 46px),
    rgba(2, 6, 23, 0.25);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
  padding: 10px;
}
.mb-first::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--mb-tone), transparent);
  opacity: 0.62;
}
/* 底栏：两个计数标签在左，排期按钮在右（同一行） */
.mb-action-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 9px;
}
.mb-action-kicker {
  margin: 0 0 8px;
  color: color-mix(in srgb, var(--mb-tone) 82%, white 6%);
  font: 850 12px/1.2 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
/* 标题 + 元信息同一行流式排布（超长自动换行），不再标题一块、元信息一块 */
.mb-first-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 7px;
}
.mb-first-title {
  color: rgba(255,255,255,0.94);
  font-size: 15px;
  font-weight: 800;
  line-height: 1.35;
}
.mb-action-meta {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: baseline;
  margin: 0;
}
.mb-action-meta span {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 750;
  color: rgba(226,232,240,0.66);
  background: rgba(255,255,255,0.055);
}
.mb-action-why {
  margin: 8px 0 0;
  color: rgba(255,255,255,0.58);
  font-size: 12px;
  line-height: 1.55;
}
/* 行动区计数摘要：取代原先两列标题列表（与 LLM 正文 / 风险雷达去重），只留计数 */
.mb-action-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}
.mb-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--mb-tone) 22%, transparent);
  background: color-mix(in srgb, var(--mb-tone) 8%, rgba(255,255,255,0.03));
  color: rgba(230,238,255,0.78);
  font-size: 11.5px;
}
.mb-stat b {
  font: 800 13px/1 var(--font-mono);
  color: color-mix(in srgb, var(--mb-tone) 88%, white);
  font-variant-numeric: tabular-nums;
}
.mb-stat.is-risk {
  border-color: color-mix(in srgb, var(--mb-danger, #fb7185) 28%, transparent);
  background: color-mix(in srgb, var(--mb-danger, #fb7185) 9%, rgba(255,255,255,0.03));
}
.mb-stat.is-risk b { color: #fda4af; }
.mb-stat.is-zero {
  opacity: 0.5;
}
.mb-plan {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--mb-tone) 28%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--mb-tone) 12%, rgba(255,255,255,0.04));
  color: rgba(224,231,255,0.94);
  font-size: 11.5px;
  font-weight: 800;
  flex-shrink: 0;
  transition: transform 0.15s, background 0.15s, border-color 0.15s;
}
.mb-plan:hover,
.mb-plan:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--mb-tone) 44%, transparent);
  background: color-mix(in srgb, var(--mb-tone) 20%, rgba(255,255,255,0.05));
  color: #fff;
  outline: 0;
}
.mb-body {
  padding: 12px 14px 14px;
  color: rgba(255,255,255,0.82);
  font-size: 13.5px;
  line-height: 1.75;
}
.mb-body :deep(p) { margin: 0 0 7px; }
.mb-body :deep(p:last-child) { margin-bottom: 0; }
.mb-body :deep(strong) { color: #fff; font-weight: 700; }
.mb-body :deep(ul) { margin: 4px 0 2px; padding: 0; list-style: none; }
.mb-body :deep(li) {
  position: relative;
  margin: 3px 0;
  padding-left: 14px;
}
.mb-body :deep(li)::before {
  position: absolute;
  top: 9px;
  left: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mb-tone) 72%, transparent);
  content: '';
}
.mb-body :deep(a) {
  color: color-mix(in srgb, var(--mb-tone) 78%, white);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.mb-foot { padding: 4px 14px 12px; }
.mb-ask {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--mb-tone) 10%, transparent);
  color: rgba(199,210,254,0.86);
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
}
.mb-ask:hover { background: color-mix(in srgb, var(--mb-tone) 18%, transparent); color: #e0e7ff; }
.mb-loading,
.mb-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 14px;
}
.mb-loading-text {
  margin-left: 6px;
  color: rgba(255,255,255,0.52);
  font-size: 13px;
}
.mb-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mb-tone) 70%, white);
  animation: mb-bounce 1.2s ease-in-out infinite;
}
.mb-dot:nth-child(2) { animation-delay: 0.15s; }
.mb-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes mb-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}
.mb-error {
  color: rgba(252,165,165,0.85);
  font-size: 12.5px;
}
.mb-unconfigured {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px;
  color: rgba(255,255,255,0.55);
  font-size: 12.5px;
}
.mb-unconfigured svg { color: color-mix(in srgb, var(--mb-tone) 70%, white); }
.mb-config {
  height: 25px;
  flex-shrink: 0;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--mb-tone) 30%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--mb-tone) 10%, rgba(255,255,255,0.04));
  color: rgba(224,231,255,0.9);
  font-size: 11.5px;
  font-weight: 800;
  transition: background 0.15s, border-color 0.15s;
}
.mb-config:hover {
  border-color: color-mix(in srgb, var(--mb-tone) 44%, transparent);
  background: color-mix(in srgb, var(--mb-tone) 18%, rgba(255,255,255,0.06));
  color: #fff;
}
.mb-error.is-connectivity { color: rgba(254,240,138,0.88); }
.mb-error.is-connectivity svg { color: rgba(252,211,77,0.9); }
.mb-retry {
  height: 25px;
  flex-shrink: 0;
  padding: 0 10px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.82);
  font-size: 12px;
  transition: background 0.15s, border-color 0.15s;
}
.mb-retry:hover,
.mb-retry:focus-visible {
  border-color: color-mix(in srgb, var(--mb-tone) 30%, transparent);
  background: rgba(255,255,255,0.14);
  outline: 0;
}
.mb-fade-enter-active { transition: opacity 0.4s ease, transform 0.4s ease; }
.mb-fade-leave-active { transition: opacity 0.25s ease; }
.mb-fade-enter-from { opacity: 0; transform: translateY(-6px); }
.mb-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .mb-refresh.is-spinning svg,
  .mb-dot,
  .mb-time.is-live::after,
  .mb-refreshing::after,
  .mb-refreshing-pulse { animation: none; }
  .mb-plan,
  .mb-fade-enter-active,
  .mb-fade-leave-active { transition: none; }
  .mb-plan:hover { transform: none; }
}
</style>
