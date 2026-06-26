<script setup lang="ts">
/**
 * 助手入口（固定在视口左下角的小药丸）
 *
 * AI 是底层「操作系统」而非一个被打开的窗口——所以入口常驻但不抢戏：
 * 一个低视觉权重的小药丸 + ⌘K 提示，点击召唤命令面板。
 * 未读回复时右上角亮红点。Alt+K / Cmd+K 热键不变（见 useChatHotkeys）。
 *
 * 视觉对齐项目玻璃面板语言（bg-white/[0.06] + ring-white/10 + backdrop-blur），
 * 与 ZentaoInbox 面板、welcome-chip 同族；由 Layout 挂在根节点（position:fixed 视口定位）。
 * 名称取自公共配置（env 可改）。
 */
import { computed } from 'vue'
import { useChatStore } from '../store'
import { ASSISTANT_NAME } from '../config'
import IconRobot from '~icons/mdi/robot-happy-outline'

const store = useChatStore()

const isMac = computed(() =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent),
)
const keyHint = computed(() => (isMac.value ? '⌘K' : 'Alt+K'))
</script>

<template>
  <button
    class="group fixed left-4 bottom-4 z-40 inline-flex items-center gap-[7px] py-[7px] pl-2.5 pr-3 rounded-full bg-white/[0.06] backdrop-blur-md ring-1 ring-white/10 shadow-lg transition-colors hover:bg-white/[0.1] hover:ring-teal-300/40"
    :title="`${ASSISTANT_NAME} · AI 助手（${keyHint}）`"
    @click="store.show()"
  >
    <IconRobot class="w-[15px] h-[15px] text-teal-300/90 shrink-0" />
    <span class="text-[12.5px] font-medium text-white/80 group-hover:text-white transition-colors">问{{ ASSISTANT_NAME }}</span>
    <kbd class="font-mono text-[10px] px-1.5 py-0.5 rounded-[5px] text-white/55 bg-white/[0.08] ring-1 ring-white/10">{{ keyHint }}</kbd>
    <span v-if="store.unread" class="launcher-dot absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-400 ring-2 ring-slate-900" />
  </button>
</template>

<style scoped>
.launcher-dot {
  animation: launcher-pulse 1.5s ease-in-out infinite;
}
@keyframes launcher-pulse {
  50% { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .launcher-dot { animation: none; }
}
</style>
