/**
 * Git 仓库信息模块 · 响应式状态（composable，单例模式）
 *
 * 模块级 ref 确保 GitWidget 与 GitDashboard 共享同一份状态，避免重复轮询：
 *   - Widget 挂载即首次拉取，之后低频刷新（WIDGET_POLL_MS，只看分支名 + 变更数）；
 *   - Dashboard 打开时切到高频轮询（DASH_POLL_MS），自动接管并停掉 widget 轮询；
 *   - Dashboard 关闭后回退到 widget 轮询。
 *
 * 页面切到后台统一暂停所有轮询（visibilitychange 模块级常驻），切回前台按当前
 * 状态（dashboard 是否打开 / widget 是否挂载）恢复对应一条。
 *
 * 执行操作（fetch / pull / push / checkout / commit / stash / tag …）后自动刷新；
 * 后端成功操作已让 overview 缓存失效，前端延迟刷新只为等 git index 落盘稳定。
 */
import { ref, watch } from 'vue'
import type {
  GitOverviewResponse,
  GitBranch,
  GitCommit,
  GitTag,
  GitStash,
  GitRemote,
  GitStatusSummary,
  GitSyncStatus,
  GitActionResponse,
} from './types'
import {
  fetchGitOverview,
  fetchGitDiff,
  fetchGitCommitDetail,
  triggerGitAction,
} from './api'

const WIDGET_POLL_MS = 30_000 // widget 低频（状态栏只需要分支名 + 变更数）
const DASH_POLL_MS = 8_000 // dashboard 高频
const ACTION_REFRESH_MS = 2_000

// ─── 模块级单例状态 ─────────────────────────────────
const overview = ref<GitOverviewResponse | null>(null)
const loading = ref(false)
const actionLoading = ref('')
const actionMessage = ref('')
const error = ref<string | null>(null)

const branch = ref('')
const remotes = ref<GitRemote[]>([])
const status = ref<GitStatusSummary>({
  staged: [],
  modified: [],
  untracked: [],
  totalChanges: 0,
  clean: true,
})
const sync = ref<GitSyncStatus>({ ahead: 0, behind: 0, hasUpstream: false })
const commits = ref<GitCommit[]>([])
const branches = ref<GitBranch[]>([])
const remoteBranches = ref<GitBranch[]>([])
const tags = ref<GitTag[]>([])
const stashes = ref<GitStash[]>([])

const open = ref(false)

let dashTimer: ReturnType<typeof setTimeout> | null = null
let widgetTimer: ReturnType<typeof setTimeout> | null = null
let refreshing = false
// widget 是否挂载（由 startWidgetPolling / stopWidgetPolling 维护），
// 供 visibilitychange 切回前台时判断要不要恢复 widget 轮询
let widgetMounted = false
let visibilityBound = false

function applyOverview(data: GitOverviewResponse): void {
  overview.value = data
  branch.value = data.branch
  remotes.value = data.remotes
  status.value = data.status
  sync.value = data.sync
  commits.value = data.commits
  branches.value = data.branches
  remoteBranches.value = data.remoteBranches
  tags.value = data.tags
  stashes.value = data.stashes
  error.value = null
}

async function refresh(): Promise<void> {
  if (refreshing) return
  refreshing = true
  loading.value = true
  try {
    const data = await fetchGitOverview()
    if (data.enabled) {
      applyOverview(data)
    } else {
      error.value = 'wbscf-web 仓库未配置或不是有效的 git 仓库'
    }
  } catch (e) {
    error.value = (e as Error)?.message || '拉取 git 状态失败'
  } finally {
    refreshing = false
    loading.value = false
  }
}

// --- Dashboard 轮询（高频） ---

function clearDashTimer(): void {
  if (dashTimer) {
    clearTimeout(dashTimer)
    dashTimer = null
  }
}

function startDashPolling(): void {
  if (dashTimer) return
  clearWidgetTimer() // dashboard 接管，停掉 widget 轮询
  void refresh()
  const loop = async () => {
    await refresh()
    dashTimer = setTimeout(loop, DASH_POLL_MS)
  }
  dashTimer = setTimeout(loop, DASH_POLL_MS)
}

function stopDashPolling(): void {
  clearDashTimer()
}

// --- Widget 轮询（低频） ---

function clearWidgetTimer(): void {
  if (widgetTimer) {
    clearTimeout(widgetTimer)
    widgetTimer = null
  }
}

/** 挂载即首次拉取，再按低频循环；dashboard 在跑则不重复 */
function startWidgetPolling(): void {
  widgetMounted = true
  bindVisibility()
  if (widgetTimer || dashTimer) return // dashboard 已覆盖
  void refresh()
  const loop = async () => {
    await refresh()
    widgetTimer = setTimeout(loop, WIDGET_POLL_MS)
  }
  widgetTimer = setTimeout(loop, WIDGET_POLL_MS)
}

function stopWidgetPolling(): void {
  widgetMounted = false
  clearWidgetTimer()
}

// --- 切后台暂停（模块级常驻一次） ---

