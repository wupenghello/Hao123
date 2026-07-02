<script setup lang="ts">
/**
 * 首次访问引导 · 能力体检中心
 *
 * 不再只是告诉用户去配 env，而是展示 TodayOps 当前能做什么：
 * 天气 / 禅道 / LLM / 知识库 / wbscf+Git 的连接状态，以及可用能力的「试一下」入口。
 */
import { computed } from 'vue'
import { useChatStore, kbEnabled, wbscfEnabled, gitEnabled, ASSISTANT_NAME } from '@/features/chat'
import { useTaskStore, useBugStore, useZentaoSession } from '@/features/zentao'
import { useWeatherStore } from '@/features/weather'
import IconCheck from '~icons/mdi/check-circle'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconWeather from '~icons/mdi/weather-partly-cloudy'
import IconTask from '~icons/mdi/checkbox-marked-circle-outline'
import IconSpark from '~icons/mdi/star-four-points'
import IconBook from '~icons/mdi/book-open-page-variant-outline'
import IconSourceBranch from '~icons/mdi/source-branch'

const emit = defineEmits<{ done: [] }>()

const chat = useChatStore()
const session = useZentaoSession()
const weather = useWeatherStore()
const taskStore = useTaskStore()
const bugStore = useBugStore()

type CapabilityTone = 'ok' | 'warn' | 'idle'
interface Capability {
  key: string
  title: string
  status: string
  desc: string
  ready: boolean
  tone: CapabilityTone
  icon: unknown
  actionLabel: string
  actionDisabled?: boolean
  action: () => void
}

function closeAndRun(fn: () => void) {
  emit('done')
  fn()
}

function askTodayPlan() {
  closeAndRun(() => {
    chat.show()
    void chat.send('请进入接手模式，先并行查看我的禅道任务、Bug、本地待办和天气，然后告诉我今天最该先处理什么。')
  })
}

function tryKb() {
  closeAndRun(() => {
    chat.show()
    void chat.send('搜索知识库：开发环境、部署流程或常用环境地址，并告诉我你能查到什么。')
  })
}

function tryWbscfGit() {
  closeAndRun(() => {
    chat.show()
    void chat.send('帮我查看 wbscf 本地 dev 服务状态和 Git 仓库状态，只做查询，不执行写操作。')
  })
}

function refreshWeather() {
  void weather.fetchWeather()
}

function syncZentao() {
  if (taskStore.configured) taskStore.loadAssigned()
  if (bugStore.configured) bugStore.loadAssigned()
}

const capabilities = computed<Capability[]>(() => [
  {
    key: 'weather',
    title: '天气',
    status: weather.loading || weather.locating ? '同步中' : weather.now ? '已连接' : '未连接',
    desc: weather.now
      ? `${weather.cityName || '当前城市'} · ${weather.now.text} ${weather.now.temp}°C，会进入晨报和节奏建议。`
      : weather.error || '用于晨报、出行和日程节奏建议。',
    ready: !!weather.now,
    tone: weather.now ? 'ok' : weather.loading || weather.locating ? 'idle' : 'warn',
    icon: IconWeather,
    actionLabel: weather.now ? '刷新天气' : '重新连接',
    action: refreshWeather,
  },
  {
    key: 'zentao',
    title: '禅道',
    status: session.configured ? '已连接' : '未配置',
    desc: session.configured
      ? `${taskStore.assignedCount} 个任务 · ${bugStore.assignedCount} 个 Bug，可进入统一收件箱和风险判断。`
      : '配置后会拉取指派给我的任务和 Bug。',
    ready: session.configured,
    tone: session.configured ? 'ok' : 'warn',
    icon: IconTask,
    actionLabel: session.configured ? '同步工作项' : '等待配置',
    actionDisabled: !session.configured,
    action: syncZentao,
  },
  {
    key: 'llm',
    title: 'AI 助手',
    status: chat.configured ? '已连接' : '未连接',
    desc: chat.configured
      ? `${ASSISTANT_NAME} 可以接手今日安排、解释风险、调用工具。`
      : '配置 LLM 后，首页洞察、晨报和命令面板会真正可用。',
    ready: chat.configured,
    tone: chat.configured ? 'ok' : 'warn',
    icon: IconSpark,
    actionLabel: '让小吴安排今天',
    actionDisabled: !chat.configured,
    action: askTodayPlan,
  },
  {
    key: 'kb',
    title: '知识库',
    status: kbEnabled ? '已配置' : '未配置',
    desc: kbEnabled
      ? `${ASSISTANT_NAME} 可以检索项目文档、环境地址、流程和个人笔记。`
      : '配置 VITE_KB_SOURCE 后，小吴可检索内部文档。',
    ready: kbEnabled,
    tone: kbEnabled ? 'ok' : 'warn',
    icon: IconBook,
    actionLabel: '试搜知识库',
    actionDisabled: !chat.configured || !kbEnabled,
    action: tryKb,
  },
  {
    key: 'wbscf-git',
    title: 'wbscf / Git',
    status: wbscfEnabled && gitEnabled ? 'dev 可用' : '仅 dev 可用',
    desc: wbscfEnabled && gitEnabled
      ? '可查询本地服务、启动子应用、查看 Git 仓库状态；写操作会要求确认。'
      : '需要 dev 环境并配置 VITE_WBSCF_WEB_ROOT。',
    ready: wbscfEnabled && gitEnabled,
    tone: wbscfEnabled && gitEnabled ? 'ok' : 'warn',
    icon: IconSourceBranch,
    actionLabel: '查看服务和仓库',
    actionDisabled: !chat.configured || !wbscfEnabled || !gitEnabled,
    action: tryWbscfGit,
  },
])

