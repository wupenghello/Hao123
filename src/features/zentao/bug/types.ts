/**
 * 禅道 Bug 数据类型
 *
 * 字段以禅道 12.5.x 的 bug 表为准，只声明列表与详情展示用得到的常用字段。
 * 通用外壳/会话/分页类型见 ../shared/types.ts。
 */

/** 禅道 Bug（my-bug 列表项 + bug-view 详情） */
export interface ZentaoBug {
  id: string
  /** Bug 标题 */
  title: string
  /** 所属产品 */
  product?: string
  productName?: string
  /** 所属项目 */
  project?: string
  /** 严重程度 1~4（数字越小越严重） */
  severity: string | number
  /** 优先级 1~4 */
  pri: string | number
  /**
   * 状态：active（激活）/ resolved（已解决）/ closed（已关闭）
   */
  status: string
  /** Bug 类型：codeerror/interface/config/install… */
  type?: string
  /** 解决方案：bydesign/duplicate/external/fixed/notrepro/postponed/willnotfix… */
  resolution?: string
  /** 指派给（账号） */
  assignedTo?: string
  /** 创建者 / 创建时间 */
  openedBy?: string
  openedDate?: string
  /** 截止日期 */
  deadline?: string

  // —— 详情（bug-view）补充字段 ——
  /** 重现步骤（含[步骤]/[结果]/[期望]，HTML） */
  steps?: string
  /** 关键词 */
  keywords?: string
  /** 操作系统 / 浏览器 环境 */
  os?: string
  browser?: string
  /** 解决人 / 解决时间 */
  resolvedBy?: string
  resolvedDate?: string
  /** 解决版本 */
  resolvedBuild?: string
  /** 是否已确认（'1' 已确认） */
  confirmed?: string | number
  /** 发现版本（openedBuild） */
  openedBuild?: string
  /** 关闭人 / 关闭时间 */
  closedBy?: string
  closedDate?: string
  /** 最后修改人 / 时间 */
  lastEditedBy?: string
  lastEditedDate?: string
  /** 所属项目名 / 关联需求标题 */
  projectName?: string
  storyTitle?: string
}

/**
 * my-bug 入口解析后的数据体。
 * 禅道分页接口通常返回 { bugs: {...}, pager: {...} }，
 * 其中列表可能是「以 id 为 key 的对象」而非数组，api.ts 统一归一化为数组。
 */
export interface MyBugData {
  bugs?: Record<string, ZentaoBug> | ZentaoBug[]
  pager?: import('../shared/types').ZentaoPager
}

/** bug-view 解析后的数据体（顶层含 bug 子对象） */
export interface BugDetailData {
  bug: ZentaoBug
  productName?: string
  /** 顶层产品对象 */
  product?: { name?: string } | Record<string, unknown>
}
