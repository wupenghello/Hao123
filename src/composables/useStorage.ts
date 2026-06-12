import { ref, watch, type Ref } from 'vue'

/**
 * 响应式 localStorage 封装
 * 数据变化时自动持久化，初始化时自动读取
 */
export function useStorage<T>(key: string, defaultValue: T): Ref<T> {
  const stored = localStorage.getItem(key)
  const data = ref<T>(stored ? JSON.parse(stored) : defaultValue) as Ref<T>

  watch(
    data,
    (val) => {
      localStorage.setItem(key, JSON.stringify(val))
    },
    { deep: true }
  )

  return data
}
