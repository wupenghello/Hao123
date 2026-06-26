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
md.renderer.rules.fence = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]
  const lang = escapeHtml(token.info.trim()) || 'code'
  const lineCount = token.content.split('\n').length
  const originalHtml = defaultFence(tokens, idx, options, _env, self)

  return `
    <div class="code-block-wrapper" data-line-count="${lineCount}">
      <div class="code-block-header">
        <span class="code-lang">${lang}</span>
        <span class="code-line-count">${lineCount} 行</span>
        <button class="code-copy-btn" type="button" title="复制代码">复制</button>
      </div>
      ${originalHtml}
    </div>
  `
}

/**
 * 渲染 Markdown 文本为 HTML 字符串
 * @param text Markdown 文本
 */
export function renderMarkdown(text: string): string {
  return md.render(text || '')
}
