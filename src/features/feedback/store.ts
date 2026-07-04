/**
 * 全局反馈层 · 轻量状态服务
 *
 * 这里刻意不用 Pinia：反馈是 UI 运行时状态，不需要持久化，也不属于业务域。
 */
import { computed, ref } from 'vue'
import type {
  FeedbackDialog,
  FeedbackDialogInput,
  FeedbackDialogRequest,
  FeedbackToast,
  FeedbackToastInput,
  FeedbackTone,
} from './types'

const DEFAULT_TOAST_DURATION = 4200
const MAX_TOASTS = 4

let seq = 0
const toasts = ref<FeedbackToast[]>([])
const dialogQueue = ref<FeedbackDialogRequest[]>([])
const activeDialog = computed(() => dialogQueue.value[0]?.dialog ?? null)
const toastTimers = new Map<number, number>()

function nextId(): number {
  seq += 1
  return seq
}

function clearToastTimer(id: number): void {
  const timer = toastTimers.get(id)
  if (!timer) return
  window.clearTimeout(timer)
  toastTimers.delete(id)
}

export function dismissToast(id: number): void {
  clearToastTimer(id)
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

export function notify(input: FeedbackToastInput): number {
  const id = nextId()
  const duration = input.duration ?? DEFAULT_TOAST_DURATION
  const toast: FeedbackToast = {
    id,
    tone: input.tone ?? 'info',
    title: input.title,
    message: input.message,
    duration,
    action: input.action,
  }

  toasts.value = [toast, ...toasts.value].slice(0, MAX_TOASTS)

  if (duration > 0) {
    const timer = window.setTimeout(() => dismissToast(id), duration)
    toastTimers.set(id, timer)
  }

  return id
}

export function updateToast(id: number, input: Partial<FeedbackToastInput>): boolean {
  const current = toasts.value.find((toast) => toast.id === id)
  if (!current) return false

  const duration = input.duration ?? current.duration
  const next: FeedbackToast = {
    ...current,
    tone: input.tone ?? current.tone,
    title: input.title ?? current.title,
    message: input.message ?? current.message,
    action: input.action ?? current.action,
    duration,
  }
  toasts.value = toasts.value.map((toast) => toast.id === id ? next : toast)

  clearToastTimer(id)
  if (duration > 0) {
    const timer = window.setTimeout(() => dismissToast(id), duration)
    toastTimers.set(id, timer)
  }

  return true
}

function createDialog(input: FeedbackDialogInput, mode: FeedbackDialog['mode']): FeedbackDialog {
  const tone: FeedbackTone = input.tone ?? (mode === 'confirm' ? 'warning' : 'info')
  return {
    id: nextId(),
    mode,
    tone,
    title: input.title,
    message: input.message,
    detail: input.detail,
    confirmLabel: input.confirmLabel ?? (mode === 'confirm' ? '确认' : '知道了'),
    cancelLabel: input.cancelLabel ?? '取消',
  }
}

function enqueueDialog(input: FeedbackDialogInput, mode: FeedbackDialog['mode']): Promise<boolean> {
  return new Promise((resolve) => {
    dialogQueue.value = [
      ...dialogQueue.value,
      { dialog: createDialog(input, mode), resolve },
    ]
  })
}

export function alertDialog(input: FeedbackDialogInput): Promise<void> {
  return enqueueDialog(input, 'alert').then(() => undefined)
}

export function confirmDialog(input: FeedbackDialogInput): Promise<boolean> {
  return enqueueDialog(input, 'confirm')
}

export function resolveDialog(confirmed: boolean): void {
  const request = dialogQueue.value[0]
  if (!request) return
  dialogQueue.value = dialogQueue.value.slice(1)
  request.resolve(confirmed)
}

export function useFeedbackState() {
  return {
    activeDialog,
    toasts,
  }
}
