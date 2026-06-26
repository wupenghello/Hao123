/**
 * 知识库 · 配置（env 驱动）
 *
 * VITE_KB_SOURCE 指定知识库来源：
 *   - 本地文件夹路径（如 D:/projects/hao123-kb）：dev 由 vite-plugin-kb 读 fs、
 *     构建时注入虚拟模块；改文档后 dev 刷新生效、生产需重新构建。
 *   - http(s) URL（如 https://example.com/kb/manifest.json）：前端运行时 fetch，
 *     dev/生产均可用；该 URL 须返回 JSON 文档数组 [{doc,title,content}, ...]。
 *
 * 未配置时 source 为空串 → 知识库为空（工具仍注册，检索返回 0 条）。
 */
import { isHttpSource } from './shared'
import type { RawDoc } from './types'

function envOr(value: string | undefined, fallback: string): string {
  const v = value?.trim()
  return v || fallback
}

export const kbConfig = {
  /** 知识库来源（本地路径 或 http URL）；未配置为空串 */
  source: envOr(import.meta.env.VITE_KB_SOURCE, ''),
  /** 是否为远程（http）源 */
  get isRemote(): boolean {
    return isHttpSource(this.source)
  },
  /** 是否已配置来源（本地路径或 http URL 任一）；用于决定是否启用 kb 能力/工具 */
  get hasSource(): boolean {
    return this.source.length > 0
  },
} as const

/** 远程源返回的 manifest 形状（与本地虚拟模块导出一致） */
export type KbManifest = RawDoc[]
