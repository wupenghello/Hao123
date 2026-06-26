<script setup lang="ts">
/**
 * 小吴 · 命令面板（Spotlight / Cmd+K 式中央对话）
 *
 * 全局快捷键 Alt+K（Mac ⌘K）召唤，从屏幕中央偏上缩放入场。LLM 是本应用的主功能，
 * 故采用「随叫随到、占据中央」的命令面板形态，而非角落挂件。
 *
 * 形态：半透明遮罩 + 居中卡片，顶部为大输入框（Spotlight 标志性），下方为对话流。
 * 能力：流式 Markdown 回复、工具调用过程可视、空态推荐、复制、重新生成、停止、清空。
 * 视觉语言对齐 DetailModal（navy→teal 玻璃、四角科技边框、流光顶条）。
 */
import { ref, nextTick, watch, computed } from 'vue'
import { useChatStore } from '../store'
import { useWelcomeGuide } from '../welcome-guide'
import { ASSISTANT_NAME } from '../config'
import { renderMarkdown } from '../markdown'
import type { ChatMessage, ToolActivity } from '../types'
import IconRobot from '~icons/mdi/robot-happy-outline'
import IconClose from '~icons/mdi/close'
import IconSend from '~icons/mdi/arrow-up'
import IconStop from '~icons/mdi/stop'
import IconBroom from '~icons/mdi/broom'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCheck from '~icons/mdi/check-circle'
import IconLoading from '~icons/mdi/loading'
import IconCopy from '~icons/mdi/content-copy'
import IconRefresh from '~icons/mdi/refresh'
import IconWeather from '~icons/mdi/weather-partly-cloudy'
import IconTask from '~icons/mdi/checkbox-marked-circle-outline'
import IconBug from '~icons/mdi/bug-outline'
import IconSpark from '~icons/mdi/star-four-points'
import IconThumbUp from '~icons/mdi/thumb-up-outline'
import IconThumbDown from '~icons/mdi/thumb-down-outline'
import IconThumbUpFill from '~icons/mdi/thumb-up'
import IconThumbDownFill from '~icons/mdi/thumb-down'

const store = useChatStore()
const { suggestions } = useWelcomeGuide()

const input = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const copiedIdx = ref(-1)

/**
 * Markdown 渲染缓存：按消息对象 + content 记忆渲染结果。
 * 流式时组件每个 token 都会重渲染，若直接在模板里 v-html="renderMarkdown(m.content)"，
 * 会让**所有历史消息**每个 token 都重新解析一次（O(n²)）。这里命中缓存即 O(1) 返回，
 * 仅在 content 真正变化时（正在流式的那条）才重新解析。
 */
const mdCache = new WeakMap<ChatMessage, { content: string; html: string }>()
function renderMd(m: ChatMessage): string {
  const cached = mdCache.get(m)
  if (cached && cached.content === m.content) return cached.html
  const html = renderMarkdown(m.content)
  mdCache.set(m, { content: m.content, html })
  return html
}
/** 当前是否正在流式生成第 i 条消息（该条 content 仍在增长，用纯文本渲染避免每 token 重解析） */
function isStreamingAt(i: number): boolean {
  return !!store.streaming && i === store.messages.length - 1
}

const awaitingFirstToken = computed(() => {
  if (!store.streaming) return false
  const last = store.messages[store.messages.length - 1]
  return last?.role === 'assistant' && !last.content && !last.activities?.length
})

const suggestionIcon = (kind: string) =>
  kind === 'weather' ? IconWeather : kind === 'task' ? IconTask : IconBug

function scrollToBottom(smooth = false) {
  nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  })
}

// 内容变化时滚到底。用「最后一条消息内容长度 + 活动状态 + 消息总数」作廉价信号，
// 避免每来一个 token 就把所有消息内容拼成大字符串（流式时 O(n²)）。
watch(
  () => {
    const last = store.messages[store.messages.length - 1]
    return (
      store.messages.length +
      '|' +
      (last ? last.content.length : 0) +
      '|' +
      (last?.activities?.map((a) => a.status).join('') ?? '')
    )
  },
  () => scrollToBottom(),
)

