/**
 * Live2D 渲染器（OhMyLive2D 驱动）。
 *
 * 关键事实（已核对 oh-my-live2d 0.19.3 类型）：
 *  - loadOml2d 同步返回实例；parentElement 指定挂载容器（默认 body）。
 *  - 默认自动集成 Cubism 2 + Cubism 5 SDK，无需手动引 core。
 *  - 模型自带 idle 动作 + 鼠标跟随（自动全局跟踪），即「活物感」基线免费获得。
 *  - 公共 API 不暴露底层 model.expression()/motion()——故 mood 级精确表情切换由
 *    容器辉光（CompanionPet 驱动 data-mood + --cp-tone）+ 气泡表达；模型 idle/跟随始终在。
 *  - 无公开 destroy/pause：destroy 清容器 DOM；pause 依赖浏览器切后台自动节流 rAF。
 *  - reduced-motion 路径：由 CompanionPet 直接选用 PlaceholderRenderer（不在本渲染器处理）。
 *
 * 唯一 import 'oh-my-live2d' 处——隔离重依赖（pixi/cubism），便于 tree-shake + 懒加载 + 未来替换。
 */
import { loadOml2d } from 'oh-my-live2d'
import type { Options, ModelOptions } from 'oh-my-live2d'
import type { CompanionRenderer, RendererOpts, CompanionMood } from '../types'
import { SENKO_OML2D_CONFIG } from '../config'

export class Live2DRenderer implements CompanionRenderer {
  private container: HTMLElement | null = null

  async mount(container: HTMLElement, opts: RendererOpts): Promise<void> {
    this.container = container

    const model: ModelOptions = {
      path: opts.modelSource || SENKO_OML2D_CONFIG.path,
      position: SENKO_OML2D_CONFIG.position,
      scale: 0.1,
      volume: 0, // 不放模型自带声音（伙伴语音走 CompanionBubble）
      motionPreloadStrategy: 'IDLE',
    }

    const options: Options = {
      parentElement: container,
      dockedPosition: 'right',
      primaryColor: '#22d3ee',
      models: [model],
      sayHello: false,
      transitionTime: 0,
      initialStatus: 'active',
      // 关掉 OhMyLive2D 自带 chrome：状态条、菜单、提示框（含欢迎/闲置/复制提示），
      // 语音完全由我们的 CompanionBubble 承担，避免双套气泡。
      statusBar: { disable: true },
      menus: { disable: true },
      tips: {
        idleTips: { message: [] },
        copyTips: { message: [] },
        welcomeTips: {
          duration: 1,
          message: {
            daybreak: '',
            morning: '',
            noon: '',
            afternoon: '',
            dusk: '',
            night: '',
            lateNight: '',
            weeHours: '',
          },
        },
      },
      stageStyle: { width: 180, height: 240 },
    }

    try {
      const inst = loadOml2d(options)
      inst.onLoad((status) => {
        if (status === 'success') opts.onReady?.()
        else if (status === 'fail') opts.onError?.(new Error('Live2D 模型加载失败'))
      })
    } catch (e) {
      opts.onError?.(e)
      throw e
    }
  }

  setMood(_mood: CompanionMood): void {
    // OhMyLive2D 公共 API 不暴露 model.expression/motion；mood 视觉由容器辉光（CompanionPet）+ 气泡表达。
    // 模型自带 idle 动作 + 全局鼠标跟随提供活物感基线，无需此处干预。
  }

  lookAt(): void {
    /* OhMyLive2D 自动全局鼠标跟随，无需手动调 */
  }
  playOnce(): void {
    /* 公共 API 不暴露单次动作触发；celebrating 由容器脉冲（CompanionPet）表达 */
  }
  setPaused(): void {
    /* 切后台时浏览器自动节流 rAF；reduced-motion 由上层切 PlaceholderRenderer 实现 */
  }
  speak(): void {
    /* 无 TTS */
  }

  destroy(): void {
    // OhMyLive2D 未暴露公开 destroy；清容器 DOM 即移除舞台（Canvas）与本容器内 chrome。
    if (this.container) this.container.innerHTML = ''
    this.container = null
  }
}
