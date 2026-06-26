/// <reference types="vite/client" />

declare module '~icons/*' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_QWEATHER_API_KEY: string
  /** 禅道服务器地址（如 http://zentao.example.com，子路径部署则带上如 http://host/zentao） */
  readonly VITE_ZENTAO_BASE: string
  /** 禅道登录账号 */
  readonly VITE_ZENTAO_ACCOUNT: string
  /** 禅道登录密码 */
  readonly VITE_ZENTAO_PASSWORD: string
  /** 禅道演示模式：true 时用本地假数据预览待办提醒/详情，不连真实服务器 */
  readonly VITE_ZENTAO_MOCK?: string
  /** LLM 助手名称（默认「小吴」） */
  readonly VITE_ASSISTANT_NAME?: string
  /** LLM 助手一句话定位（欢迎页/提示用） */
  readonly VITE_ASSISTANT_TAGLINE?: string
  /** LLM API Key（OpenAI 兼容，当前接 DeepSeek） */
  readonly VITE_DEEPSEEK_API_KEY: string
  /** LLM 是否已配置（非敏感布尔开关，客户端据此显示引导；密钥本身由代理注入，不进前端包） */
  readonly VITE_DEEPSEEK_CONFIGURED?: string
  /** LLM 模型名（默认 deepseek-chat） */
  readonly VITE_DEEPSEEK_MODEL?: string
  /** LLM API 根地址（可选，默认 https://api.deepseek.com） */
  readonly VITE_DEEPSEEK_BASE?: string
  /** 知识库来源：本地文件夹路径（如 D:/projects/hao123-kb）或 manifest 的 http URL */
  readonly VITE_KB_SOURCE?: string
}

/** 知识库虚拟模块（由 vite-plugin-kb.ts 在 dev/构建时注入本地文档原文） */
declare module 'virtual:kb-docs' {
  export const docs: { doc: string; title: string; content: string }[]
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
