/**
 * 全局反馈层 · 类型契约
 *
 * 为应用提供统一的 Toast / Alert / Confirm 交互，不再散落浏览器原生
 * alert / confirm。
 */

export type FeedbackTone = 'info' | 'success' | 'warning' | 'danger'

export interface FeedbackToastAction {
  label: string
  run: () => void
}

export interface FeedbackToast {
  id: number
  tone: FeedbackTone
  title: string
  message?: string
  duration: number
  action?: FeedbackToastAction
}

export interface FeedbackToastInput {
  tone?: FeedbackTone
  title: string
  message?: string
  duration?: number
  action?: FeedbackToastAction
}

export interface FeedbackDialogInput {
  tone?: FeedbackTone
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
}

export interface FeedbackDialog extends Required<Omit<FeedbackDialogInput, 'detail'>> {
  id: number
  detail?: string
  mode: 'alert' | 'confirm'
}

export interface FeedbackDialogRequest {
  dialog: FeedbackDialog
  resolve: (confirmed: boolean) => void
}
