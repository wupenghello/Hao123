/**
 * 知识库 · 切片加载（加载文档原文 → 按 ## 切片段 → 缓存）
 *
 * 检索层（search.ts）通过 getKbChunks 拿到全部片段，无需感知数据来源。
 * 缓存为「in-flight Promise」而非值：并发首次检索只会触发一次加载
 * （远程模式下只发一次 fetch），避免重复 I/O。dev 刷新页面时模块重新执行、
 * 缓存随之清空。
 */
import { loadKbDocs, clearRemoteCache } from './source'
import { chunkDoc } from './chunker'
import type { KbChunk } from './types'

let chunksPromise: Promise<KbChunk[]> | null = null

/**
 * 加载并切分全部文档片段（首次调用后缓存；并发调用复用同一 in-flight Promise）。
 * @param signal 外部中止信号，透传给远程 fetch（首次加载尚未完成时可中止）
 */
export function getKbChunks(signal?: AbortSignal): Promise<KbChunk[]> {
  if (chunksPromise) return chunksPromise
  chunksPromise = loadKbDocs(signal)
    .then((docs) => docs.flatMap((d) => chunkDoc(d.content, d.doc, d.title)))
    .catch((e) => {
      // 加载失败：清掉失败的 Promise，下次检索可重试，而非永久卡住
      chunksPromise = null
      throw e
    })
  return chunksPromise
}

/** 清除全部缓存（切片 + 远程 manifest），供调试 / 远程源刷新用 */
export function clearKbCache(): void {
  chunksPromise = null
  clearRemoteCache()
}
