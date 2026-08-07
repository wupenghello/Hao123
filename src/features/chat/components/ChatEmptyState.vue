<script setup lang="ts">
/** 空态：操作台式工作台概览——今日读数 + 快捷指令 + 最近会话恢复。 */
import { computed } from 'vue'
import { useChatStore } from '../store'
import { useInboxInsights } from '@/features/insights'
import { useChatSettings } from '../settings'
import { formatDate, daypart } from '../utils'
import { currentModelSupportsVision } from '../vision-models'
import IconConfig from '~icons/mdi/cog-outline'
import IconDelete from '~icons/mdi/trash-can-outline'

const store = useChatStore()
const { workItems, summary } = useInboxInsights()

const nowLabel = computed(() => {
  const d = new Date()
  return `${formatDate(d)} ${daypart(d.getHours())}`
})

/** 最近有内容的会话（最多 5 个） */
const recentSessions = computed(() =>
  store.sessions
    .filter((s) => s.messages.some((m) => m.role === 'user' || m.role === 'assistant' || !!m.ui?.length))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5),
)

/** 今日风险读数（来自收件箱预测，与首页 InboxDeck 同口径） */
const riskLine = computed(() => {
  const s = summary.value
  const parts: string[] = []
  if (s.overdue) parts.push(`逾期 ${s.overdue}`)
  if (s.dueSoon) parts.push(`临期 ${s.dueSoon}`)
  if (s.stalled) parts.push(`停滞 ${s.stalled}`)
  if (!parts.length) return '今日无风险项'
  return parts.join(' · ')
})

function ask(text: string) {
  void store.send(text)
}

function switchTo(id: string) {
  void store.switchSession(id)
}

function deleteSession(id: string, e: MouseEvent) {
  e.stopPropagation()
  void store.deleteSession(id)
}

function relTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

const GROUPS: { eyebrow: string; items: { label: string; text: string }[] }[] = [
  {
    eyebrow: 'DAILY',
    items: [
      { label: '今天怎么安排', text: '帮我排一下今天的工作：看看指派给我的任务、Bug 和本地待办，按优先级给个节奏。' },
      { label: '有什么风险', text: '看看我手头有哪些逾期、临期或停滞的工作项，逐个说说为什么。' },
    ],
  },
  {
    eyebrow: 'DATA',
    items: [
      { label: '查一下天气', text: '今天天气怎么样，需要带伞或者加衣服吗？' },
      { label: '看一下代码库状态', text: '看看 wbscf-web 仓库当前的分支和变更情况。' },
    ],
  },
  {
    eyebrow: 'WRITE',
    items: [
      { label: '记一个待办', text: '记一条本地待办：' },
      { label: '整理调研文档', text: '把最近一次外部调研整理成 Markdown 记录。' },
    ],
  },
]

const { settings } = useChatSettings()
/** 图片提示随激活模型的视觉能力门控（与输入栏同口径） */
const IMG_HINT = computed(() =>
  currentModelSupportsVision()
    ? `Ctrl+V 贴图 · 最多 ${settings.value.maxImages} 张`
    : '当前模型不支持图片',
)
</script>

