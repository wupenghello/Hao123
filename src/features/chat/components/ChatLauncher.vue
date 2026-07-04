<script setup lang="ts">
/**
 * 助手入口（固定在视口左下角的小药丸）
 *
 * AI 是底层「操作系统」而非一个被打开的窗口——所以入口常驻但不抢戏：
 * 一个低视觉权重的小药丸 + ⌘K 提示，点击召唤命令面板。
 * 未读回复时右上角亮红点。Alt+K / Cmd+K 热键不变（见 useChatHotkeys）。
 *
 * 连通性色点：药丸左下角一个小圆点反映 LLM 当前是否可达——
 *  - 绿色（healthy）：正常
 *  - 琥珀脉冲（unreachable）：连不上，正在自动重试（hover tooltip 看原因）
 *  - 不显示（未配置 / 未触达过错误）：保持低视觉权重
 *
 * 视觉对齐项目玻璃面板语言（bg-white/[0.06] + ring-white/10 + backdrop-blur），
 * 与 ZentaoInbox 面板、welcome-chip 同族；由 Layout 挂在根节点（position:fixed 视口定位）。
 * 名称取自公共配置（env 可改）。
 */
import { computed } from 'vue'
import { useChatStore } from '../store'
import { useConnectivity } from '../connectivity'
import { ASSISTANT_NAME } from '../config'
import IconRobot from '~icons/mdi/robot-happy-outline'

const store = useChatStore()
const { status: connectivityStatus, message: connectivityMsg } = useConnectivity()

const isMac = computed(() =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent),
)
const keyHint = computed(() => (isMac.value ? '⌘K' : 'Alt+K'))

const dotState = computed(() => {
  if (!store.configured) return 'none'
  return connectivityStatus.value === 'unreachable' ? 'down' : 'ok'
})
const dotTitle = computed(() => {
  if (dotState.value === 'down') return connectivityMsg.value || `${ASSISTANT_NAME} 暂时连不上`
  return `${ASSISTANT_NAME} 在线`
})
</script>

<template>
  <button
    class="group fixed left-4 bottom-4 z-40 inline-flex items-center gap-[7px] py-[7px] pl-2.5 pr-3 rounded-full bg-white/[0.06] backdrop-blur-md ring-1 ring-white/10 shadow-lg transition-colors hover:bg-white/[0.1] hover:ring-teal-300/40"
    :title="`${ASSISTANT_NAME} · AI 助手（${keyHint}）${dotState === 'down' ? '｜' + (connectivityMsg || '连不上') : ''}`"
    @click="store.show()"
  >
    <span class="relative shrink-0">
      <IconRobot class="w-[15px] h-[15px] text-teal-300/90" />
      <span
        v-if="dotState !== 'none'"
        class="launcher-dot absolute -left-0.5 -bottom-0.5 w-1.5 h-1.5 rounded-full ring-2 ring-slate-900"
        :class="dotState === 'down' ? 'bg-amber-400 is-down' : 'bg-emerald-400'"
        :title="dotTitle"
      />
    </span>
    <span class="text-[12.5px] font-medium text-white/80 group-hover:text-white transition-colors">问{{ ASSISTANT_NAME }}</span>
    <kbd class="font-mono text-[10px] px-1.5 py-0.5 rounded-[5px] text-white/55 bg-white/[0.08] ring-1 ring-white/10">{{ keyHint }}</kbd>
    <span v-if="store.unread" class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-400 ring-2 ring-slate-900 unread-pulse" />
  </button>
</template>

<style scoped>
.unread-pulse {
  animation: launcher-pulse 1.5s ease-in-out infinite;
}
.launcher-dot.is-down {
  animation: launcher-pulse 1.2s ease-in-out infinite;
}
@keyframes launcher-pulse {
  50% { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .unread-pulse,
  .launcher-dot.is-down { animation: none; }
}
</style>
