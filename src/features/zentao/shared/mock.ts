/**
 * 禅道演示假数据（VITE_ZENTAO_MOCK=true 时启用）
 *
 * 没有真实「指派给我」数据时，用这套假数据预览首页待办提醒 + 详情弹窗的完整效果。
 * 注入点在 session.ts（短路登录）与 task/bug 的 api.ts（短路请求），
 * 故列表、计数、详情、LLM 建议全部走真实链路，只是数据源换成本地常量。
 *
 * 关掉开关（删除或置 false）即恢复连真实禅道，无需改其它代码。
 */
import type { ZentaoTask } from '../task/types'
import type { ZentaoBug } from '../bug/types'

/** 演示开关：.env 里 VITE_ZENTAO_MOCK=true 开启 */
export const ZENTAO_MOCK = String(import.meta.env.VITE_ZENTAO_MOCK).toLowerCase() === 'true'

/** 把 Date 格式化为本地 yyyy-MM-dd（避免 toISOString 的 UTC 偏移导致日期错位一天） */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 基于今天偏移天数，生成 yyyy-MM-dd（让截止日期看起来贴近当下） */
function dayFromNow(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return toLocalDateStr(d)
}
/** 基于今天偏移天数，生成 yyyy-MM-dd HH:mm:ss */
function dateTimeFromNow(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${toLocalDateStr(d)} 09:30:00`
}

// ============ 假任务（指派给我的开发任务）============
const MOCK_TASKS: ZentaoTask[] = [
  {
    id: '1042',
    name: '首页改版：落地页 Hero 区响应式适配',
    type: 'fe',
    status: 'doing',
    pri: 1,
    projectName: '官网 2.0 重构',
    deadline: dayFromNow(1),
    assignedTo: 'wupeng',
    assignedToRealName: '吴鹏',
    estimate: 8,
    consumed: 5,
    left: 3,
    progress: 62,
    openedBy: '产品-林悦',
    openedDate: dateTimeFromNow(-3),
    realStarted: dateTimeFromNow(-2),
    lastEditedBy: '吴鹏',
    lastEditedDate: dateTimeFromNow(0),
    storyTitle: '落地页在移动端需自适应折叠',
    desc: '<p>Hero 区在 <strong>≤768px</strong> 下出现横向滚动条，需重写为弹性布局：</p><ul><li>主视觉图改用 <code>object-fit: cover</code> + 容器宽高比锁定；</li><li>标题/按钮在窄屏下纵向堆叠，间距走设计稿 token；</li><li>验证 iOS Safari 与微信内置浏览器。</li></ul>',
  },
  {
    id: '1038',
    name: '登录页表单校验逻辑重构（抽离 useFormValidate）',
    type: 'fe',
    status: 'wait',
    pri: 2,
    projectName: '官网 2.0 重构',
    deadline: dayFromNow(4),
    assignedTo: 'wupeng',
    assignedToRealName: '吴鹏',
    estimate: 6,
    consumed: 0,
    left: 6,
    progress: 0,
    openedBy: '前端-赵越',
    openedDate: dateTimeFromNow(-1),
    lastEditedBy: '前端-赵越',
    lastEditedDate: dateTimeFromNow(-1),
    desc: '<p>当前登录页校验散落在模板里，难以复用。需抽成 <code>useFormValidate</code> 组合式函数：</p><ol><li>支持必填 / 正则 / 异步校验三类规则；</li><li>错误信息与字段解耦，可被多个表单复用；</li><li>补充单元测试覆盖边界。</li></ol>',
  },
  {
    id: '1025',
    name: '封装通用 Toast 组件并接入全局错误提示',
    type: 'fe',
    status: 'doing',
    pri: 3,
    projectName: '基础组件库',
    deadline: dayFromNow(7),
    assignedTo: 'wupeng',
    assignedToRealName: '吴鹏',
    estimate: 4,
    consumed: 1.5,
    left: 2.5,
    progress: 30,
    openedBy: '吴鹏',
    openedDate: dateTimeFromNow(-5),
    realStarted: dateTimeFromNow(-1),
    lastEditedBy: '吴鹏',
    lastEditedDate: dateTimeFromNow(0),
    desc: '<p>实现一个支持 success / error / info 三态、可堆叠、自动消失的 Toast，并在 axios 拦截器里接入统一错误提示。</p>',
  },
]

// ============ 假 Bug（测试指派给我的缺陷）============
const MOCK_BUGS: ZentaoBug[] = [
  {
    id: '2087',
    title: '移动端 Safari 下拉菜单点击无响应',
    type: 'codeerror',
    status: 'active',
    severity: 1,
    pri: 1,
    productName: '官网 2.0',
    assignedTo: 'wupeng',
    openedBy: '测试-孙琪',
    openedDate: dateTimeFromNow(-1),
    os: 'iOS 17',
    browser: 'Safari',
    openedBuild: 'trunk',
    confirmed: 1,
    lastEditedBy: '测试-孙琪',
    lastEditedDate: dateTimeFromNow(0),
    steps: '<p>[步骤]</p><ol><li>iPhone Safari 打开官网首页；</li><li>点击右上角「产品」下拉菜单。</li></ol><p>[结果] 菜单无任何反应，点击穿透到下层元素。</p><p>[期望] 正常展开二级菜单。</p>',
  },
  {
    id: '2079',
    title: '表单提交失败后 loading 状态未关闭，按钮一直转圈',
    type: 'codeerror',
    status: 'active',
    severity: 2,
    pri: 2,
    productName: '官网 2.0',
    assignedTo: 'wupeng',
    openedBy: '测试-孙琪',
    openedDate: dateTimeFromNow(-2),
    os: 'Windows 11',
    browser: 'Chrome 120',
    openedBuild: 'trunk',
    confirmed: 1,
    lastEditedBy: '测试-孙琪',
    lastEditedDate: dateTimeFromNow(-1),
    steps: '<p>[步骤]</p><ol><li>联系表单填写后断网；</li><li>点击提交。</li></ol><p>[结果] 接口报错后按钮 loading 不消失，无法再次提交。</p><p>[期望] 失败后复位 loading 并提示错误。</p>',
  },
  {
    id: '2065',
    title: '深色模式下次要按钮文字对比度不足（无障碍）',
    type: 'interface',
    status: 'active',
    severity: 3,
    pri: 3,
    productName: '基础组件库',
    assignedTo: 'wupeng',
    openedBy: '测试-李航',
    openedDate: dateTimeFromNow(-4),
    os: 'macOS 14',
    browser: 'Chrome 120',
    openedBuild: '1.4.0',
    confirmed: 0,
    lastEditedBy: '测试-李航',
    lastEditedDate: dateTimeFromNow(-3),
    steps: '<p>[步骤] 切换到深色模式，查看 secondary 按钮。</p><p>[结果] 文字与背景对比度约 2.8:1，低于 WCAG AA 的 4.5:1。</p><p>[期望] 调整 token 至达标对比度。</p>',
  },
]

const taskById = new Map(MOCK_TASKS.map((t) => [String(t.id), t]))
const bugById = new Map(MOCK_BUGS.map((b) => [String(b.id), b]))

/**
 * 假「我的任务」列表。
 * 演示数据对所有维度（finishedBy/assignedTo/openedBy）都返回同一批，
 * 避免「首页待办（assignedTo）有数据、但对话默认查 finishedBy 返回空」的不一致，
 * 让演示在任意维度下都有一致可见的数据。
 */
export function mockMyTasks(_type: string): ZentaoTask[] {
  return MOCK_TASKS
}
/** 假任务详情 */
export function mockTaskDetail(id: string | number): ZentaoTask | undefined {
  return taskById.get(String(id))
}
/** 假「我的 Bug」列表（同上，各维度都返回同一批） */
export function mockMyBugs(_type: string): ZentaoBug[] {
  return MOCK_BUGS
}
/** 假 Bug 详情 */
export function mockBugDetail(id: string | number): ZentaoBug | undefined {
  return bugById.get(String(id))
}
