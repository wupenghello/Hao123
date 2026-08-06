import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'

/**
 * 独立测试配置：不加载 vite.config.ts 的 dev 插件（kb / wbscf / git / reach 等依赖
 * 外部目录或 env，测试环境不需要也不应有这些副作用），只保留 vue 编译、图标虚拟模块
 * 与 @ 别名。
 */
export default defineConfig({
  plugins: [
    vue(),
    Icons({
      compiler: 'vue3',
      autoInstall: true,
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 测试环境无 dev server，把 KB 虚拟模块映射为空桩
      'virtual:kb-docs': fileURLToPath(new URL('./tests/stubs/kb-docs.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    globals: false,
  },
})
