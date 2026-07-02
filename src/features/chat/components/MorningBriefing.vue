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
import { useChatStore } from '../store'
import IconSpark from '~icons/mdi/star-four-points'
import IconRefresh from '~icons/mdi/refresh'
import IconAlert from '~icons/mdi/alert-circle-outline'

const { briefing, generating, error, refresh } = useBriefing()
const chat = useChatStore()
/** 看完简报后进入行动流，而不是只打开空聊天 */
function startActionFlow() {
  if (!briefing.value?.content) return
  chat.show()
  void chat.send(buildBriefingActionFlowPrompt(briefing.value.content))
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

      <!-- 简报正文（refresh 时保留旧内容，按钮转圈，生成完替换） -->
      <div v-else-if="html" class="mb-body" v-html="html" />

      <!-- 行动流入口：看完简报后让小吴直接接手今天的处理顺序 -->
      <footer v-if="html" class="mb-foot">
        <button class="mb-ask" :title="`让${ASSISTANT_NAME}接手今日安排`" @click="startActionFlow">
          <IconSpark class="w-3 h-3" />
          <span>让 {{ ASSISTANT_NAME }} 接手安排 →</span>
        </button>
      </footer>
    </section>
  </Transition>
</template>

<style scoped>
.mb-card {
  border-radius: 0 18px 18px 0;
  background:
    linear-gradient(180deg, rgba(2, 6, 23, 0.7), rgba(15, 23, 42, 0.38)),
    radial-gradient(circle at 0 0, rgba(165, 180, 252, 0.18), transparent 42%),
    repeating-linear-gradient(0deg, rgba(125, 211, 252, 0.03) 0 1px, transparent 1px 32px);
  border: 1px solid var(--hud-line);
  border-left: 2px solid rgba(165, 180, 252, 0.68);
  backdrop-filter: blur(18px) saturate(130%);
  box-shadow: var(--hud-glow), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.mb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(129, 140, 248, 0.14);
}
.mb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: #a5b4fc;
  background: rgba(129, 140, 248, 0.16);
  flex-shrink: 0;
}
.mb-title {
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.02em;
}
.mb-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}
.mb-refresh {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.4);
  transition: color 0.15s, background 0.15s;
  cursor: pointer;
}
.mb-refresh:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.08);
}
.mb-refresh:disabled {
  cursor: default;
}
.mb-refresh.is-spinning svg {
  animation: mb-spin 0.9s linear infinite;
}
@keyframes mb-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 正文（v-html 渲染的 markdown，用 :deep 穿透 scoped 边界） */
.mb-body {
  padding: 12px 14px 14px;
  font-size: 13.5px;
  line-height: 1.75;
  color: rgba(255, 255, 255, 0.82);
}
.mb-body :deep(p) {
  margin: 0 0 7px;
}
.mb-body :deep(p:last-child) {
  margin-bottom: 0;
}
.mb-body :deep(strong) {
  color: #fff;
  font-weight: 600;
}
.mb-body :deep(ul) {
  margin: 4px 0 2px;
  padding: 0;
  list-style: none;
}
.mb-body :deep(li) {
  position: relative;
  padding-left: 14px;
  margin: 3px 0;
}
.mb-body :deep(li)::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 9px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(165, 180, 252, 0.7);
}
.mb-body :deep(a) {
  color: #a5b4fc;
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* 深聊入口（卡片底部，承接原首页「下一步建议」条的深聊语义） */
.mb-foot {
  padding: 4px 14px 12px;
}
.mb-ask {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: rgba(199, 210, 254, 0.85);
  background: rgba(129, 140, 248, 0.1);
  transition: background 0.15s, color 0.15s;
  cursor: pointer;
}
.mb-ask:hover {
  background: rgba(129, 140, 248, 0.2);
  color: #e0e7ff;
}

/* 首次生成骨架 */
.mb-loading {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 18px 14px;
}
.mb-loading-text {
  margin-left: 6px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}
.mb-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(165, 180, 252, 0.7);
  animation: mb-bounce 1.2s ease-in-out infinite;
}
.mb-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.mb-dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes mb-bounce {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

/* 错误态 */
.mb-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  font-size: 12.5px;
  color: rgba(252, 165, 165, 0.85);
}
.mb-retry {
  flex-shrink: 0;
  padding: 3px 10px;
  height: 24px;
  border-radius: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.08);
  transition: background 0.15s;
}
.mb-retry:hover {
  background: rgba(255, 255, 255, 0.15);
}

/* 进出过渡（与首页 guide-fade 同款节奏） */
.mb-fade-enter-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.mb-fade-leave-active {
  transition: opacity 0.25s ease;
}
.mb-fade-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.mb-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .mb-refresh.is-spinning svg {
    animation: none;
  }
  .mb-dot {
    animation: none;
  }
}
</style>
