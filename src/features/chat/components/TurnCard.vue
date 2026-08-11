<script setup lang="ts">
/**
 * 回合卡（分型渲染）：一次问答 = 一个 Turn。
 *
 * 形态由 decideTurnMode 判定（answer-first / report / taskflow），用户可手动切换兜底。
 * 共同原则：答案永远在过程之上；过程折叠为一行摘要，展开可审计。
 *
 * 结构：
 *  - user 气泡（顶部）
 *  - taskflow → TurnProcess（过程含审批）优先展示，AnswerCard 收尾
 *  - answer-first / report → AnswerCard 为主体，TurnProcess 折叠在下方
 *  - 头部：形态阶段 + 进度 + 状态
 */
import { computed, ref } from 'vue'
import type { Turn } from '../turns'
import { useChatStore } from '../store'
import { decideTurnMode } from '../decide-turn-mode'
import type { TurnMode } from '../decide-turn-mode'
import AnswerCard from './AnswerCard.vue'
import TurnProcess from './TurnProcess.vue'
import IconPlay from '~icons/mdi/play'

const props = defineProps<{
  turn: Turn
  index: number
  isLastTurn: boolean
  streaming: boolean
}>()

const store = useChatStore()

/** 用户手动形态切换（记忆到 localStorage，方便对照 mockup 与调试） */
const OVERRIDE_KEY = 'hao123-turn-mode-override'
const autoMode = computed<TurnMode>(() => decideTurnMode(props.turn))
function loadOverride(): TurnMode | null {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY)
    if (raw === 'answer-first' || raw === 'report' || raw === 'taskflow') return raw
  } catch { /* 忽略 */ }
  return null
}
const manualOverride = ref<TurnMode | null>(loadOverride())
const mode = computed<TurnMode>(() => manualOverride.value ?? autoMode.value)

function switchMode(m: TurnMode) {
  manualOverride.value = m
  try { localStorage.setItem(OVERRIDE_KEY, m) } catch { /* 忽略 */ }
}

/** 阶段文案（taskflow 下 pending 优先） */
const statusText = computed(() => {
  if (props.turn.steps?.some((s) => s.approval || s.status === 'pending')) return '等待确认'
  if (props.streaming) {
    const doneCount = props.turn.steps?.filter((s) => s.status === 'done' || s.status === 'error' || s.status === 'pending').length ?? 0
    const total = props.turn.steps?.length ?? 0
    switch (store.turnPhase) {
      case 'thinking': return '思考中'
      case 'working': return `正在执行 ${Math.min(doneCount, total)}/${total} 个动作`
      case 'composing': return '正在组织回答'
    }
  }
  if (props.turn.status === 'aborted') return '已停止'
  if (props.turn.status === 'failed') return '出错了'
  return '完成'
})
const statusCls = computed(() => {
  if (props.turn.steps?.some((s) => s.approval || s.status === 'pending')) return 'is-pending'
  if (props.streaming) return 'is-active'
  if (props.turn.status === 'aborted') return 'is-aborted'
  if (props.turn.status === 'failed') return 'is-error'
  return 'is-done'
})

const showResume = computed(() =>
  !props.streaming
  && props.isLastTurn
  && (props.turn.status === 'aborted' || props.turn.status === 'failed')
  && (props.turn.answer || props.turn.steps.length),
)

function onResume() {
  void store.resumeAfterStop()
}

const MODE_LABELS: Record<TurnMode, string> = {
  'answer-first': '回答',
  report: '报告',
  taskflow: '操作',
}

