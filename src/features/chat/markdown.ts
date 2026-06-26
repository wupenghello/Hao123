/**
 * Chat 助手 · Markdown 渲染
 *
 * 用 markdown-it 把助手回复渲染为 HTML。默认 html:false（转义内联 HTML），
 * 避免 LLM 输出注入风险；linkify 自动识别链接，链接统一新窗口打开。
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

/** 渲染 Markdown 文本为 HTML 字符串 */
export function renderMarkdown(text: string): string {
  return md.render(text || '')
}
