/**
 * 本地任务 · 内部工具函数（id 生成 / 文件判定 / 体积格式化）
 */

/** id 生成：优先用 crypto.randomUUID，老浏览器降级到时间戳 + 随机串 */
export function genId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 是否图片 mime（用于走缩略图预览而非文件图标） */
export function isImageMime(type: string): boolean {
  return typeof type === 'string' && type.startsWith('image/')
}

/** 单个附件体积上限（25MB）。IndexedDB 容量充足，但过大文件拖慢读写且易误传 */
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024

/** 字节 → 人类可读体积（B / KB / MB） */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
