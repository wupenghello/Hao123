import { describe, it, expect } from 'vitest'
import { validateImageAdd } from '@/features/chat/utils'

function img(name: string, mb: number, type = 'image/png'): File {
  return new File([new Uint8Array(Math.max(1, Math.floor(mb * 1024 * 1024)))], name, { type })
}

describe('validateImageAdd（图片添加策略）', () => {
  const opts = { maxImages: 4, maxImageSizeMB: 5, currentCount: 0 }

  it('纯图片且合规时全部接受', () => {
    const v = validateImageAdd([img('a.png', 1), img('b.jpg', 3.5)], opts)
    expect(v.error).toBeNull()
    expect(v.accepted.length).toBe(2)
    expect(v.ignoredNonImages).toBe(0)
  })

  it('超过单张大小限制时报错且整批拒绝', () => {
    const v = validateImageAdd([img('a.png', 1), img('big.png', 6)], opts)
    expect(v.error).toContain('big.png')
    expect(v.error).toContain('5MB')
    expect(v.accepted.length).toBe(0)
  })

  it('超过张数上限时报错且整批拒绝', () => {
    const v = validateImageAdd([img('a.png', 1), img('b.png', 1), img('c.png', 1), img('d.png', 1), img('e.png', 1)], opts)
    expect(v.error).toContain('最多同时上传 4 张')
    expect(v.accepted.length).toBe(0)
  })

  it('已有图片时按当前计数叠加判断', () => {
    const v = validateImageAdd([img('a.png', 1), img('b.png', 1)], { ...opts, currentCount: 3 })
    expect(v.error).toContain('最多同时上传 4 张')
  })

  it('全部为非图片时报错', () => {
    const v = validateImageAdd([new File(['x'], 'a.txt', { type: 'text/plain' })], opts)
    expect(v.error).toBe('仅支持图片文件（截图 / 照片）')
    expect(v.accepted.length).toBe(0)
    expect(v.ignoredNonImages).toBe(1)
  })

  it('混合非图片时图片照常接受并报告忽略数', () => {
    const v = validateImageAdd([img('a.png', 1), new File(['x'], 'a.pdf', { type: 'application/pdf' })], opts)
    expect(v.error).toBeNull()
    expect(v.accepted.length).toBe(1)
    expect(v.ignoredNonImages).toBe(1)
  })
})
