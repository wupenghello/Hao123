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
import { computed, ref, watch } from 'vue'
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
  GitBlameLine,
  GitReflogEntry,
} from './types'
import {
  fetchGitOverview,
  fetchGitDiff,
  fetchGitCommitDetail,
  fetchGitTagDetail,
  fetchGitCommits,
  fetchGitBlame,
  fetchGitReflog,
  fetchGitSearchCommits,
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
const actionStatus = ref<'idle' | 'running' | 'success' | 'error' | 'conflict'>('idle')
const lastActionResult = ref<GitActionResponse | null>(null)
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

const gitReady = computed(() => !!overview.value?.enabled && !error.value)
const gitUnavailable = computed(() => !!error.value || overview.value?.enabled === false)

/** 仓库短名（取 root 路径最后一段，兜底 wbscf-web），用于头部标题 */
const repoName = computed(() => {
  const root = overview.value?.root || ''
  const segs = root.split(/[\\/]/).filter(Boolean)
  return segs.length ? segs[segs.length - 1] : 'wbscf-web'
})

let dashTimer: ReturnType<typeof setTimeout> | null = null
let widgetTimer: ReturnType<typeof setTimeout> | null = null
let refreshing = false
// widget 是否挂载（由 startWidgetPolling / stopWidgetPolling 维护），
// 供 visibilitychange 切回前台时判断要不要恢复 widget 轮询
let widgetMounted = false
let visibilityBound = false

function clearLiveData(): void {
  branch.value = ''
  remotes.value = []
  status.value = { staged: [], modified: [], untracked: [], totalChanges: 0, clean: true }
  sync.value = { ahead: 0, behind: 0, hasUpstream: false }
  commits.value = []
  branches.value = []
  remoteBranches.value = []
  tags.value = []
  stashes.value = []
}

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
      overview.value = data
      clearLiveData()
      error.value = 'Git 未连接：请检查 VITE_WBSCF_WEB_ROOT 是否指向有效的 wbscf-web git 仓库，并重启 dev server。'
    }
  } catch (e) {
    overview.value = null
    clearLiveData()
    error.value = `Git 连接失败：${(e as Error)?.message || '拉取 git 状态失败'}`
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
  actionStatus.value = 'running'
  lastActionResult.value = null
  try {
    const result = await triggerGitAction(action, params)
    lastActionResult.value = result
    if (result.conflict) {
      actionStatus.value = 'conflict'
      actionMessage.value = result.error || result.message || `${action} 产生冲突，请手动解决`
    } else if (result.success) {
      actionStatus.value = 'success'
      actionMessage.value = result.message || `${action} 完成`
    } else {
      actionStatus.value = 'error'
      actionMessage.value = result.error || result.message || `${action} 失败`
    }
    // 操作后刷新：tag 类操作是原子 ref 写入、不涉 index，后端返回即已落盘，
    // 立即刷新让用户看到结果（编辑 / 删除 / 创建标签不再有「卡住没反应」错觉）；
    // 其他操作（commit / stage 等）延迟一点等 git index 落盘稳定。
    const delay = action.startsWith('tag-') ? 0 : ACTION_REFRESH_MS
    setTimeout(() => void refresh(), delay)
    return result
  } catch (e) {
    const msg = (e as Error)?.message || `${action} 失败`
    const result: GitActionResponse = { success: false, message: '', error: msg }
    actionStatus.value = 'error'
    actionMessage.value = msg
    lastActionResult.value = result
    return result
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
  const remote = remotes.value[0]?.name || 'origin'
  return doAction('tag-push-missing', { remote })
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

/**
 * 同步远端全部标签到本地（`git fetch --tags --prune-tags`）：
 * 把远端新增的 tag 拉下来、远端已删除的 tag 在本地清理，使列表与线上一致。
 */
async function doFetchTags(): Promise<GitActionResponse> {
  const remote = remotes.value[0]?.name || 'origin'
  return doAction('tag-fetch', { remote })
}

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

async function doUpdateTag(
  oldName: string,
  options: { name: string; message?: string; ref?: string },
): Promise<GitActionResponse> {
  return doAction('tag-update', {
    oldName,
    name: options.name,
    message: options.message || '',
    ref: options.ref || '',
  })
}

async function doDeleteTag(name: string): Promise<GitActionResponse> {
  return doAction('tag-delete', { name })
}

/**
 * 推送单个标签到远端：显式 refs/tags refspec，避免和同名分支歧义。
 * remote 取首个配置的远端（几乎总是 origin），缺失回退 origin。
 */
async function doPushTag(name: string, force = false): Promise<GitActionResponse> {
  const remote = remotes.value[0]?.name || 'origin'
  return doAction('tag-push', { remote, name, force: force ? 'true' : '' })
}

/**
 * 删除远端标签（`git push <remote> --delete <tag>`）。⚠ 影响所有协作者与 CI/CD。
 */
async function doDeleteRemoteTag(name: string): Promise<GitActionResponse> {
  const remote = remotes.value[0]?.name || 'origin'
  return doAction('tag-delete-remote', { name, remote })
}

/**
 * 自上一 tag 以来的提交（用于 tag 详情的「本次发版包含的提交」）。
 * - 有 prevTag：`git log prevTag..tag`（仅本版本新增）
 * - 无 prevTag（最旧的那个）：`git log tag`（该 tag 可达的全部提交）
 */
async function getTagCommits(tag: string, prevTag?: string): Promise<GitCommit[]> {
  const data = prevTag
    ? await fetchGitCommits(prevTag, 80, { ref2: tag })
    : await fetchGitCommits(tag, 80)
  return data.commits
}

async function getTagDetail(name: string): Promise<GitTag | null> {
  const data = await fetchGitTagDetail(name)
  return data.tag as GitTag | null
}

// ─── 回滚 / 合并 / 撤销 / 丢弃 ────────────────────

async function doReset(
  mode: 'soft' | 'mixed' | 'hard' | 'keep',
  target?: string,
): Promise<GitActionResponse> {
  return doAction('reset', { mode, target: target || '' })
}

async function doMerge(
  source: string,
  options?: { noCommit?: boolean; squash?: boolean },
): Promise<GitActionResponse> {
  return doAction('merge', {
    source,
    noCommit: options?.noCommit ? 'true' : '',
    squash: options?.squash ? 'true' : '',
  })
}

async function doRevert(hash: string, options?: { noCommit?: boolean }): Promise<GitActionResponse> {
  return doAction('revert', { hash, noCommit: options?.noCommit ? 'true' : '' })
}

async function doCherryPick(
  hash: string,
  options?: { noCommit?: boolean },
): Promise<GitActionResponse> {
  return doAction('cherry-pick', { hash, noCommit: options?.noCommit ? 'true' : '' })
}

/** 丢弃工作区修改：已跟踪走 git restore，未跟踪走 git clean -f */
async function doDiscard(files: string, untracked = false): Promise<GitActionResponse> {
  return doAction('discard', { files, untracked: untracked ? 'true' : '' })
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

async function getBlame(filePath: string, ref?: string): Promise<GitBlameLine[]> {
  const data = await fetchGitBlame(filePath, ref)
  return data.blame
}

async function getReflog(count = 30): Promise<GitReflogEntry[]> {
  const data = await fetchGitReflog(count)
  return data.reflog
}

async function searchCommits(query: string, count = 20): Promise<GitCommit[]> {
  const data = await fetchGitSearchCommits(query, count)
  return data.commits
}

/** 指定 ref（分支 / tag / hash / origin/xxx）的 commit 日志，用于 Pull 前预览 behind 提交等 */
async function getBranchLog(ref: string, count = 20): Promise<GitCommit[]> {
  const data = await fetchGitCommits(ref, count)
  return data.commits
}

// ─── 导出 ───────────────────────────────────────────

export function useGitDashboard() {
  return {
    // 状态
    overview,
    loading,
    actionLoading,
    actionMessage,
    actionStatus,
    lastActionResult,
    error,
    open,
    // 派生
    gitReady,
    gitUnavailable,
    repoName,
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
    doFetchTags,
    doUpdateTag,
    doDeleteTag,
    doDeleteRemoteTag,
    doPushTag,
    doReset,
    doMerge,
    doRevert,
    doCherryPick,
    doDiscard,
    doStashPush,
    doStashPop,
    doStashApply,
    doStashDrop,
    // 查询
    getDiff,
    getCommitDetail,
    getBlame,
    getReflog,
    searchCommits,
    getBranchLog,
    getTagCommits,
    getTagDetail,
  }
}
