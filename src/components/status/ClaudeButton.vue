<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { fetchClaudeStatus, triggerClaudeLaunch, claudeEnabled } from '@/features/claude'
import { useFeedback } from '@/features/feedback'

/**
 * 状态栏左侧 Claude Code 启动按钮
 * 点击后在 VITE_WBSCF_WEB_ROOT 目录下新开终端启动 Claude Code CLI
 */
// 默认显示，只有明确收到 enabled:false 才隐藏（避免临时网络波动/DevServer重启导致按钮消失）
const available = ref(true)
const launching = ref(false)
const launchSuccess = ref(false)
const feedback = useFeedback()
let successTimer: number | null = null
let pollTimer: number | null = null

async function checkAvailable() {
  try {
    const data = await fetchClaudeStatus()
    available.value = data.enabled
    // 非2xx/请求失败：保持现有显示状态，不主动隐藏按钮
  } catch {
    // 网络错误：保持现有状态，不隐藏
  }
}

async function launch() {
  // 启动中、或刚启动成功（1.5s 绿色反馈）期间屏蔽点击，防止一次物理连点叠开多个窗口；
  // 反馈消失后仍可再次点击开新窗口（多窗口是刻意保留的能力）。
  if (launching.value || launchSuccess.value) return
  launching.value = true
  if (successTimer) clearTimeout(successTimer)
  launchSuccess.value = false
  try {
    const data = await triggerClaudeLaunch()
    if (data.ok) {
      // 启动成功：立刻解除点击锁定，短暂显示绿色反馈
      launching.value = false
      launchSuccess.value = true
      successTimer = window.setTimeout(() => {
        launchSuccess.value = false
      }, 1500)
      return
    } else {
      feedback.danger({
        title: 'Claude Code 启动失败',
        message: data.error || '未知错误',
        duration: 6800,
      })
    }
  } catch (e) {
    feedback.danger({
      title: 'Claude Code 请求失败',
      message: e instanceof Error ? e.message : String(e),
      duration: 6800,
    })
  }
  launching.value = false
}

onMounted(() => {
  // 生产构建下 claudeEnabled 为 false（构建期常量，Rollup 会 DCE 掉整段轮询与按钮渲染），
  // 不发请求——避免生产环境出现常驻但点击必报错的死按钮（对齐 wbscf 入口的 fail-closed 约定）。
  if (!claudeEnabled) return
  checkAvailable()
  pollTimer = window.setInterval(checkAvailable, 30000)
  document.addEventListener('visibilitychange', checkAvailable)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (successTimer) clearTimeout(successTimer)
  // 移除 visibilitychange 事件监听，避免内存泄漏
  document.removeEventListener('visibilitychange', checkAvailable)
})
</script>

<template>
  <button
    v-if="claudeEnabled && available"
    type="button"
    class="claude-btn"
    :class="{ 'is-success': launchSuccess, 'is-launching': launching }"
    title="新开终端启动 Claude Code（wbscf-web 目录）"
    @click="launch"
  >
    <span v-if="launching">启动中…</span>
    <span v-else-if="launchSuccess">已启动</span>
    <span v-else>Claude</span>
  </button>
</template>

<style scoped>
.claude-btn {
  display: inline-flex;
  align-items: center;
  padding: 4px 7px;
  margin: 0 -4px 0 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0;
  color: rgba(224, 242, 254, 0.82);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  appearance: none;
  -webkit-appearance: none;
}

.claude-btn:hover {
  background: rgba(125, 211, 252, 0.09);
  color: #fff;
}

.claude-btn.is-launching {
  color: #fcd34d; /* 琥珀色：启动中 */
  cursor: wait;
}
.claude-btn.is-success {
  color: #34d399; /* 绿色：启动成功短暂提示 */
}
.claude-btn.is-success:hover {
  background: rgba(52, 211, 153, 0.1);
}
</style>