// 打开时聚焦输入框并滚到底
watch(
  () => store.open,
  (v) => {
    if (v) {
      scrollToBottom()
      nextTick(() => inputEl.value?.focus())
    }
  },
)

function autoGrow() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}

function onSend() {
  const text = input.value
  if (!text.trim() || store.streaming) return
  input.value = ''
  nextTick(autoGrow)
  store.send(text)
}

function ask(text: string) {
  if (store.streaming) return
  store.send(text)
}

function onEnter(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    onSend()
  }
}

async function copy(text: string, idx: number) {
  try {
    await navigator.clipboard.writeText(text)
    copiedIdx.value = idx
    setTimeout(() => {
      if (copiedIdx.value === idx) copiedIdx.value = -1
    }, 1600)
  } catch {
    /* 忽略剪贴板失败 */
  }
}

function isLastAssistant(idx: number): boolean {
  for (let i = store.messages.length - 1; i >= 0; i--) {
    const m = store.messages[i]
    if (m.role === 'assistant') return i === idx
    if (m.role === 'user') return false
  }
  return false
}

const activityIcon = (s: ToolActivity['status']) =>
  s === 'running' ? IconLoading : s === 'error' ? IconAlert : IconCheck
</script>

<template>
  <Teleport to="body">
    <Transition name="cmd-fade">
      <div
        v-if="store.open"
        class="fixed inset-0 z-[60] flex justify-center px-4 pt-[8vh] pb-[6vh]"
      >
        <!-- 遮罩 -->
        <div class="absolute inset-0 bg-slate-950/55 backdrop-blur-[3px]" @click="store.close()" />

        <!-- 命令面板卡片 -->
        <Transition name="cmd-pop" appear>
          <section
            v-if="store.open"
            class="cmd-card relative z-10 w-full max-w-[680px] max-h-full flex flex-col overflow-hidden"
            @click.stop
          >
            <div class="cmd-corners" aria-hidden="true" />
            <div class="cmd-accent" />

            <!-- 顶部输入栏（Spotlight 标志性大输入框）-->
            <div class="relative z-10 flex items-center gap-3 px-4 py-3.5 border-b border-white/10 shrink-0">
              <div class="cmd-avatar shrink-0">
                <IconRobot class="w-5 h-5" />
              </div>
              <textarea
                ref="inputEl"
                v-model="input"
                rows="1"
                :disabled="!store.configured"
                :placeholder="`问${ASSISTANT_NAME}任何事，或输入指令…`"
                class="flex-1 min-w-0 resize-none bg-transparent text-[15px] text-white/95 placeholder:text-white/35 outline-none leading-6 py-0.5 max-h-[160px] cmd-scroll"
                @keydown="onEnter"
                @input="autoGrow"
              />
              <button
                v-if="store.streaming"
                class="cmd-send is-stop"
                title="停止生成"
                @click="store.stop()"
              >
                <IconStop class="w-4 h-4" />
              </button>
              <button
                v-else
                class="cmd-send"
                :disabled="!input.trim() || !store.configured"
                title="发送（Enter）"
                @click="onSend"
              >
                <IconSend class="w-4 h-4" />
              </button>
              <button class="cmd-iconbtn shrink-0" title="关闭（Esc）" @click="store.close()">
                <IconClose class="w-4 h-4" />
              </button>
            </div>

            <!-- 对话流 / 空态（仅在有内容或加载时展开，保持 Spotlight 的轻盈感） -->
            <div
              v-if="store.hasMessages || store.error || !store.configured"
              ref="scrollEl"
              class="relative z-10 flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 cmd-scroll"
            >
              <!-- 未配置 -->
              <div v-if="!store.configured" class="flex flex-col items-center gap-2 py-10 text-center text-white/55">
                <IconAlert class="w-8 h-8 text-amber-300/70" />
                <p class="text-sm text-white/75">尚未接入 LLM</p>
                <p class="text-xs text-white/40 max-w-[18rem]">在项目 .env 中配置 VITE_DEEPSEEK_API_KEY 并重启开发服务后即可对话</p>
              </div>

              <!-- 消息列表 -->
              <template v-for="(m, i) in store.messages" :key="i">
                <!-- 用户 -->
                <div v-if="m.role === 'user'" class="flex justify-end">
                  <div class="cmd-bubble-user max-w-[80%]">{{ m.content }}</div>
                </div>

                <!-- 助手 -->
                <div v-else-if="m.role === 'assistant' && (m.content || m.activities?.length)" class="flex gap-2.5">
                  <div class="cmd-avatar-sm shrink-0 mt-0.5">
                    <IconRobot class="w-4 h-4" />
                  </div>
                  <div class="flex-1 min-w-0 space-y-2">
                    <!-- 工具活动卡 -->
                    <div v-if="m.activities?.length" class="space-y-1.5">
                      <div
                        v-for="(a, ai) in m.activities"
                        :key="ai"
                        class="cmd-activity"
                        :class="{ 'is-error': a.status === 'error' }"
                      >
                        <component
                          :is="activityIcon(a.status)"
                          class="w-3.5 h-3.5 shrink-0"
                          :class="{
                            'animate-spin text-teal-300/80': a.status === 'running',
                            'text-emerald-300/80': a.status === 'done',
                            'text-rose-300/80': a.status === 'error',
                          }"
                        />
                        <span class="text-white/70">{{ a.label }}</span>
                        <span v-if="a.detail" class="text-white/35 truncate">· {{ a.detail }}</span>
                        <span class="ml-auto text-[10px] text-white/30 shrink-0">
                          {{ a.status === 'running' ? '查询中' : a.status === 'error' ? '失败' : '完成' }}
                        </span>
                      </div>
                    </div>

                    <!-- 正文：流式中的那条用纯文本（避免每 token 重解析 markdown）；其余用记忆化渲染 -->
                    <div v-if="m.content" class="cmd-bubble-ai cmd-md group">
                      <span v-if="isStreamingAt(i)" class="cmd-md-raw">{{ m.content }}</span>
                      <span v-else v-html="renderMd(m)" />
                      <span v-if="isStreamingAt(i)" class="cmd-caret" />
                      <div
                        v-if="!isStreamingAt(i)"
                        class="cmd-actions"
                      >
                        <button class="cmd-action" :title="copiedIdx === i ? '已复制' : '复制'" @click="copy(m.content, i)">
                          <IconCheck v-if="copiedIdx === i" class="w-3.5 h-3.5 text-emerald-300/80" />
                          <IconCopy v-else class="w-3.5 h-3.5" />
                        </button>
                        <button
                          v-if="isLastAssistant(i) && !store.streaming"
                          class="cmd-action"
                          title="重新生成"
                          @click="store.regenerate()"
                        >
                          <IconRefresh class="w-3.5 h-3.5" />
                        </button>
                        <button
                          class="cmd-action"
                          :title="m.feedback === 'up' ? '已赞' : '有用'"
                          @click="store.rate(i, 'up')"
                        >
                          <IconThumbUpFill v-if="m.feedback === 'up'" class="w-3.5 h-3.5 text-emerald-300/80" />
                          <IconThumbUp v-else class="w-3.5 h-3.5" />
                        </button>
                        <button
                          class="cmd-action"
                          :title="m.feedback === 'down' ? '已踩' : '没用'"
                          @click="store.rate(i, 'down')"
                        >
                          <IconThumbDownFill v-if="m.feedback === 'down'" class="w-3.5 h-3.5 text-rose-300/80" />
                          <IconThumbDown v-else class="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <!-- 等待首个 token -->
              <div v-if="awaitingFirstToken" class="flex gap-2.5">
                <div class="cmd-avatar-sm shrink-0 mt-0.5">
                  <IconRobot class="w-4 h-4" />
                </div>
                <div class="cmd-bubble-ai inline-flex items-center gap-1 py-3">
                  <span class="cmd-dot" style="animation-delay: 0ms" />
                  <span class="cmd-dot" style="animation-delay: 160ms" />
                  <span class="cmd-dot" style="animation-delay: 320ms" />
                </div>
              </div>

              <!-- 错误条 -->
              <div v-if="store.error" class="flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-400/10 ring-1 ring-rose-300/25 text-xs text-rose-100/90">
                <IconAlert class="w-4 h-4 shrink-0 mt-px text-rose-300/80" />
                <div class="flex-1 break-words">
                  <p>{{ store.error }}</p>
                  <button class="mt-1 text-rose-200/80 hover:text-rose-100 underline underline-offset-2" @click="store.regenerate()">
                    重试
                  </button>
                </div>
              </div>
            </div>

            <!-- 空态：推荐问题（无对话时，紧贴输入框下方，保持轻盈） -->
            <div v-else-if="store.configured" class="relative z-10 px-3 pb-3 pt-2.5">
              <p class="px-1 pb-1.5 text-[11px] text-white/35">试试这些 ——</p>
              <div class="grid gap-1.5">
                <button
                  v-for="s in suggestions"
                  :key="s.text"
                  class="cmd-suggestion group"
                  @click="ask(s.text)"
                >
                  <component :is="suggestionIcon(s.icon)" class="w-4 h-4 text-sky-300/70 shrink-0 group-hover:text-sky-200" />
                  <span class="flex-1 text-left">{{ s.text }}</span>
                  <IconSend class="w-3.5 h-3.5 text-white/20 group-hover:text-white/50 -rotate-90" />
                </button>
              </div>
            </div>

            <!-- 底部状态条 -->
            <div class="relative z-10 flex items-center gap-3 px-4 h-9 border-t border-white/8 shrink-0 text-[11px] text-white/30">
              <div class="flex items-center gap-1">
                <IconSpark class="w-3 h-3 text-teal-300/60" />
                <span>{{ ASSISTANT_NAME }} · 天气 / 禅道</span>
              </div>
              <span v-if="store.feedbackStats.up + store.feedbackStats.down > 0" class="flex items-center gap-1.5 text-white/25">
                <span class="flex items-center gap-0.5">
                  <IconThumbUpFill class="w-2.5 h-2.5 text-emerald-400/50" />{{ store.feedbackStats.up }}
                </span>
                <span class="flex items-center gap-0.5">
                  <IconThumbDownFill class="w-2.5 h-2.5 text-rose-400/50" />{{ store.feedbackStats.down }}
                </span>
              </span>
              <span class="ml-auto flex items-center gap-2.5">
                <span><kbd class="cmd-kbd">Enter</kbd> 发送</span>
                <span><kbd class="cmd-kbd">Esc</kbd> 关闭</span>
                <button
                  v-if="store.hasMessages"
                  class="flex items-center gap-1 hover:text-white/70 transition-colors"
                  :disabled="store.streaming"
                  @click="store.clear()"
                >
                  <IconBroom class="w-3 h-3" />清空
                </button>
              </span>
            </div>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ============ HUD 玻璃卡（呼应 DetailModal）============ */
