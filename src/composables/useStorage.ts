import { ref, watch, type Ref } from 'vue'
import { setLocalStorageItem } from '@/features/storage-health'

/**
 * 响应式 localStorage 封装
 * 数据变化时自动持久化，初始化时自动读取
 */
export function useStorage<T>(key: string, defaultValue: T): Ref<T> {
  const stored = localStorage.getItem(key)
  // 容错解析：localStorage 中的值可能损坏或为旧格式，解析失败时回退默认值，
  // 避免启动时抛异常导致整页白屏
  let initial = defaultValue
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as T
      // 解析出 null/undefined（如曾被持久化为 null）时同样回退默认值——
      // 否则下游对默认非空的值（如 cityCoord）做 .split() 会触发空指针
      if (parsed !== null && parsed !== undefined) initial = parsed
    } catch {
      console.warn(`[useStorage] 无法解析 "${key}" 的存储值，已回退默认值`)
    }
  }
  const data = ref<T>(initial) as Ref<T>

  watch(
    data,
    (val) => {
      setLocalStorageItem(key, JSON.stringify(val))
    },
    { deep: true }
  )

  return data
}
