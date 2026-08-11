/**
 * Chat 助手 · 审批队列模块
 *
 * 把「高风险工具需要用户确认」从状态 hack（hasOtherPending / brokeForPending / 索引比对）
 * 升为独立产品模块：
 *  - 引擎在执行工具前 `await requestApproval(...)`，Promise 悬置直到用户在 UI 批准/拒绝；
 *  - 并发审批天然串行——多个 pending 各持一个悬置 Promise，`Promise.all` 等到全部决策，
 *    无需「等最后一个才续跑」的索引扫描；
 *  - UI（NotificationBar / TurnProcess / ChatLauncher 标记）通过 pendingApprovals 观测队列。
 */
import { computed, ref } from 'vue'
import type { ToolStep } from './turns'

/** 高风险工具调用的产品级审批信息 */
export interface ToolApproval {
  /** 人类可读动作标题 */
  title: string
  /** 动作影响说明 */
  description: string
  /** 风险提示 */
  risk: string
  /** 待执行参数（只用于 UI 预览，不发给模型）；引擎在挂载到 step 时写入 */
  args?: Record<string, unknown>
  /** 用户是否已经处理该审批 */
  decision?: 'approved' | 'rejected'
  /** 处理时间戳 */
  decidedAt?: number
}

/** 一条待审批项（挂在哪一个 turn 的哪一步） */
export interface PendingItem {
  turnId: string
  stepIndex: number
  step: ToolStep
}

const pending = ref<PendingItem[]>([])
/** stepKey → 引擎侧 Promise 的 resolve（批准/拒绝即 resolve 它，引擎继续执行） */
const resolvers = new Map<string, (d: 'approved' | 'rejected') => void>()
const key = (turnId: string, stepIndex: number) => `${turnId}:${stepIndex}`

/** 模块级单例（store / 引擎 / UI 共享同一份队列） */
export function useApprovalQueue() {
  /** 引擎在工具执行前调用；Promise 悬置直到用户在 UI 批准/拒绝 */
  function requestApproval(
    turnId: string,
    stepIndex: number,
    step: ToolStep,
  ): Promise<'approved' | 'rejected'> {
    step.status = 'pending'
    pending.value = [...pending.value, { turnId, stepIndex, step }]
    return new Promise((resolve) => {
      resolvers.set(key(turnId, stepIndex), resolve)
    })
  }

  function settle(turnId: string, stepIndex: number, d: 'approved' | 'rejected') {
    const k = key(turnId, stepIndex)
    resolvers.get(k)?.(d)
    resolvers.delete(k)
    pending.value = pending.value.filter((p) => !(p.turnId === turnId && p.stepIndex === stepIndex))
  }

  /** 用户批准 → 引擎收到 'approved'，继续执行该工具 */
  function approve(turnId: string, stepIndex: number) {
    settle(turnId, stepIndex, 'approved')
  }
  /** 用户拒绝 → 引擎收到 'rejected'，注入 approvalRejected 结果并继续 */
  function reject(turnId: string, stepIndex: number) {
    settle(turnId, stepIndex, 'rejected')
  }
  /** 全部批准（NotificationBar 一键用） */
  function approveAll() {
    for (const p of [...pending.value]) approve(p.turnId, p.stepIndex)
  }
  /** 中止 / 切换会话时清理未决审批（未决 Promise 一律按 rejected 结算，避免悬挂） */
  function clearForTurn(turnId: string) {
    pending.value = pending.value.filter((p) => p.turnId !== turnId)
    for (const [k, r] of [...resolvers.entries()]) {
      if (k.startsWith(turnId + ':')) {
        r('rejected')
        resolvers.delete(k)
      }
    }
  }

  return {
    /** 全局待确认审批队列（UI 据此渲染常驻聚合条 / 入口标记） */
    pendingApprovals: computed(() => pending.value),
    requestApproval,
    approve,
    reject,
    approveAll,
    clearForTurn,
  }
}