/** 用户气泡时间 */
function fmtTime(ts: number | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <section class="turn" :class="statusCls">
    <!-- 用户消息气泡 -->
    <div class="user">
      <div class="user-top">
        <span class="user-eyebrow">我</span>
        <span class="user-time">{{ fmtTime(turn.createdAt) }}</span>
      </div>
      <div class="user-bubble">
        <p class="user-text">{{ turn.userContent }}</p>
        <div v-if="turn.images?.length" class="user-imgs">
          <img
            v-for="(img, i) in turn.images"
            :key="i"
            :src="img"
            class="user-thumb"
            alt="用户附图"
          />
        </div>
      </div>
    </div>

    <!-- 回合头：状态（中性色，克制）+ 形态切换（hover 才浮现）+ 继续生成 -->
    <div class="turn-head">
      <span class="turn-status" :class="statusCls">{{ statusText }}</span>
      <span class="spacer" />
      <span class="mode-switch">
        <button
          v-for="(m) in (['answer-first', 'report', 'taskflow'] as TurnMode[])"
          :key="m"
          type="button"
          class="mode-btn"
          :class="{ 'is-active': mode === m }"
          :title="`切换为${MODE_LABELS[m]}形态`"
          @click="switchMode(m)"
        >{{ MODE_LABELS[m] }}</button>
      </span>
      <button
        v-if="showResume"
        type="button"
        class="turn-resume"
        title="从已生成的部分继续"
        @click="onResume"
      >
        <IconPlay class="w-3 h-3" />
        <span>继续生成</span>
      </button>
    </div>

    <div class="turn-body">
      <!-- taskflow：过程优先（含审批），结论在上 -->
      <template v-if="mode === 'taskflow'">
        <TurnProcess :turn="turn" />
        <div v-if="turn.answer.trim()" class="conclusion">
          <div class="conclusion-head">
            <span class="conclusion-tag">结论</span>
          </div>
          <div class="conclusion-body">
            <AnswerCard
              :turn="turn"
              :index="index"
              :is-last-turn="isLastTurn"
              :streaming="streaming"
            />
          </div>
        </div>
      </template>

      <!-- answer-first / report：答案为主体，过程折叠在下方 -->
      <template v-else>
        <AnswerCard
          :turn="turn"
          :index="index"
          :is-last-turn="isLastTurn"
          :streaming="streaming"
        />
        <TurnProcess :turn="turn" />
      </template>
    </div>
  </section>
</template>

<style scoped>
.turn {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  /* 半透明实底 + 顶部高光：在玻璃面板上保持层级又不堵死（对齐 surface-raised + highlight 配方） */
  background: linear-gradient(180deg, color-mix(in srgb, var(--color-raised) 88%, transparent), color-mix(in srgb, var(--color-base) 90%, transparent));
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.05);
  overflow: hidden;
}
.turn.is-active { border-color: color-mix(in srgb, var(--color-accent) 28%, transparent); }
.turn.is-pending { border-color: color-mix(in srgb, var(--color-warning) 36%, transparent); }
.turn.is-error { border-color: color-mix(in srgb, var(--color-danger) 32%, transparent); }

/* 用户气泡 */
.user {
  padding: 12px 14px 4px;
}
.user-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}
.user-eyebrow {
  font: 700 10px/1 var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.12em;
  color: var(--color-ink-3);
}
.user-time {
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--color-ink-3);
}
.user-bubble {
  max-width: 92%;
  margin-left: auto;
  padding: 9px 12px;
  border: 1px solid var(--color-line-hair);
  border-left: 2px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-base) 40%, transparent);
}
.user-text {
  margin: 0;
  color: var(--color-ink);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.user-imgs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.user-thumb {
  width: 72px;
  height: 48px;
  object-fit: cover;
  border: 1px solid var(--color-line);
  border-radius: 4px;
}

/* 回合头 */
.turn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  padding: 4px 14px;
  border-bottom: 1px solid var(--color-line-hair);
  color: var(--color-ink-4);
  font: 400 10px/1 var(--font-mono, ui-monospace, monospace);
}
/* 状态一律中性灰；只有进行中/待确认才用色（信息密度优先，平时不抢眼球） */
.turn-status {
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--color-ink-3);
}
.turn-status.is-active { color: var(--color-accent); }
.turn-status.is-pending { color: var(--color-warning); }
.turn-status.is-error { color: var(--color-danger); }
.turn-status.is-done { color: var(--color-ink-3); }
.turn-status.is-aborted { color: var(--color-ink-4); }
.spacer { flex: 1; }

/* 形态切换：默认隐藏，hover 回合头才浮现（避免每张卡常驻一排彩色按钮） */
.mode-switch {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.turn-head:hover .mode-switch,
.mode-switch:focus-within {
  opacity: 1;
}
.mode-btn {
  height: 18px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--color-ink-4);
  font-size: 9.5px;
  cursor: pointer;
}
.mode-btn:hover {
  color: var(--color-ink-2);
}
.mode-btn.is-active {
  border-color: var(--color-line);
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  color: var(--color-accent-strong);
}

.turn-resume {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  height: 20px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 42%, transparent);
  border-radius: 4px;
  background: transparent;
  color: var(--color-accent-strong);
  font-size: 10.5px;
  cursor: pointer;
}
.turn-resume:hover {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
}

.turn-body {
  padding: 12px 14px 14px;
}

/* 结论卡（taskflow 下）——中性内嵌，不整卡染色（状态色只做徽标，符合设计系统约定） */
.conclusion {
  border: 1px solid var(--color-line-hair);
  border-left: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-base) 50%, transparent);
  overflow: hidden;
}
.conclusion-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--color-line-hair);
}
.conclusion-tag {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 9.5px;
  font-weight: 600;
  color: var(--color-ink-3);
  letter-spacing: 0.06em;
}
.conclusion-body {
  padding: 10px 14px;
}
</style>
