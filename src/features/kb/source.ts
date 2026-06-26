/**
 * 知识库 · 文档来源加载（本地虚拟模块 / 远程 fetch，统一异步接口）
 *
 * 浏览器不能直接读本地磁盘任意文件夹，故本地源由 vite-plugin-kb 在 dev/构建时
 * 把文档注入虚拟模块 'virtual:kb-docs'；远程源则前端运行时 fetch manifest URL。
 * 上层（loader.ts）只依赖本模块的 loadKbDocs，不关心来源。
 */
import { docs as localDocs } from 'virtual:kb-docs'
import { kbConfig } from './config'
import type { RawDoc } from './types'

/** 远程 manifest 缓存（in-flight Promise，去重并发请求） */
let remotePromise: Promise<RawDoc[]> | null = null

/** 远程 fetch 超时（ms）；卡住的远程地址不会让整轮 agent 挂起 */
const REMOTE_TIMEOUT = 8000

/** 校验远程 manifest 形状：必须是数组，且每项含 doc/title/content 字符串 */
function toValidDocs(data: unknown): RawDoc[] {
  if (!Array.isArray(data)) return []
  return data.filter(
    (d): d is RawDoc =>
      !!d &&
      typeof (d as RawDoc).doc === 'string' &&
      typeof (d as RawDoc).title === 'string' &&
      typeof (d as RawDoc).content === 'string',
  )
}

/**
 * 组合超时与外部中止信号为一个 AbortSignal：任一触发即中止 fetch。
 * AbortSignal.any 现代浏览器支持（Chrome 116+/FF 124+）；缺失时退回超时信号。
 */
function mergeSignals(external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REMOTE_TIMEOUT)
  if (!external) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([timeout, external])
  return timeout
}

/**
 * 加载全部知识库文档原文。
 * - 本地源：直接返回虚拟模块数据（dev 读 fs / 构建时注入）。不额外缓存，
 *   dev 改文档后刷新页面即生效（虚拟模块重新 load，loader 缓存随之重建）。
 * - 远程源：fetch manifest URL，带超时与 abort；结果按 in-flight Promise 去重，
 *   manifest 形状异常时返回空数组而非崩溃。URL 须返回 JSON 数组 [{doc,title,content}, ...]。
 *
 * @param signal 外部中止信号（如 agent 循环的 AbortController）；中止时抛 AbortError
 */
export async function loadKbDocs(signal?: AbortSignal): Promise<RawDoc[]> {
  if (!kbConfig.isRemote) return localDocs

  if (remotePromise) return remotePromise

  remotePromise = (async () => {
    const res = await fetch(kbConfig.source, { signal: mergeSignals(signal) })
    if (!res.ok) {
      throw new Error(`知识库 manifest 加载失败（${res.status}）：${kbConfig.source}`)
    }
    return toValidDocs(await res.json())
  })()

  // 失败：清掉失败的 Promise，下次可重试，而非永久卡住
  try {
    return await remotePromise
  } catch (e) {
    remotePromise = null
    throw e
  }
}

/** 清除远程 manifest 缓存（供 clearKbCache 转发，调试 / 远程源刷新用） */
export function clearRemoteCache(): void {
  remotePromise = null
}
