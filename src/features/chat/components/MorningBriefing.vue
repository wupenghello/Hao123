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
    <section v-if="briefing || generating || error" class="mb-card">
      <header class="mb-head">
        <span class="mb-icon"><IconSpark class="w-3.5 h-3.5" /></span>
        <span class="mb-title">今日简报</span>
        <span v-if="briefing && !generating" class="mb-time">{{ relTime }}</span>
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
      <div v-if="html" class="mb-action">
        <section class="mb-first">
          <p class="mb-action-kicker">今天先抓什么</p>
          <template v-if="firstAction">
            <h3 :title="firstAction.title">{{ firstAction.title }}</h3>
            <div class="mb-action-meta">
              <span>{{ firstAction.source }}</span>
              <span>{{ firstAction.priorityLabel }}</span>
              <span>{{ firstAction.status }}</span>
              <span v-if="firstAction.deadline">截止 {{ firstAction.deadline }}</span>
            </div>
            <p v-if="firstAction.riskWhy" class="mb-action-why">{{ firstAction.riskWhy }}</p>
          </template>
          <template v-else>
            <h3>没有明显优先项</h3>
            <p class="mb-action-why">当前清单比较平稳，可以按自己的节奏推进。</p>
          </template>
        </section>

        <div class="mb-action-cols">
          <section class="mb-action-block">
            <div class="mb-action-block-head">
              <span>风险项</span>
              <b>{{ summary.total }}</b>
            </div>
            <ul v-if="riskItems.length" class="mb-mini-list">
              <li v-for="it in riskItems" :key="it.key">
                <span class="mb-mini-title" :title="it.title">{{ it.title }}</span>
                <span class="mb-mini-tag">{{ it.riskLabel || '紧急' }}</span>
              </li>
            </ul>
            <p v-else class="mb-empty-line">暂无逾期、临期或停滞项。</p>
          </section>

          <section class="mb-action-block">
            <div class="mb-action-block-head">
              <span>可推迟项</span>
              <b>{{ deferrableItems.length }}</b>
            </div>
            <ul v-if="deferrableItems.length" class="mb-mini-list">
              <li v-for="it in deferrableItems" :key="it.key">
                <span class="mb-mini-title" :title="it.title">{{ it.title }}</span>
                <span class="mb-mini-tag is-soft">{{ it.priorityLabel }}</span>
              </li>
            </ul>
            <p v-else class="mb-empty-line">暂时没有明显可推迟项。</p>
          </section>
        </div>

        <button class="mb-plan" :title="`让${ASSISTANT_NAME}排出今天的处理顺序`" @click="startActionFlow">
          <IconSpark class="w-3 h-3" />
          <span>让 {{ ASSISTANT_NAME }} 排期 →</span>
        </button>
      </div>

      <!-- 简报正文（refresh 时保留旧内容，按钮转圈，生成完替换） -->
      <div v-if="html" class="mb-body" v-html="html" />
    </section>
  </Transition>
</template>

<style scoped>
.mb-card {
  --mb-tone: #a78bfa;
  --mb-tone-2: #22d3ee;
  position: relative;
  overflow: hidden;
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
.mb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--mb-tone) 15%, transparent);
  background: linear-gradient(90deg, color-mix(in srgb, var(--mb-tone) 8%, transparent), transparent);
}
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
.mb-action {
  padding: 12px 14px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--mb-tone) 13%, transparent);
  background:
    linear-gradient(120deg, color-mix(in srgb, var(--mb-tone) 8%, transparent), color-mix(in srgb, var(--mb-tone-2) 4%, transparent)),
    rgba(2, 6, 23, 0.16);
}
.mb-first,
.mb-action-block {
  position: relative;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--mb-tone) 15%, rgba(148,163,184,0.12));
  border-radius: 10px;
  background:
    radial-gradient(circle at 12px 10px, color-mix(in srgb, var(--mb-tone) 10%, transparent), transparent 46px),
    rgba(2, 6, 23, 0.25);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}
.mb-first { padding: 10px; }
.mb-first::before,
.mb-action-block::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--mb-tone), transparent);
  opacity: 0.62;
}
.mb-action-kicker {
  margin: 0 0 5px;
  color: color-mix(in srgb, var(--mb-tone) 76%, white 6%);
  font: 850 9px/1 var(--hud-font-data, ui-monospace, SFMono-Regular, Menlo, monospace);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.mb-first h3 {
  margin: 0;
  overflow: hidden;
  color: rgba(255,255,255,0.94);
  font-size: 13.5px;
  font-weight: 800;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mb-action-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
  margin-top: 7px;
}
.mb-action-meta span,
.mb-mini-tag {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 750;
}
.mb-action-meta span {
  color: rgba(226,232,240,0.66);
  background: rgba(255,255,255,0.055);
}
.mb-action-why {
  margin: 8px 0 0;
  color: rgba(255,255,255,0.58);
  font-size: 12px;
  line-height: 1.55;
}
.mb-action-cols {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-top: 9px;
}
.mb-action-block { padding: 9px; }
.mb-action-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
  color: rgba(255,255,255,0.78);
  font-size: 11.5px;
  font-weight: 800;
}
.mb-action-block-head b {
  color: color-mix(in srgb, var(--mb-tone) 82%, white);
  font: 850 11px/1 var(--hud-font-data, ui-monospace, monospace);
}
.mb-mini-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.mb-mini-list li {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}
.mb-mini-list li + li { margin-top: 6px; }
.mb-mini-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: rgba(255,255,255,0.66);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mb-mini-tag {
  flex-shrink: 0;
  background: rgba(244,63,94,0.12);
  color: #fda4af;
}
.mb-mini-tag.is-soft {
  background: color-mix(in srgb, var(--mb-tone-2) 10%, transparent);
  color: rgba(191,219,254,0.78);
}
.mb-empty-line {
  margin: 0;
  color: rgba(255,255,255,0.42);
  font-size: 12px;
}
.mb-plan {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  margin-top: 10px;
  padding: 0 11px;
  border: 1px solid color-mix(in srgb, var(--mb-tone) 28%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--mb-tone) 12%, rgba(255,255,255,0.04));
  color: rgba(224,231,255,0.94);
  font-size: 12px;
  font-weight: 800;
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
  .mb-dot { animation: none; }
  .mb-plan,
  .mb-fade-enter-active,
  .mb-fade-leave-active { transition: none; }
  .mb-plan:hover { transform: none; }
}
</style>
