import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 响应式时间 composable
 * 返回格式："周五  6月13日  14:30"
 */
export function useTime() {
  const time = ref('')

  let timer: ReturnType<typeof setInterval>

  function updateTime() {
    const now = new Date()
    const month = now.getMonth() + 1
    const day = now.getDate()
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    time.value = `周${weekday}  ${month}月${day}日  ${hh}:${mm}`
  }

  onMounted(() => {
    updateTime()
    timer = setInterval(updateTime, 1000)
  })

  onUnmounted(() => clearInterval(timer))

  return { time }
}
