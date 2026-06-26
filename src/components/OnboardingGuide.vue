<script setup lang="ts">
/**
 * 首次访问引导（3 步 onboarding 覆盖层）
 *
 * 检测三项配置状态：LLM 接入 / 禅道连接 / 天气城市，
 * 引导用户快速了解应用功能。已完成全部配置时提供跳过选项。
 *
 * 由 WelcomePage 控制显示时机（localStorage 'hao123-onboarding-done' 标记）。
 */
import { computed } from 'vue'
import { useChatStore } from '@/features/chat'
import { useZentaoSession } from '@/features/zentao'
import { useWeatherStore } from '@/features/weather'
import IconCheck from '~icons/mdi/check-circle'
import IconAlert from '~icons/mdi/alert-circle-outline'

const emit = defineEmits<{ done: [] }>()

const chatStore = useChatStore()
const session = useZentaoSession()
const weather = useWeatherStore()

const steps = computed(() => [
  {
    title: 'AI 助手',
    desc: chatStore.configured
      ? 'LLM 已接入，可以随时和小吴对话'
      : '在 .env 中配置 VITE_DEEPSEEK_API_KEY 并重启开发服务',
    done: chatStore.configured,
  },
  {
    title: '禅道连接',
    desc: session.configured
      ? '禅道账号已连接，任务与 Bug 数据就绪'
      : '在 .env 中配置 VITE_ZENTAO_BASE / ACCOUNT / PASSWORD',
    done: session.configured,
  },
  {
    // 天气就绪信号是「实况已加载」而非「城市名不是默认值」。
    // 此前用 cityName !== '北京' 判定，但默认城市就是北京、且 GPS 定位回退 nearestCity()
    // 对北京用户也返回 '北京'，会导致北京用户即使天气正常也永远完不成该步。
    title: '天气城市',
    desc: weather.now
      ? `当前城市：${weather.cityName || '北京'}`
      : '正在加载天气，或检查 VITE_QWEATHER_API_KEY 是否配置',
    done: !!weather.now,
  },
])

const allDone = computed(() => steps.value.every(s => s.done))
</script>

<template>
  <div class="onboard-overlay" @click.self="emit('done')">
    <div class="onboard-card">
      <!-- 标题 -->
      <div class="onboard-header">
        <span class="text-lg">🚀</span>
        <h2 class="text-lg font-semibold text-white/95">快速设置</h2>
        <p class="mt-1 text-xs text-white/45">确认以下配置即可开始使用</p>
      </div>

      <!-- 步骤列表 -->
      <div class="onboard-steps">
        <div
          v-for="(step, i) in steps"
          :key="i"
          class="onboard-step"
          :class="{ 'is-done': step.done }"
        >
          <div class="onboard-step-num" :class="{ 'is-done': step.done }">
            <IconCheck v-if="step.done" class="w-3 h-3" />
            <span v-else>{{ i + 1 }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-white/90">{{ step.title }}</p>
            <p class="text-xs text-white/50 mt-0.5">{{ step.desc }}</p>
          </div>
          <span v-if="step.done" class="text-[11px] text-emerald-300/80 shrink-0">✓</span>
          <IconAlert v-else class="w-4 h-4 text-amber-300/60 shrink-0" />
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="onboard-footer">
        <button
          class="onboard-btn"
          :class="{ 'is-primary': allDone }"
          @click="emit('done')"
        >
          {{ allDone ? '开始使用' : '我知道了' }}
        </button>
      </div>
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
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
}

.onboard-card {
  width: 100%;
  max-width: 400px;
  margin: 0 16px;
  border-radius: 18px;
  background:
    linear-gradient(160deg, rgba(30, 58, 95, 0.96), rgba(15, 23, 42, 0.98) 60%, rgba(13, 64, 64, 0.96)),
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
  padding: 20px 24px 16px;
  text-align: center;
}

.onboard-steps {
  padding: 0 16px;
}

.onboard-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.2s;
}
.onboard-step + .onboard-step {
  margin-top: 8px;
}
.onboard-step.is-done {
  background: rgba(45, 212, 191, 0.05);
  border-color: rgba(45, 212, 191, 0.15);
}

.onboard-step-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.onboard-step-num.is-done {
  color: #5eead4;
  background: rgba(45, 212, 191, 0.15);
  border-color: rgba(94, 234, 212, 0.3);
}

.onboard-footer {
  padding: 16px 24px 20px;
  display: flex;
  justify-content: center;
}

.onboard-btn {
  padding: 10px 32px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  transition: all 0.18s;
}
.onboard-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.onboard-btn.is-primary {
  color: #fff;
  background: linear-gradient(150deg, rgba(56, 189, 248, 0.85), rgba(20, 184, 166, 0.85));
  border-color: rgba(94, 234, 212, 0.4);
  box-shadow: 0 4px 16px -4px rgba(20, 184, 166, 0.5);
}
.onboard-btn.is-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px -4px rgba(20, 184, 166, 0.6);
}

@media (prefers-reduced-motion: reduce) {
  .onboard-step, .onboard-btn { transition: none; }
}
</style>
