/**
 * 本地任务（手动创建的任务）数据类型
 *
 * 与禅道无关：纯前端、localStorage 持久化（任务元数据）+ IndexedDB 持久化（附件二进制），
 * 用户自己新建 / 勾选完成 / 删除，可附带图片与文件。
 * 字段口径尽量与禅道任务对齐（pri 1~4 数字越小越高、deadline 为 yyyy-MM-dd），
 * 以便复用项目里已有的徽标 / 逾期判定心智模型，但本模块不依赖禅道。
 */

/** 优先级：数字越小越高（沿用禅道口径），默认 3 */
export type LocalTaskPri = 1 | 2 | 3 | 4

/** 任务附件的元数据（二进制 Blob 存 IndexedDB，见 attachments.ts） */
export interface TaskAttachment {
  /** 唯一 id，同时是 IndexedDB 里的 key */
  id: string
  /** 原始文件名 */
  name: string
  /** mime 类型，如 image/png、application/pdf */
  type: string
  /** 体积（字节） */
  size: number
  /** 是否图片（图片走缩略图预览，其它走文件图标） */
  isImage: boolean
}

/** 本地任务（一条手动待办） */
export interface LocalTask {
  /** 唯一 id（crypto.randomUUID，带兜底） */
  id: string
  /** 标题（必填，已 trim） */
  title: string
  /** 备注 / 描述（可选） */
  note?: string
  /** 是否已完成 */
  done: boolean
  /** 优先级 1~4，默认 3 */
  pri: LocalTaskPri
  /** 截止日期 yyyy-MM-dd（可选） */
  deadline?: string
  /** 创建时间戳（ms） */
  createdAt: number
  /** 完成时间戳（ms），未完成则无 */
  completedAt?: number
  /** 附件列表（元数据；二进制在 IndexedDB） */
  attachments?: TaskAttachment[]
}

/** 新建 / 编辑表单提交的载荷（无 id、无时间戳，由 store 填充） */
export interface LocalTaskInput {
  title: string
  note?: string
  pri: LocalTaskPri
  deadline?: string
}

/**
 * 新建 / 编辑表单的提交载荷：基础字段 + 待新增文件 + 待移除附件 id。
 * 附件 Blob 的读写（IndexedDB）由 store.addAttachment / removeAttachment 统一处理，
 * 表单组件只负责收集 File 对象，取消时不落盘，避免产生孤立 Blob。
 */
export interface LocalTaskFormPayload extends LocalTaskInput {
  /** 本次新增的文件（尚未写入 IndexedDB） */
  newFiles: File[]
  /** 编辑态下被标记移除的已有附件 id */
  removeAttachmentIds: string[]
}
