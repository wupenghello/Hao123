/**
 * wbscf-web 本地 dev 服务 · 静态注册表
 *
 * 把「状态栏导航项 → wbscf-web 仓库的 dev 脚本 + 本地端口」映射固化在一处，
 * 供根目录 vite-plugin-wbscf.ts（Node 侧拉起 / 探测进程）与浏览器侧 composable 共用。
 *
 * 本文件刻意不读 import.meta.env：它被根目录 Node 插件（tsconfig.node）直接 import，
 * 而 import.meta.env 仅在浏览器/构建产物侧可用（参考 kb 把 env 读取放在 config.ts、
 * 不被 Node 插件引用的约定）。是否「启用」的门控（dev + 已配置根目录）放在客户端
 * chat/tools.ts 里就近判断，避免在 Node 侧触发 import.meta.env 类型错误。
 *
 * 端口取自各 app 的 apps/<app>/.env.development 的 VITE_PORT（vben 约定），
 * base 取自同文件的 VITE_BASE（拼本地访问地址用）：
 *   account 5661 /account/ · buyer 5662 /buyer/ · seller 5663 /seller/ · ops 5660 / · erp 5668 /console/
 *
 * 改端口只需改这里；脚本名若与 package.json 不一致，插件探测时会把 available 置 false，
 * 对应导航项的 localhost 入口自动隐藏（dev / test / pre 不受影响）。
 */

export interface WbscfServiceDef {
  /** 应用 key */
  app: string
  /** 展示名（对齐 StatusNav 导航项） */
  label: string
  /** package.json scripts 中的脚本名 */
  script: string
  /** workspace 包名（用于 pnpm 直达子应用，少绕一层根 scripts） */
  pkg: string
  /** dev 端口 */
  port: number
  /** VITE_BASE 路径（用于拼本地访问地址） */
  base: string
  /** 本地访问地址 */
  url: string
}

function def(app: string, label: string, script: string, port: number, base: string): WbscfServiceDef {
  return { app, label, script, pkg: `@wbscf/${app}`, port, base, url: `http://localhost:${port}${base}` }
}

/** wbscf-web 各子应用的 dev 服务注册表（顺序与状态栏导航前 5 项一致） */
export const wbscfServices: WbscfServiceDef[] = [
  def('account', '账号中心', 'dev:account', 5661, '/account/'),
  def('buyer', '买家中心', 'dev:buyer', 5662, '/buyer/'),
  def('seller', '卖家中心', 'dev:seller', 5663, '/seller/'),
  def('ops', '运营管理', 'dev:ops', 5660, '/'),
  def('erp', 'ERP', 'dev:erp', 5668, '/console/'),
]
