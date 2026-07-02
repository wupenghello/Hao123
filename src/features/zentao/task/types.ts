/**
 * 禅道任务（ZenTao Task）数据类型
 *
 * 字段以禅道 12.5.x 的 task 表为准，只声明列表与详情展示用得到的常用字段。
 * 通用外壳/会话/分页类型见 ../shared/types.ts。
 */

/** 禅道任务（my-task 列表项 + task-view 详情） */
export interface ZentaoTask {
  id: string
  /** 任务名称 */
  name: string
  /** 所属项目 ID / 名称（不同入口可能只给其一） */
  project?: string
  projectName?: string
  /** 所属执行/迭代 */
  execution?: string
  executionName?: string
  /** 任务类型：design/devel/test/study/discuss/ui/affair/misc… */
  type?: string
  /**
   * 状态：wait（未开始）/ doing（进行中）/ done（已完成）/
   *      pause（已暂停）/ cancel（已取消）/ closed（已关闭）
   */
  status: string
  /** 优先级 1~4（数字越小越高） */
  pri: string | number
  /** 预计 / 已消耗 / 剩余 工时 */
  estimate?: string | number
  consumed?: string | number
  left?: string | number
  /** 指派给（账号） */
  assignedTo?: string
  /** 截止日期 yyyy-mm-dd（0000-00-00 视为无） */
  deadline?: string
  /** 创建者（账号） */
  openedBy?: string
  /** 创建/指派时间 */
  openedDate?: string
  assignedDate?: string

  // —— 详情（task-view）补充字段，列表接口可能不返回 ——
  /** 任务描述（HTML） */
  desc?: string
  /** 工时进度百分比 */
  progress?: string | number
  /** 完成人 / 完成时间 */
  finishedBy?: string
  finishedDate?: string
  /** 实际开始时间 */
  realStarted?: string
  /** 指派对象真实姓名 */
  assignedToRealName?: string
  /** 关联需求标题 */
  storyTitle?: string
  /** 关联需求规格说明（HTML，常比 desc 更有内容） */
  storySpec?: string
  /** 关联需求验收标准（HTML） */
  storyVerify?: string
  /** 关闭原因：done/cancel/bydesign… */
  closedReason?: string
  /** 关闭人 / 关闭时间 */
  closedBy?: string
  closedDate?: string
  /** 最后修改人 / 时间 */
  lastEditedBy?: string
  lastEditedDate?: string
  /** 关联需求版本 */
  storyVersion?: string | number
  /** 子任务（父任务才有；可能是数组或以 id 为 key 的对象） */
  children?: Record<string, ZentaoTask> | ZentaoTask[]
}

/**
 * my-task 入口解析后的数据体。
 * 禅道分页接口通常返回 { tasks: {...}, pager: {...} }，
 * 其中列表可能是「以 id 为 key 的对象」而非数组，api.ts 统一归一化为数组。
 */
export interface MyTaskData {
  tasks?: Record<string, ZentaoTask> | ZentaoTask[]
  /** 部分禅道版本的 my-task 列表字段名 */
  taskStats?: Record<string, ZentaoTask> | ZentaoTask[]
  /** 兼容少数二次封装后的任务列表字段名 */
  taskList?: Record<string, ZentaoTask> | ZentaoTask[]
  pager?: import('../shared/types').ZentaoPager
}

/** task-view 解析后的数据体（顶层含 task 子对象及若干关联信息） */
export interface TaskDetailData {
  task: ZentaoTask
  /** 顶层项目对象，含真实项目名（task.projectName 常缺失，需从这里取） */
  project?: { id?: string; name?: string }
  /** 顶层产品对象或映射 */
  product?: { name?: string } | Record<string, unknown> | string
}
