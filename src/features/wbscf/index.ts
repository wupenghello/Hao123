/**
 * wbscf-web 本地 dev 服务特性模块（barrel）
 *
 * 把「指派给我的」工作台导航项接入 wbscf-web 仓库的本地 dev 服务：在状态栏左上角
 * 账号/买卖家/运营/ERP 各项 hover 的 dev 之前加一个 localhost 入口，点击即拉起并打开
 * 对应子应用的本地服务（已在运行则直接打开、不重复拉起，运行中显示绿点）。
 *
 * 浏览器无法 spawn 进程，真正的拉起 / 探测在根目录 vite-plugin-wbscf.ts（dev server Node 侧）
 * 暴露 /wbscf/* 中间件完成；前端只拉状态 + 用 window.open 打开。外部统一从这里引入：
 *   import { useWbscfServices, wbscfServices } from '@/features/wbscf'
 *
 * 结构（自包含）：
 *   config.ts      静态注册表：app → { label, script, port, base, url }（前后端共用）
 *   types.ts       WbscfServiceStatus / WbscfServicesResponse 契约
 *   api.ts         浏览器侧 fetch 封装（fetchWbscfServices）+ 中转页地址 wbscfLaunchUrl
 *   composable.ts  useWbscfServices：响应式状态 + 轮询 + 点击打开 + 全局启动反馈
 *   llm-tools.ts   LLM 工具层 wbscfToolDefs / callWbscfTool（只读查询服务状态，喂给小吴）
 */
export * from './types'
export * from './config'
export * from './api'
export { useWbscfServices } from './composable'
export * from './llm-tools'