.cmd-card {
  border-radius: 18px;
  background:
    linear-gradient(160deg, rgba(30, 58, 95, 0.95) 0%, rgba(15, 23, 42, 0.97) 55%, rgba(13, 64, 64, 0.95) 100%),
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.022) 0 1px, transparent 1px 28px),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.022) 0 1px, transparent 1px 28px);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.13);
  box-shadow:
    0 32px 80px -16px rgba(0, 0, 0, 0.7),
    0 0 0 1px rgba(45, 212, 191, 0.16),
    0 0 40px -6px rgba(45, 212, 191, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.cmd-corners {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  border-radius: 18px;
  overflow: hidden;
}
.cmd-corners::before,
.cmd-corners::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border-color: rgba(94, 234, 212, 0.5);
  border-style: solid;
  filter: drop-shadow(0 0 4px rgba(94, 234, 212, 0.45));
}
.cmd-corners::before {
  top: 8px;
  left: 8px;
  border-width: 2px 0 0 2px;
  border-top-left-radius: 6px;
}
.cmd-corners::after {
  bottom: 8px;
  right: 8px;
  border-width: 0 2px 2px 0;
  border-bottom-right-radius: 6px;
}

.cmd-accent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 6;
  background: linear-gradient(90deg, #38bdf8, #2dd4bf, #38bdf8);
  background-size: 200% 100%;
  box-shadow: 0 0 12px rgba(45, 212, 191, 0.5);
  animation: cmd-accent-flow 3.5s linear infinite;
}
@keyframes cmd-accent-flow {
  from { background-position: 0% 0; }
  to { background-position: 200% 0; }
}

