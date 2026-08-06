/**
 * 测试全局环境：jsdom + fake-indexeddb（偏好飞轮等 IDB 存储）。
 * 每个用例前清理 localStorage / IndexedDB，避免用例间串数据。
 */
import { afterEach, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})
