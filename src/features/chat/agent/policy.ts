/**
 * Chat 助手 · agent 审批策略
 *
 * 高风险工具（git 写操作 / local 增删改 / wbscf 启动 / claude 启动）在真正执行前
 * 需要用户在 UI 确认。本模块把「哪个工具要审批 + 审批文案」从 store 抽成纯函数，
 * 引擎在执行前查询。写操作失败时禅道外层仍 status:success（见 zentao http），
 * 审批只覆盖写操作类工具，读操作零审批。
 */
import { useLocalTaskStore } from '@/features/local-tasks/store'
import type { ToolApproval } from '../approval'

/** 需要审批的工具 → 人类可读动作标题 */
const APPROVAL_TOOL_LABELS: Record<string, string> = {
  git__checkout: '切换 Git 分支',
  git__fetch: 'Fetch 远端',
  git__pull: 'Pull 远端',
  git__push: 'Push 到远端',
  git__add: '暂存 Git 文件',
  git__commit: '创建 Git 提交',
  git__branch: '管理 Git 分支',
  local__create: '新建本地待办',
  local__update: '修改本地待办',
  local__complete: '变更本地待办完成状态',
  local__delete: '删除本地待办',
  wbscf__launch: '启动本地 dev 服务',
  claude__launch: '启动 Claude Code',
}

function localTaskTarget(args: Record<string, unknown>): string {
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (title) return `「${title}」`
  const id = typeof args.id === 'string' ? args.id : ''
  if (id) {
    try {
      const task = useLocalTaskStore().tasks.find((t) => t.id === id)
      if (task?.title) return `「${task.title}」`
    } catch {
      // 审批文案不应影响工具流转；拿不到 store 时回退到 id。
    }
    return `#${id}`
  }
  return '指定待办'
}

/**
 * 查询某工具是否需要审批。
 * @returns 审批策略（含文案），null = 无需审批直接执行
 */
export function approvalPolicy(wireName: string, args: Record<string, unknown>): ToolApproval | null {
  const label = APPROVAL_TOOL_LABELS[wireName]
  if (!label) return null

  if (wireName.startsWith('git__')) {
    return {
      title: label,
      description: '这会改变 wbscf-web 仓库状态或远端同步状态。',
      risk: '执行前请确认当前分支、未提交改动、远端方向和提交内容都符合预期。',
    }
  }
  if (wireName === 'local__delete') {
    const target = localTaskTarget(args)
    return {
      title: label,
      description: `将删除本地待办 ${target}，并清理其附件。`,
      risk: '删除不可恢复，请确认这不是误删。',
    }
  }
  if (wireName === 'local__create') {
    return {
      title: label,
      description: `将新建本地待办 ${localTaskTarget(args)}。`,
      risk: '确认后会立即写入本地清单。',
    }
  }
  if (wireName === 'local__update') {
    return {
      title: label,
      description: `将修改本地待办 ${localTaskTarget(args)}。`,
      risk: '确认后会立即更新本地清单。',
    }
  }
  if (wireName === 'local__complete') {
    const done = typeof args.done === 'boolean' ? args.done : null
    const verb = done === true ? '标记为完成' : done === false ? '改回未完成' : '切换完成状态'
    return {
      title: label,
      description: `将把本地待办 ${localTaskTarget(args)} ${verb}。`,
      risk: '确认后会立即更新本地清单。',
    }
  }
  if (wireName.startsWith('local__')) {
    return {
      title: label,
      description: '这会写入浏览器本地待办数据。',
      risk: '确认后会立即更新本地清单。',
    }
  }
  if (wireName === 'wbscf__launch') {
    return {
      title: label,
      description: `将启动 ${args.app ? String(args.app) : '指定'} 子应用的本地 dev 服务。`,
      risk: '可能拉起新的本地进程并占用端口；TodayOps 退出时会尝试清理由它拉起的服务。',
    }
  }
  if (wireName === 'claude__launch') {
    return {
      title: label,
      description: '将在 wbscf-web 根目录打开新的终端窗口并启动 Claude Code。',
      risk: '新终端由用户自行管理，TodayOps 不会自动关闭该窗口。',
    }
  }
  return {
    title: label,
    description: '该动作会改变本地或外部状态。',
    risk: '请确认后再执行。',
  }
}
