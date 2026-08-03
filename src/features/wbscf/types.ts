/**
 * wbscf-web 本地 dev 服务 · 类型
 *
 * 浏览器侧只消费状态（available / running / booting），真正的进程拉起与端口探测
 * 由根目录 vite-plugin-wbscf.ts 在 dev server（Node）做。这里的类型是前后端共享的契约。
 */

/** 单个 wbscf-web 子应用的本地 dev 服务状态 */
export interface WbscfServiceStatus {
  /** 应用 key：account / buyer / seller / ops / erp */
  app: string
  /** 展示名（对齐状态栏导航项：账号中心 / 买家中心 / 卖家中心 / 运营管理 / ERP） */
  label: string
  /** package.json scripts 中的脚本名，如 dev:account */
  script: string
  /** 本地访问地址，如 http://localhost:5661/account/ */
  url: string
  /** dev 端口（探测就绪用） */
  port: number
  /** 该脚本是否存在于 wbscf-web/package.json（决定是否展示 localhost 入口） */
  available: boolean
  /** 端口已就绪、可访问 */
  running: boolean
  /** 已由本插件拉起但端口尚未就绪（启动中） */
  booting: boolean
  /** 进程是否由本 dev server 拉起（仅此部分可经 /wbscf/stop 停止；外部启动的只能打开） */
  ours: boolean
}

/** GET /wbscf/services 响应 */
export interface WbscfServicesResponse {
  /** 是否已配置有效的 wbscf-web 根目录（dev server 侧判定） */
  enabled: boolean
  /** wbscf-web 根目录（回显，便于排查配置） */
  root: string
  /** 各子应用的服务状态 */
  services: WbscfServiceStatus[]
}

/** GET /wbscf/stop 响应：停止结果 + 最新全量状态（services 可直接用于前端刷新） */
export interface WbscfStopResponse extends WbscfServicesResponse {
  /** 是否真正停掉了（本工作台拉起的杀进程树；外部启动的按端口杀占用进程） */
  stopped: boolean
  /** 停掉的对象是否为外部启动的服务（按端口定位并结束） */
  external?: boolean
  /** stopped=false 的原因：external = 外部启动且定位占用进程失败（请手动停）/ not_running = 本来就没在运行 */
  reason?: 'external' | 'not_running'
}
