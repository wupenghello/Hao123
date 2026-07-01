import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import Icons from 'unplugin-icons/vite'
import { kbPlugin } from './vite-plugin-kb'
import { wbscfPlugin } from './vite-plugin-wbscf'
import { gitPlugin } from './vite-plugin-git'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  // 和风天气 API Host：2023 年后注册的账户不再支持公共 devapi/api 域名，
  // 必须使用控制台（https://console.qweather.com → 设置）分配的专用 API Host
  // （形如 xxxxxxxx.qweatherapi.com），否则返回 403 Invalid Host。
  // 该专用 Host 同时服务数据接口与 GeoAPI，故两个代理共用同一 target。
  const qweatherHost = env.VITE_QWEATHER_API_HOST || 'devapi.qweather.com'
  const qweatherTarget = `https://${qweatherHost}`

  // 禅道服务器地址（形如 http://zentao.example.com 或带子路径 http://host/zentao）。
  // 走 /zentao 代理转发，规避浏览器跨域与 Set-Cookie 丢失问题。
  const zentaoTarget = env.VITE_ZENTAO_BASE || 'http://localhost'

  // DeepSeek（OpenAI 兼容）API 地址；走 /deepseek 代理转发，规避浏览器跨域。
  const deepseekTarget = env.VITE_DEEPSEEK_BASE || 'https://api.deepseek.com'

  // 知识库来源（VITE_KB_SOURCE）：本地文件夹路径或 http manifest URL。
  // 本地路径由根目录 vite-plugin-kb.ts 在 dev/构建时读取并注入虚拟模块；
  // 远程 URL 由前端直接 fetch（见 source.ts），需地址同源或开放 CORS。
  const kbSource = env.VITE_KB_SOURCE || ''

  // wbscf-web 代码库根目录（VITE_WBSCF_WEB_ROOT）：指向 wbscf-web 仓库，由根目录
  // vite-plugin-wbscf.ts 在 dev 时读其 package.json、拉起 dev:* 脚本并探测端口，
  // 让状态栏导航的 localhost 入口可「点击启动/打开本地服务」。生产构建无 dev server，自动降级。
  const wbscfRoot = env.VITE_WBSCF_WEB_ROOT || ''
  const wbscfPkgMgr = env.VITE_WBSCF_PKG_MGR || 'pnpm'

  return {
    plugins: [
      vue(),
      tailwindcss(),
      Icons({
        compiler: 'vue3',
        autoInstall: true,
      }),
      // 知识库本地源：读取 VITE_KB_SOURCE 指向的文件夹，注入 'virtual:kb-docs'
      kbPlugin(kbSource),
      // wbscf-web 本地 dev 服务：拉起 dev:* 脚本并探测端口（仅 dev，提供 /wbscf/* 中间件）
      wbscfPlugin({ root: wbscfRoot, pkgMgr: wbscfPkgMgr }),
      // wbscf-web git 仓库信息：执行 git 命令返回 JSON（仅 dev，提供 /git/* 中间件）
      gitPlugin({ root: wbscfRoot }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        // 和风天气数据接口（实况/预报/指数/空气/预警 等）
        '/qweather': {
          target: qweatherTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/qweather/, ''),
        },
        // 和风天气 GeoAPI（城市/坐标查询，用于 GPS 反查城市名）
        '/qgeo': {
          target: qweatherTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/qgeo/, ''),
        },
        // 禅道（ZenTao）：鉴权 + 我的任务/Bug 等接口
        '/zentao': {
          target: zentaoTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/zentao/, ''),
        },
        // DeepSeek（OpenAI 兼容）：LLM 对话 / 工具调用
        // 代理层注入 API Key，客户端不再携带，防止密钥暴露在前端包中
        '/deepseek': {
          target: deepseekTarget,
          changeOrigin: true,
          configure: (proxy) => {
            const apiKey = env.VITE_DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || ''
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) {
                proxyReq.setHeader('Authorization', `Bearer ${apiKey}`)
              }
            })
          },
          rewrite: (path) => path.replace(/^\/deepseek/, ''),
        },
      },
    },
  }
})