/* ============ 头像 ============ */
.cmd-avatar,
.cmd-avatar-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(150deg, rgba(56, 189, 248, 0.88), rgba(20, 184, 166, 0.88));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 2px 8px -2px rgba(20, 184, 166, 0.5);
}
.cmd-avatar {
  width: 36px;
  height: 36px;
  border-radius: 11px;
}
.cmd-avatar-sm {
  width: 30px;
  height: 30px;
  border-radius: 9px;
}

/* ============ 按钮 ============ */
.cmd-iconbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: rgba(255, 255, 255, 0.5);
  transition: background 0.15s, color 0.15s;
}
.cmd-iconbtn:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.1);
}
.cmd-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  color: #fff;
  flex-shrink: 0;
  background: linear-gradient(150deg, #38bdf8, #2dd4bf);
  box-shadow: 0 2px 10px -2px rgba(20, 184, 166, 0.5);
  transition: opacity 0.15s, transform 0.12s;
}
.cmd-send:hover:not(:disabled) {
  transform: scale(1.06);
}
.cmd-send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: none;
}
.cmd-send.is-stop {
  background: linear-gradient(150deg, rgba(244, 63, 94, 0.85), rgba(225, 29, 72, 0.85));
  box-shadow: 0 2px 10px -2px rgba(244, 63, 94, 0.5);
}

