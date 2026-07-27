/**
 * 渲染器工厂：按 config 选 renderer。
 *  - live2d：动态 import live2d-renderer（隔离 oh-my-live2d 重依赖，懒加载）；
 *    加载失败（缺依赖 / WebGL 不可用 / 模块错）→ 回退 PlaceholderRenderer。
 *  - rive / lottie：未来扩展（接口已留）。
 *  - 占位：直接同步构造。
 */
import type { CompanionRenderer, CompanionRendererKind } from '../types'
import { PlaceholderRenderer } from './placeholder-renderer'

export async function createRenderer(kind: CompanionRendererKind): Promise<CompanionRenderer> {
  if (kind === 'live2d') {
    try {
      const m = await import('./live2d-renderer')
      return new m.Live2DRenderer()
    } catch (e) {
      console.warn('[companion] Live2D 渲染器加载失败，回退占位光球', e)
      return new PlaceholderRenderer()
    }
  }
  // rive / lottie 暂未实现，回退占位
  return new PlaceholderRenderer()
}

export { PlaceholderRenderer }
