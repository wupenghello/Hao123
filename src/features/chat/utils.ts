/**
 * Chat 助手 · 共享工具函数
 *
 * 保留时间工具与图片校验；token 估算与历史截断已迁入 agent/build-messages.ts；
 * JSON 泄漏抑制已删除（由 system prompt 约束替代，见 agent/build-messages.ts）。
 */

/** 根据本地小时数返回中文时段 */
export function daypart(hour: number): string {
  if (hour < 6) return '深夜'
  if (hour < 9) return '清晨'
  if (hour < 12) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  if (hour < 23) return '晚上'
  return '深夜'
}

/** 本地日期中文格式化（如"2024年6月25日星期三"） */
export function formatDate(now: Date): string {
  return now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
}

/** 本地时间 HH:MM 格式化（如"14:30"） */
export function formatTime(now: Date): string {
  return now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// ============ 图片添加策略校验（Composer 与测试共用） ============

export interface ValidateImageAdd {
  error: string | null
  /** 被忽略的非图片文件数（不阻塞图片添加，仅提示） */
  ignoredNonImages: number
  accepted: File[]
}

export function validateImageAdd(
  files: File[],
  opts: { maxImages: number; maxImageSizeMB: number; currentCount: number },
): ValidateImageAdd {
  const list = Array.from(files)
  const nonImages = list.filter((f) => !f.type.startsWith('image/'))
  const imgs = list.filter((f) => f.type.startsWith('image/'))

  if (!imgs.length) {
    return { error: '仅支持图片文件（截图 / 照片）', ignoredNonImages: nonImages.length, accepted: [] }
  }
  const maxBytes = opts.maxImageSizeMB * 1024 * 1024
  const oversized = imgs.filter((f) => f.size > maxBytes)
  if (oversized.length) {
    return {
      error: `${oversized.map((f) => f.name).join('、')} 超过单张 ${opts.maxImageSizeMB}MB 限制`,
      ignoredNonImages: nonImages.length,
      accepted: [],
    }
  }
  if (opts.currentCount + imgs.length > opts.maxImages) {
    return {
      error: `最多同时上传 ${opts.maxImages} 张图片`,
      ignoredNonImages: nonImages.length,
      accepted: [],
    }
  }
  return { error: null, ignoredNonImages: nonImages.length, accepted: imgs }
}
