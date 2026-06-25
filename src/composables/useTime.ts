import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 响应式时间 composable
 * 返回格式："周五  6月13日  14:30"
 *
 * 显示精度仅到分钟，故不用 1s 轮询：那样每分钟会触发 60 次重排（59 次浪费），
 * 且分钟翻转最多滞后近 1 秒。改为对齐到下一个整分钟边界再刷新。
 */
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function formatTime(now: Date): string {
  const month = now.getMonth() + 1
  const day = now.getDate()
  const weekday = WEEKDAYS[now.getDay()]
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `周${weekday}  ${month}月${day}日  ${hh}:${mm}`
}

export function useTime() {
  const time = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined

  function update() {
    const formatted = formatTime(new Date())
    // 仅当展示值变化时才赋值，避免无谓的重渲染
    if (formatted !== time.value) time.value = formatted
  }

  function scheduleNext() {
    // 距下一个整分钟的毫秒数（分钟边界对齐 Unix 纪元，故与钟表分钟一致）
    const msToNextMinute = 60_000 - (Date.now() % 60_000)
    timer = setTimeout(() => {
      update()
      scheduleNext()
    }, msToNextMinute)
  }

  onMounted(() => {
    update()
    scheduleNext()
  })

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return { time }
}
