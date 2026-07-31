/**
 * Avatar 模块 · 运行时加载器
 *
 * pixi-live2d-display 在模块顶层检查 window.Live2DCubismCore 是否存在，
 * 不存在直接 throw。因此必须在 import 该模块之前，先把 Cubism 4 运行时
 * 脚本注入页面。
 *
 * 这里提供：
 *  - loadCubism4Runtime(): 动态注入 live2dcubismcore.min.js，返回 Promise
 *  - 单例缓存：并发调用只加载一次
 *
 * 资源来源：
 *  - 运行时：本地 public/avatar/runtime/（优先），CDN 回退
 *  - 模型：Live2D 官方示例 Hiyori（Cubism 4，CDN）
 */

/** 本地运行时文件（构建时打入 public 目录，稳定可用） */
const CUBISM4_RUNTIME_LOCAL = '/avatar/runtime/live2dcubismcore.min.js'

/** 备用：官方 CDN（本地文件意外丢失时回退） */
const CUBISM4_RUNTIME_URL_FALLBACK =
  'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'

let runtimePromise: Promise<void> | null = null

/** 注入一个 <script> 标签并等待加载完成 */
function injectScript(url: string, mark: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 已存在则直接返回
    if (document.querySelector(`script[data-avatar-runtime="${mark}"]`)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.dataset.avatarRuntime = mark
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`加载 Cubism 运行时失败: ${url}`))
    document.head.appendChild(script)
  })
}

/**
 * 确保 Cubism 4 运行时已加载。
 * 并发调用会共享同一个 Promise，只加载一次。
 * 优先本地文件，失败回退官方 CDN。
 */
export async function loadCubism4Runtime(): Promise<void> {
  if (runtimePromise) return runtimePromise

  runtimePromise = (async () => {
    // 已经存在（比如手动提前加载过）
    if ((window as any).Live2DCubismCore) return

    try {
      await injectScript(CUBISM4_RUNTIME_LOCAL, CUBISM4_RUNTIME_LOCAL)
    } catch (e) {
      // 本地失败，回退官方 CDN
      console.warn('[avatar] 本地运行时加载失败，回退官方 CDN:', e)
      await injectScript(CUBISM4_RUNTIME_URL_FALLBACK, CUBISM4_RUNTIME_URL_FALLBACK)
    }

    // 最终检查
    if (!(window as any).Live2DCubismCore) {
      throw new Error('Cubism 4 运行时加载后仍不可用')
    }
  })()

  return runtimePromise
}

/** 默认模型：Live2D 官方示例 Hiyori（Cubism 4） */
export const DEFAULT_MODEL_URL =
  'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/Hiyori/Hiyori.model3.json'