/* ============ 气泡 ============ */
.cmd-bubble-user {
  padding: 9px 13px;
  border-radius: 14px 14px 4px 14px;
  font-size: 14px;
  line-height: 1.55;
  color: #fff;
  white-space: pre-wrap;
  word-break: break-word;
  background: linear-gradient(150deg, rgba(56, 189, 248, 0.32), rgba(20, 184, 166, 0.28));
  border: 1px solid rgba(125, 211, 252, 0.25);
  box-shadow: 0 2px 10px -3px rgba(20, 184, 166, 0.4);
}
.cmd-bubble-ai {
  position: relative;
  padding: 10px 14px;
  border-radius: 4px 14px 14px 14px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.1);
  word-break: break-word;
}

.cmd-caret {
  display: inline-block;
  width: 6px;
  height: 15px;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: rgba(94, 234, 212, 0.9);
  border-radius: 1px;
  animation: cmd-blink 1s steps(2, start) infinite;
}
@keyframes cmd-blink {
  50% { opacity: 0; }
}

.cmd-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(94, 234, 212, 0.75);
  animation: cmd-bounce 1.2s infinite ease-in-out;
}
@keyframes cmd-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* ============ 工具活动卡 ============ */
.cmd-activity {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 12px;
  background: rgba(45, 212, 191, 0.06);
  border: 1px solid rgba(45, 212, 191, 0.18);
}
.cmd-activity.is-error {
  background: rgba(244, 63, 94, 0.07);
  border-color: rgba(244, 63, 94, 0.2);
}

/* ============ 消息操作 ============ */
.cmd-actions {
  display: flex;
  gap: 2px;
  margin-top: 7px;
  opacity: 0;
  transition: opacity 0.15s;
}
.cmd-bubble-ai:hover .cmd-actions {
  opacity: 1;
}
.cmd-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.4);
  transition: background 0.15s, color 0.15s;
}
.cmd-action:hover {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.1);
}

