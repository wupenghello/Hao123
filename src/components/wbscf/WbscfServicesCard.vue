<script setup lang="ts">
/**
 * wbscf-web 本地 dev 服务 · 服务状态卡（模块 5）
 *
 * 每个子应用一张迷你状态卡：
 *  - 运行中 → 青柠绿脉冲灯 + 「打开」ghost 按钮
 *  - 启动中 → 琥珀呼吸灯 + 「启动中」
 *  - 未运行 → 灰点 + 「启动」ghost 按钮
 * 端口与地址用等宽字体；按钮 ghost 风格，hover 电光蓝 glow。
 *
 * 仅 dev 且 wbscf-web 根目录已配置时由父组件按 services.length 门控渲染。
 */
import { computed } from 'vue'
import { useWbscfServices } from '@/features/wbscf'
import type { WbscfServiceStatus } from '@/features/wbscf'
import IconPlay from '~icons/mdi/play-circle-outline'
import IconOpen from '~icons/mdi/open-in-new'
import IconLoading from '~icons/mdi/loading'

const { services, startOrOpen } = useWbscfServices()

/** 只展示「脚本可用」的服务（available=true），与 NavRail 的 localhost 入口同口径 */
const visible = computed(() => services.value.filter((s) => s.available))

function tone(s: WbscfServiceStatus): 'running' | 'booting' | 'idle' {
  if (s.running) return 'running'
  if (s.booting) return 'booting'
  return 'idle'
}
function btnLabel(s: WbscfServiceStatus): string {
  if (s.running) return '打开'
  if (s.booting) return '启动中'
  return '启动'
}
</script>

<template>
  <div v-if="visible.length" class="wbscf-card bento-cell" aria-label="本地 dev 服务">
    <div class="wbscf-head">
      <span class="bento-kicker">local dev services</span>
      <span class="wbscf-count">{{ visible.filter((s) => s.running).length }}/{{ visible.length }} 运行中</span>
    </div>
    <div class="wbscf-grid">
      <div
        v-for="s in visible"
        :key="s.app"
        class="svc"
        :data-tone="tone(s)"
      >
        <span class="svc-led" :class="`is-${tone(s)}`" aria-hidden="true" />
        <div class="svc-body">
          <span class="svc-label">{{ s.label }}</span>
          <span class="svc-port">localhost:{{ s.port }}</span>
        </div>
        <button
          type="button"
          class="svc-btn"
          :class="{ 'is-running': s.running, 'is-booting': s.booting }"
          :disabled="s.booting"
          :title="s.running ? `打开 ${s.url}` : s.booting ? '正在启动…' : `启动 ${s.label} dev 服务`"
          @click="startOrOpen(s.app)"
        >
          <IconLoading v-if="s.booting" class="svc-spin" />
          <IconOpen v-else-if="s.running" />
          <IconPlay v-else />
          <span>{{ btnLabel(s) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wbscf-card {
  padding: 12px 14px;
}
.wbscf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.wbscf-count {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: rgba(226, 232, 240, 0.5);
  font-variant-numeric: tabular-nums;
}
.wbscf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

/* 单个服务迷你卡 */
.svc {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.025);
  transition: border-color 0.18s var(--ease, ease), background 0.18s var(--ease, ease);
}
.svc[data-tone='running'] {
  border-color: rgba(0, 255, 148, 0.28);
  background: rgba(0, 255, 148, 0.05);
}
.svc[data-tone='booting'] {
  border-color: rgba(251, 191, 36, 0.28);
  background: rgba(251, 191, 36, 0.05);
}
.svc:hover {
  border-color: rgba(0, 217, 255, 0.3);
}

/* 状态脉冲灯 */
.svc-led {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 999px;
}
.svc-led.is-running {
  background: var(--run, #00ff94);
  box-shadow: 0 0 8px rgba(0, 255, 148, 0.8);
  animation: svc-pulse 1.6s ease-in-out infinite;
}
.svc-led.is-booting {
  background: #fbbf24;
  box-shadow: 0 0 8px rgba(251, 191, 36, 0.7);
  animation: svc-pulse 1s ease-in-out infinite;
}
.svc-led.is-idle {
  background: rgba(255, 255, 255, 0.22);
}
@keyframes svc-pulse {
  0%, 100% { opacity: 0.55; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.15); }
}

.svc-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.svc-label {
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(248, 250, 252, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.svc-port {
  font-family: var(--font-mono, ui-monospace, 'JetBrains Mono', monospace);
  font-size: 10.5px;
  color: rgba(226, 232, 240, 0.48);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ghost 按钮：透明底 + 描边，hover 电光蓝 glow */
.svc-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: var(--radius-btn, 8px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: rgba(226, 232, 240, 0.78);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s var(--ease, cubic-bezier(0.22, 1, 0.36, 1));
}
.svc-btn :deep(svg),
.svc-btn svg {
  width: 13px;
  height: 13px;
}
.svc-btn:hover:not(:disabled) {
  border-color: rgba(0, 217, 255, 0.5);
  color: #fff;
  background: rgba(0, 217, 255, 0.08);
  box-shadow: 0 0 14px rgba(0, 217, 255, 0.22);
}
.svc-btn.is-running {
  border-color: rgba(0, 255, 148, 0.4);
  color: var(--run, #00ff94);
}
.svc-btn.is-running:hover {
  border-color: rgba(0, 255, 148, 0.7);
  background: rgba(0, 255, 148, 0.08);
  box-shadow: 0 0 14px rgba(0, 255, 148, 0.28);
}
.svc-btn.is-booting {
  color: #fbbf24;
  cursor: progress;
}
.svc-spin { animation: svc-spin 0.9s linear infinite; }
@keyframes svc-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .svc-led.is-running,
  .svc-led.is-booting,
  .svc-spin { animation: none; }
}
</style>
