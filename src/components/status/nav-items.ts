/**
 * 工作台导航数据（共享层）
 *
 * 顶部 StatusNav（窄屏回退）与悬浮 NavRail（宽屏主力）共用同一份导航配置，
 * 避免两处维护漂移。wbscf 本地启动 / 环境下拉的运行期逻辑仍由各组件通过
 * `useWbscfServices` 自行调用——这里只放静态数据 + 纯函数。
 *
 * `icon` 存的是 mdi 图标名后缀（不含 `mdi/` 前缀），由各组件用各自的图标映射渲染。
 */
export type EnvKey = 'dev' | 'test' | 'pre'
export type EnvLinks = Partial<Record<EnvKey, string>>

export interface EnvGroup {
  label?: string
  envs: EnvLinks
}

export interface NavItem {
  label: string
  url?: string
  envs?: EnvLinks
  envGroups?: EnvGroup[]
  /** wbscf app key（存在则渲染本地 dev 启动入口） */
  local?: string
  /** mdi 图标名后缀，用于 NavRail 渲染 */
  icon: string
}

export const envMeta: { key: EnvKey }[] = [
  { key: 'dev' },
  { key: 'test' },
  { key: 'pre' },
]

export interface EnvEntry {
  key: EnvKey
  url: string
}

export const navItems: NavItem[] = [
  {
    label: '账号中心',
    icon: 'account-supervisor-circle-outline',
    local: 'account',
    envs: {
      dev: 'http://i-dev.wbscf.tech/account/#/auth/login',
      test: 'http://i-test.wbscf.tech/account/#/auth/login',
      pre: 'http://i-pre.wbscf.tech/account/#/auth/login',
    },
  },
  {
    label: '买家中心',
    icon: 'cart-outline',
    local: 'buyer',
    envs: {
      dev: 'http://i-dev.wbscf.tech/buyer/#/auth/login',
      test: 'http://i-test.wbscf.tech/buyer/#/auth/login',
      pre: 'http://i-pre.wbscf.tech/buyer/#/auth/login',
    },
  },
  {
    label: '卖家中心',
    icon: 'storefront-outline',
    local: 'seller',
    envs: {
      dev: 'http://i-dev.wbscf.tech/seller/#/auth/login',
      test: 'http://i-test.wbscf.tech/seller/#/auth/login',
      pre: 'http://i-pre.wbscf.tech/seller/#/auth/login',
    },
  },
  {
    label: '运营管理',
    icon: 'view-dashboard-outline',
    local: 'ops',
    envs: {
      dev: 'http://ops-dev.wbscf.tech/#/dashboard',
      test: 'http://ops-test.wbscf.tech/#/dashboard',
      pre: 'http://ops-pre.wbscf.tech/#/dashboard',
    },
  },
  {
    label: 'ERP',
    icon: 'database-outline',
    local: 'erp',
    envGroups: [
      {
        label: '新ERP',
        envs: {
          dev: 'https://erp-dev.wbscf.tech/console/#/auth/login',
          test: 'https://erp-test.wbscf.tech/console/#/auth/login',
          pre: 'https://erp-pre.wbscf.tech/console/#/auth/login',
        },
      },
      {
        label: '老ERP',
        envs: {
          dev: 'http://erp-dev.wbscf.com',
          test: 'http://erp-test.wbscf.com',
        },
      },
    ],
  },
  { label: '水星', icon: 'rocket-launch-outline', url: 'http://admin-dev.wbscf.tech/login' },
  {
    label: 'GitLab Tags',
    icon: 'tag-multiple-outline',
    url: 'http://git.esteel.tech/brcc/wbtech/fe/platform/wbscf-web/-/tags',
  },
  { label: '发布平台', icon: 'truck-fast-outline', url: 'http://cd.esteel.tech/#/page/history' },
  { label: '我的地盘-禅道', icon: 'format-list-bulleted-type', url: 'http://pm.esteel.tech/zentao/my/' },
  { label: 'apifox', icon: 'api', url: 'https://app.apifox.com/project/7718065' },
]

/** 把 NavItem 的环境配置归一为分组数组（envGroups 优先，否则把 envs 包成单组） */
export function envGroupsOf(item: NavItem): EnvGroup[] {
  if (item.envGroups?.length) return item.envGroups
  return item.envs ? [{ envs: item.envs }] : []
}

/** 把一组环境链接展开为有序键值对（跳过缺失的环境） */
export function envEntries(envs: EnvLinks): EnvEntry[] {
  return envMeta
    .map(({ key }) => ({ key, url: envs[key] }))
    .filter((env): env is EnvEntry => !!env.url)
}
