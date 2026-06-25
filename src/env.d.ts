/// <reference types="vite/client" />

declare module '~icons/*' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_QWEATHER_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