/* ============ 推荐问题 ============ */
.cmd-suggestion {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 11px;
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: all 0.16s;
}
.cmd-suggestion:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(94, 234, 212, 0.35);
}

/* ============ 键帽 ============ */
.cmd-kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* 滚动条 */
.cmd-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
.cmd-scroll::-webkit-scrollbar {
  width: 6px;
}
.cmd-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

/* ============ 进出场动画 ============ */
.cmd-fade-enter-active,
.cmd-fade-leave-active {
  transition: opacity 0.2s ease;
}
.cmd-fade-enter-from,
.cmd-fade-leave-to {
  opacity: 0;
}
.cmd-pop-enter-active {
  transition: opacity 0.24s ease, transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.cmd-pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.cmd-pop-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.96);
}
.cmd-pop-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .cmd-accent,
  .cmd-dot,
  .cmd-caret,
  .cmd-fade-enter-active,
  .cmd-fade-leave-active,
  .cmd-pop-enter-active,
  .cmd-pop-leave-active { animation: none; transition: none; }
}

/* ===== Markdown 正文样式（v-html 注入，需 :deep 命中）===== */
.cmd-md { line-height: 1.65; }
/* 流式中的纯文本渲染（未走 markdown 解析，保留换行与空白） */
.cmd-md-raw { white-space: pre-wrap; word-break: break-word; }
.cmd-md :deep(> span > :first-child) { margin-top: 0; }
.cmd-md :deep(> span > :last-child) { margin-bottom: 0; }
.cmd-md :deep(p) { margin: 0.45em 0; }
.cmd-md :deep(h1),
.cmd-md :deep(h2),
.cmd-md :deep(h3),
.cmd-md :deep(h4) { margin: 0.7em 0 0.35em; font-weight: 600; line-height: 1.3; color: rgba(255,255,255,0.96); }
.cmd-md :deep(h1) { font-size: 1.18em; }
.cmd-md :deep(h2) { font-size: 1.1em; }
.cmd-md :deep(h3) { font-size: 1.04em; }
.cmd-md :deep(ul),
.cmd-md :deep(ol) { margin: 0.45em 0; padding-left: 1.4em; }
.cmd-md :deep(ul) { list-style: disc; }
.cmd-md :deep(ol) { list-style: decimal; }
.cmd-md :deep(li) { margin: 0.24em 0; }
.cmd-md :deep(li::marker) { color: rgba(94, 234, 212, 0.7); }
.cmd-md :deep(a) { color: rgb(125 211 252); text-decoration: underline; text-underline-offset: 2px; }
.cmd-md :deep(strong) { font-weight: 600; color: rgba(255, 255, 255, 0.98); }
.cmd-md :deep(em) { font-style: italic; }
.cmd-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.86em; padding: 0.1em 0.36em; border-radius: 4px;
  background: rgba(255, 255, 255, 0.09); color: rgb(94 234 212);
}
.cmd-md :deep(pre) {
  margin: 0.55em 0; padding: 0.7em 0.9em; border-radius: 9px;
  background: rgba(0, 0, 0, 0.4); overflow-x: auto;
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.cmd-md :deep(pre code) { display: block; padding: 0; background: transparent; color: rgba(255, 255, 255, 0.86); white-space: pre; }
.cmd-md :deep(blockquote) {
  margin: 0.55em 0; padding: 0.2em 0.9em;
  border-left: 3px solid rgba(94, 234, 212, 0.45); color: rgba(255, 255, 255, 0.72);
}
.cmd-md :deep(hr) { margin: 0.75em 0; border: none; border-top: 1px solid rgba(255, 255, 255, 0.12); }
.cmd-md :deep(table) { margin: 0.55em 0; border-collapse: collapse; font-size: 0.92em; width: 100%; }
.cmd-md :deep(th),
.cmd-md :deep(td) { border: 1px solid rgba(255, 255, 255, 0.14); padding: 0.34em 0.6em; text-align: left; }
.cmd-md :deep(th) { background: rgba(94, 234, 212, 0.1); font-weight: 600; }
</style>
