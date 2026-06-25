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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
