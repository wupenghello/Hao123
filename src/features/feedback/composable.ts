import {
  alertDialog,
  confirmDialog,
  dismissToast,
  notify,
  resolveDialog,
  updateToast,
  useFeedbackState,
} from './store'
import type { FeedbackDialogInput, FeedbackToastInput } from './types'

export function useFeedback() {
  return {
    ...useFeedbackState(),
    notify,
    updateToast,
    dismissToast,
    resolveDialog,
    alert: alertDialog,
    confirm: confirmDialog,
    info(input: Omit<FeedbackToastInput, 'tone'>) {
      return notify({ ...input, tone: 'info' })
    },
    success(input: Omit<FeedbackToastInput, 'tone'>) {
      return notify({ ...input, tone: 'success' })
    },
    warning(input: Omit<FeedbackToastInput, 'tone'>) {
      return notify({ ...input, tone: 'warning' })
    },
    danger(input: Omit<FeedbackToastInput, 'tone'>) {
      return notify({ ...input, tone: 'danger' })
    },
    confirmDanger(input: Omit<FeedbackDialogInput, 'tone'>) {
      return confirmDialog({ ...input, tone: 'danger' })
    },
  }
}