const readyCount = computed(() => capabilities.value.filter((c) => c.ready).length)
</script>

<template>
  <div class="onboard-overlay" @click.self="emit('done')">
    <div class="onboard-card">
      <header class="onboard-header">
        <p class="onboard-kicker">capability check</p>
        <h2 class="onboard-title">能力体检中心</h2>
        <p class="onboard-sub">
          已启用 {{ readyCount }}/{{ capabilities.length }} 项能力。先试一个能跑通的入口，比读配置说明更快。
        </p>
      </header>

      <div class="onboard-list">
        <article
          v-for="cap in capabilities"
          :key="cap.key"
          class="onboard-cap"
          :class="[`is-${cap.tone}`, { 'is-ready': cap.ready }]"
        >
          <div class="onboard-cap-icon">
            <component :is="cap.icon" class="w-4 h-4" />
          </div>
          <div class="onboard-cap-main">
            <div class="onboard-cap-line">
              <h3>{{ cap.title }}</h3>
              <span class="onboard-status" :class="`is-${cap.tone}`">
                <IconCheck v-if="cap.ready" class="w-3 h-3" />
                <IconAlert v-else class="w-3 h-3" />
                {{ cap.status }}
              </span>
            </div>
            <p>{{ cap.desc }}</p>
          </div>
          <button
            class="onboard-try"
            :disabled="cap.actionDisabled"
            @click="cap.action"
          >
            {{ cap.actionLabel }}
          </button>
        </article>
      </div>

      <footer class="onboard-footer">
        <button class="onboard-btn" @click="emit('done')">进入工作台</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.onboard-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
}

.onboard-card {
  width: min(760px, 100%);
  max-height: min(760px, 92vh);
  display: flex;
  flex-direction: column;
  border-radius: 18px;
  background:
    linear-gradient(160deg, rgba(30, 58, 95, 0.96), rgba(15, 23, 42, 0.98) 58%, rgba(13, 64, 64, 0.96)),
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.02) 0 1px, transparent 1px 28px);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 24px 60px -12px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(45, 212, 191, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.onboard-header {
  padding: 22px 24px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.onboard-kicker {
  margin: 0 0 7px;
  font-family: var(--hud-font-data);
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(94, 234, 212, 0.72);
}
.onboard-title {
  margin: 0;
  font-size: 20px;
  font-weight: 680;
  color: rgba(255, 255, 255, 0.96);
}
.onboard-sub {
  margin: 7px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.52);
}

.onboard-list {
  padding: 14px 16px;
  overflow-y: auto;
}
.onboard-cap {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.onboard-cap + .onboard-cap {
  margin-top: 9px;
}
.onboard-cap.is-ready {
  background: rgba(45, 212, 191, 0.045);
  border-color: rgba(45, 212, 191, 0.14);
}
.onboard-cap-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: rgba(226, 232, 240, 0.76);
  background: rgba(255, 255, 255, 0.075);
}
.onboard-cap.is-ok .onboard-cap-icon {
  color: #5eead4;
  background: rgba(45, 212, 191, 0.14);
}
.onboard-cap-main {
  min-width: 0;
}
.onboard-cap-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.onboard-cap-line h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
  color: rgba(255, 255, 255, 0.9);
}
.onboard-cap-main p {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.52);
}
.onboard-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.onboard-status.is-ok {
  color: #86efac;
  background: rgba(34, 197, 94, 0.12);
}
.onboard-status.is-warn {
  color: #fde68a;
  background: rgba(251, 191, 36, 0.12);
}
.onboard-status.is-idle {
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.12);
}
.onboard-try {
  height: 30px;
  padding: 0 12px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(236, 254, 255, 0.9);
  background: rgba(45, 212, 191, 0.12);
  border: 1px solid rgba(94, 234, 212, 0.24);
  transition: background 0.15s, color 0.15s, opacity 0.15s;
}
.onboard-try:hover:not(:disabled) {
  background: rgba(45, 212, 191, 0.2);
  color: #fff;
}
.onboard-try:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}

.onboard-footer {
  padding: 14px 24px 20px;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.onboard-btn {
  height: 36px;
  padding: 0 22px;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(150deg, rgba(56, 189, 248, 0.85), rgba(20, 184, 166, 0.85));
  border: 1px solid rgba(94, 234, 212, 0.4);
  box-shadow: 0 4px 16px -4px rgba(20, 184, 166, 0.5);
  transition: transform 0.15s, box-shadow 0.15s;
}
.onboard-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px -4px rgba(20, 184, 166, 0.6);
}

@media (max-width: 640px) {
  .onboard-cap {
    grid-template-columns: 34px minmax(0, 1fr);
  }
  .onboard-try {
    grid-column: 2;
    width: fit-content;
  }
  .onboard-cap-line {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .onboard-try,
  .onboard-btn {
    transition: none;
  }
}
</style>