function onVisibility(): void {
  if (document.hidden) {
    // 切后台：暂停所有轮询
    clearDashTimer()
    clearWidgetTimer()
    return
  }
  // 切回前台：按当前状态恢复对应一条轮询
  if (open.value) {
    if (!dashTimer) startDashPolling()
  } else if (widgetMounted) {
    if (!widgetTimer) startWidgetPolling()
  }
}

function bindVisibility(): void {
  if (visibilityBound || typeof document === 'undefined') return
  document.addEventListener('visibilitychange', onVisibility)
  visibilityBound = true
}

// Dashboard 打开/关闭驱动轮询切换
watch(open, (isOpen) => {
  if (isOpen) {
    startDashPolling()
  } else {
    stopDashPolling()
    if (widgetMounted) startWidgetPolling()
  }
})

// --- 操作 ---

async function doAction(
  action: string,
  params?: Record<string, string>,
): Promise<GitActionResponse> {
  actionLoading.value = action
  actionMessage.value = ''
  try {
    const result = await triggerGitAction(action, params)
    if (result.conflict) {
      actionMessage.value = result.error || `${action} 有冲突，请手动解决`
    } else {
      actionMessage.value = result.success
        ? result.message || `${action} 完成`
        : result.error || `${action} 失败`
    }
    // 操作后延迟刷新（让 git 状态稳定）
    setTimeout(() => void refresh(), ACTION_REFRESH_MS)
    return result
  } catch (e) {
    const msg = (e as Error)?.message || `${action} 失败`
    actionMessage.value = msg
    return { success: false, message: '', error: msg }
  } finally {
    actionLoading.value = ''
  }
}

// ─── 远端同步 ───────────────────────────────────────

async function doFetch(): Promise<GitActionResponse> {
  return doAction('fetch')
}

async function doPull(): Promise<GitActionResponse> {
  return doAction('pull')
}

async function doPush(): Promise<GitActionResponse> {
  return doAction('push')
}

async function doPushTags(): Promise<GitActionResponse> {
  return doAction('push', { tags: 'true' })
}

// ─── 分支管理 ───────────────────────────────────────

async function doCheckout(branchName: string): Promise<GitActionResponse> {
  return doAction('checkout', { branch: branchName })
}

async function doCreateBranch(
  name: string,
  base?: string,
): Promise<GitActionResponse> {
  return doAction('branch-create', { name, base: base || '' })
}

async function doDeleteBranch(
  name: string,
  force = false,
): Promise<GitActionResponse> {
  return doAction('branch-delete', { name, force: force ? 'true' : '' })
}

// ─── 暂存 & 提交 ────────────────────────────────────

async function doStageFiles(files: string): Promise<GitActionResponse> {
  return doAction('add', { files })
}

async function doUnstageFiles(files: string): Promise<GitActionResponse> {
  return doAction('reset', { files })
}

async function doCommit(
  message: string,
  options?: { all?: boolean; amend?: boolean },
): Promise<GitActionResponse> {
  return doAction('commit', {
    message,
    all: options?.all ? 'true' : '',
    amend: options?.amend ? 'true' : '',
  })
}

// ─── 储藏 ───────────────────────────────────────────

async function doStashPush(message?: string): Promise<GitActionResponse> {
  return doAction('stash', { message: message || 'auto-stash' })
}

async function doStashPop(): Promise<GitActionResponse> {
  return doAction('stash-pop', {})
}

async function doStashApply(index?: string): Promise<GitActionResponse> {
  return doAction('stash-apply', { index: index || '' })
}

async function doStashDrop(index?: string): Promise<GitActionResponse> {
  return doAction('stash-drop', { index: index || '' })
}

// ─── 标签 ───────────────────────────────────────────

async function doCreateTag(
  name: string,
  options?: { message?: string; ref?: string },
): Promise<GitActionResponse> {
  return doAction('tag-create', {
    name,
    message: options?.message || '',
    ref: options?.ref || '',
  })
}

async function doDeleteTag(name: string): Promise<GitActionResponse> {
  return doAction('tag-delete', { name })
}

// ─── 独立查询（按需加载，不走 overview 轮询） ──────

async function getDiff(
  filePath: string,
  options?: { cached?: boolean; ref1?: string; ref2?: string },
): Promise<string> {
  const data = await fetchGitDiff(filePath, options)
  return data.diff
}

async function getCommitDetail(hash: string): Promise<string> {
  const data = await fetchGitCommitDetail(hash)
  return data.diff
}

// ─── 导出 ───────────────────────────────────────────

export function useGitDashboard() {
  return {
    // 状态
    overview,
    loading,
    actionLoading,
    actionMessage,
    error,
    open,
    // 派生
    branch,
    remotes,
    status,
    sync,
    commits,
    branches,
    remoteBranches,
    tags,
    stashes,
    // 轮询控制
    startWidgetPolling,
    stopWidgetPolling,
    // 操作
    refresh,
    doAction,
    doFetch,
    doPull,
    doPush,
    doPushTags,
    doCheckout,
    doCommit,
    doStageFiles,
    doUnstageFiles,
    doCreateBranch,
    doDeleteBranch,
    doCreateTag,
    doDeleteTag,
    doStashPush,
    doStashPop,
    doStashApply,
    doStashDrop,
    // 查询
    getDiff,
    getCommitDetail,
  }
}