<template>
  <div class="empty">
    <!-- 顶部：身份与当前时间 -->
    <div class="empty-top">
      <span class="empty-eyebrow">XIAOWU · WORKBENCH</span>
      <span class="empty-clock">{{ nowLabel }}</span>
    </div>

    <!-- 今日读数：收件箱总数 + 风险构成（风险计数只算有风险项） -->
    <div class="empty-readout">
      <div class="readout-line">
        <span class="readout-label">INBOX</span>
        <span class="readout-val">{{ workItems.length }}</span>
        <span class="readout-unit">项工作 · {{ summary.total }} 项有风险</span>
        <span class="readout-detail">{{ riskLine }}</span>
      </div>
    </div>

    <!-- 快捷指令分区 -->
    <div class="empty-groups">
      <section v-for="g in GROUPS" :key="g.eyebrow" class="empty-group">
        <div class="empty-group-head">
          <span class="empty-group-eyebrow">{{ g.eyebrow }}</span>
          <span class="empty-group-line" aria-hidden="true" />
        </div>
        <div class="empty-group-items">
          <button
            v-for="it in g.items"
            :key="it.label"
            type="button"
            class="empty-chip"
            @click="ask(it.text)"
          >
            {{ it.label }}
          </button>
        </div>
      </section>
    </div>

    <!-- 最近会话 -->
    <div v-if="recentSessions.length" class="empty-recent">
      <div class="empty-group-head">
        <span class="empty-group-eyebrow">RESUME</span>
        <span class="empty-group-line" aria-hidden="true" />
      </div>
      <div
        v-for="s in recentSessions"
        :key="s.id"
        role="button"
        tabindex="0"
        class="empty-recent-row"
        @click="switchTo(s.id)"
        @keydown.enter.self.prevent="switchTo(s.id)"
        @keydown.space.self.prevent="switchTo(s.id)"
      >
        <span class="empty-recent-title">{{ s.title }}</span>
        <span class="empty-recent-time">{{ relTime(s.updatedAt) }}</span>
        <button
          type="button"
          class="empty-recent-del"
          title="删除会话"
          @click.stop="deleteSession(s.id, $event)"
        >
          <IconDelete class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- 未配置引导 -->
    <button
      v-if="!store.configured"
      type="button"
      class="empty-config"
      @click="store.openModelConfig()"
    >
      <IconConfig class="w-4 h-4" />
      <span>尚未配置模型线路 — 点击前往模型设置</span>
    </button>

    <p class="empty-hint">
      Enter 发送 · Shift+Enter 换行 · {{ IMG_HINT }} · Esc 收起
    </p>
  </div>
</template>

<style scoped>
.empty {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 12px;
  scrollbar-width: thin;
}
.empty-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.empty-eyebrow {
  font: 700 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.16em;
  color: var(--color-ink-3);
}
.empty-clock {
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}

/* 今日读数 */
.empty-readout {
  padding: 10px 12px;
  border: 1px solid var(--color-line);
  border-left: 2px solid var(--color-accent);
  border-radius: 4px;
  background: var(--color-raised);
  margin-bottom: 14px;
}
.readout-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.readout-label {
  font: 700 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.1em;
  color: var(--color-ink-3);
}
.readout-val {
  margin-left: 2px;
  font: 750 22px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink);
  tabular-nums: auto;
}
.readout-unit {
  font-size: 11.5px;
  color: var(--color-ink-2);
}
.readout-detail {
  margin-left: auto;
  font: 400 10.5px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}

/* 快捷指令分区 */
.empty-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 6px;
}
.empty-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.empty-group-eyebrow {
  font: 700 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.14em;
  color: var(--color-ink-3);
}
.empty-group-line {
  flex: 1;
  height: 1px;
  background: var(--color-line-hair);
}
.empty-group-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.empty-chip {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 3px;
  background: var(--color-raised);
  color: var(--color-ink-2);
  font-size: 12px;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out-quint), color var(--duration-fast) var(--ease-out-quint);
}
.empty-chip:hover {
  border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  color: var(--color-accent-strong);
}

/* 最近会话 */
.empty-recent {
  margin-top: 10px;
}
.empty-recent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.empty-recent-row:hover {
  background: var(--color-base);
}
.empty-recent-row:focus-visible {
  outline: 1px solid var(--color-accent);
  outline-offset: -1px;
}
.empty-recent-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-ink-2);
  font-size: 12px;
  text-align: left;
}
.empty-recent-row:hover .empty-recent-title {
  color: var(--color-ink);
}
.empty-recent-time {
  flex: 0 0 auto;
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.empty-recent-del {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-left: 2px;
  flex: 0 0 auto;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--color-ink-3);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out-quint), color var(--duration-fast) var(--ease-out-quint);
}
.empty-recent-row:hover .empty-recent-del {
  opacity: 1;
}
.empty-recent-del:hover {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
}

/* 未配置引导 */
.empty-config {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  margin-top: 10px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
  color: var(--color-warning);
  font-size: 11.5px;
  cursor: pointer;
}
.empty-config:hover {
  background: color-mix(in srgb, var(--color-warning) 14%, transparent);
}

/* 底部提示 */
.empty-hint {
  margin: auto 0 0;
  padding-top: 10px;
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-4);
}
</style>
