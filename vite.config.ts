import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import Icons from 'unplugin-icons/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  // 和风天气 API Host：2023 年后注册的账户不再支持公共 devapi/api 域名，
  // 必须使用控制台（https://console.qweather.com → 设置）分配的专用 API Host
  // （形如 xxxxxxxx.qweatherapi.com），否则返回 403 Invalid Host。
  // 该专用 Host 同时服务数据接口与 GeoAPI，故两个代理共用同一 target。
  const qweatherHost = env.VITE_QWEATHER_API_HOST || 'devapi.qweather.com'
  const qweatherTarget = `https://${qweatherHost}`

  return {
    plugins: [
      vue(),
      tailwindcss(),
      Icons({
        compiler: 'vue3',
        autoInstall: true,
      }),
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
      },
    },
  }
})
