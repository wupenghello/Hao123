/**
 * Chat 助手 · Markdown 渲染
 *
 * 用 markdown-it 把助手回复渲染为 HTML。默认 html:false（转义内联 HTML），
 * 避免 LLM 输出注入风险；linkify 自动识别链接，链接统一新窗口打开。
 * 增强：代码块支持一键复制。
 */
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false, // 不解析原始 HTML，转义之，防注入
  linkify: true, // 自动把纯文本 URL 变链接
  breaks: true, // 单个换行也渲染为 <br>，贴合聊天习惯
})

interface RenderMarkdownOptions {
  /** 流式生成中：未闭合的代码块展示为不可复制，避免复制半截代码。 */
  streaming?: boolean
}

interface RenderMarkdownEnv {
  streaming?: boolean
  closedFenceStarts?: Set<number>
}

// 链接统一在新标签打开 + noopener
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// 转义 HTML 特殊字符
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// 自定义代码块渲染：添加复制按钮
const defaultFence =
  md.renderer.rules.fence ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

// 代码内容不内联进 onclick（换行符 / 单引号会让内联 JS 字符串语法报错，
// 且 HTML 属性解码会绕过转义形成注入）。复制按钮只放一个 class 标记，
// 真正的代码由组件侧用事件委托从相邻 <pre> 的 textContent 读取。
md.renderer.rules.fence = (tokens, idx, options, env: RenderMarkdownEnv, self) => {
  const token = tokens[idx]
  const lang = escapeHtml(token.info.trim()) || 'code'
  const lineCount = token.content.split('\n').length
  const originalHtml = defaultFence(tokens, idx, options, env, self)
  const startLine = token.map?.[0]
  const isClosed = typeof startLine === 'number' && env.closedFenceStarts?.has(startLine)
  const copyDisabled = !!env.streaming && !isClosed
  const copyAttrs = copyDisabled
    ? 'disabled aria-disabled="true" data-copy-disabled="true" title="代码生成完成后可复制"'
    : 'title="复制代码"'
  const copyText = copyDisabled ? '生成中...' : '复制'

  return `
    <div class="code-block-wrapper" data-line-count="${lineCount}">
      <div class="code-block-header">
        <span class="code-lang">${lang}</span>
        <span class="code-line-count">${lineCount} 行</span>
        <button class="code-copy-btn" type="button" ${copyAttrs}>${copyText}</button>
      </div>
      ${originalHtml}
    </div>
  `
}

function closedFenceStarts(text: string): Set<number> {
  const starts = new Set<number>()
  const lines = text.split(/\r?\n/)
  let open: { line: number; marker: '`' | '~'; length: number } | null = null

  lines.forEach((line, index) => {
    if (!open) {
      const match = /^( {0,3})(`{3,}|~{3,})/.exec(line)
      if (!match) return
      const fence = match[2]
      open = { line: index, marker: fence[0] as '`' | '~', length: fence.length }
      return
    }

    const closeRe = new RegExp(`^ {0,3}\\${open.marker}{${open.length},}\\s*$`)
    if (closeRe.test(line)) {
      starts.add(open.line)
      open = null
    }
  })

  return starts
}

/**
 * 渲染 Markdown 文本为 HTML 字符串
 * @param text Markdown 文本
 */
export function renderMarkdown(text: string, options: RenderMarkdownOptions = {}): string {
  const source = text || ''
  return md.render(source, {
    streaming: options.streaming,
    closedFenceStarts: options.streaming ? closedFenceStarts(source) : undefined,
  } satisfies RenderMarkdownEnv)
}
