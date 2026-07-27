/**
 * 占位渲染器：Live2D 不可用（无 WebGL / 加载失败 / dev preview 无 rAF）时的 HUD 光球降级。
 *
 * - 内联 SVG 光球（非 emoji、非 icon），mood 驱动色调（容器 color = tone）。
 * - 保证「即使 Live2D 挂了，伙伴仍在、mood 仍在」——这也是 preview 能验证的基线。
 * - CSS 一次性注入 <head>（innerSVG 无 data-v，scoped 不生效），全局类名带 cp- 前缀防冲突。
 */
import type { CompanionRenderer, RendererOpts, CompanionMood } from '../types'
import { MOOD_VISUAL } from '../ui'

let styleInjected = false
function injectStyle(): void {
  if (styleInjected || typeof document === 'undefined') return
  styleInjected = true
  const css = `
.companion-placeholder{position:relative;width:100%;height:100%;display:grid;place-items:center;color:#22d3ee}
.companion-placeholder .cp-orb{width:78%;height:78%;display:block;animation:cp-breath 2.6s cubic-bezier(.45,.05,.55,.95) infinite}
.companion-placeholder .cp-orb-halo{fill:currentColor;opacity:.14;animation:cp-halo 3.2s ease-in-out infinite}
.companion-placeholder .cp-orb-body{filter:drop-shadow(0 0 10px currentColor)}
.companion-placeholder .cp-eye{fill:rgba(8,14,28,.92)}
.companion-placeholder .cp-orb-mouth{fill:none;stroke:rgba(8,14,28,.7);stroke-width:2.4;stroke-linecap:round}
.companion-placeholder[data-mood="sleeping"] .cp-orb-eyes{transform:scaleY(.12);transform-origin:center 56px}
.companion-placeholder[data-mood="concerned"] .cp-orb-mouth{d:path("M52 73 Q60 68 68 73")}
.companion-placeholder[data-mood="celebrating"] .cp-orb{animation:cp-pop .6s cubic-bezier(.2,1.2,.4,1) 2}
@keyframes cp-breath{0%,100%{transform:scale(.94)}50%{transform:scale(1.04)}}
@keyframes cp-halo{0%,100%{opacity:.1}50%{opacity:.24}}
@keyframes cp-pop{0%{transform:scale(.94)}50%{transform:scale(1.1)}100%{transform:scale(.94)}}
@media (prefers-reduced-motion: reduce){
  .companion-placeholder .cp-orb,.companion-placeholder .cp-orb-halo{animation:none}
}`
  const s = document.createElement('style')
  s.setAttribute('data-companion-placeholder', '')
  s.textContent = css
  document.head.appendChild(s)
}

export class PlaceholderRenderer implements CompanionRenderer {
  private el: HTMLElement | null = null
  private mood: CompanionMood = 'idle'

  async mount(container: HTMLElement, opts: RendererOpts): Promise<void> {
    this.mood = opts.parentMood
    this.el = container
    injectStyle()
    container.classList.add('companion-placeholder')
    container.setAttribute('data-mood', this.mood)
    container.style.color = MOOD_VISUAL[this.mood].tone
    container.innerHTML = this.svg()
    opts.onReady?.()
  }

  setMood(mood: CompanionMood): void {
    this.mood = mood
    if (this.el) {
      this.el.setAttribute('data-mood', mood)
      this.el.style.color = MOOD_VISUAL[mood].tone
    }
  }

  lookAt(): void {
    /* 占位不跟随 */
  }
  playOnce(): void {
    /* 占位无一次性动作；celebrating 由 data-mood 驱动脉冲 */
  }
  setPaused(): void {
    /* 占位靠 CSS + reduced-motion，无需暂停 */
  }
  speak(): void {
    /* 无 TTS */
  }

  destroy(): void {
    if (this.el) {
      this.el.classList.remove('companion-placeholder')
      this.el.removeAttribute('data-mood')
      this.el.innerHTML = ''
    }
    this.el = null
  }

  private svg(): string {
    return `<svg class="cp-orb" viewBox="0 0 120 120" aria-hidden="true">
      <circle class="cp-orb-halo" cx="60" cy="60" r="54" />
      <circle class="cp-orb-body" cx="60" cy="58" r="38" />
      <g class="cp-orb-eyes">
        <ellipse class="cp-eye" cx="48" cy="56" rx="4.6" ry="6.6" />
        <ellipse class="cp-eye" cx="72" cy="56" rx="4.6" ry="6.6" />
      </g>
      <path class="cp-orb-mouth" d="M52 70 Q60 76 68 70" />
    </svg>`
  }
}
