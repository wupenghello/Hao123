/**
 * Git 仓库信息模块 · 类型
 *
 * 浏览器侧与 vite-plugin-git.ts（Node 侧）共享的数据契约。
 * 涵盖 wbscf-web 仓库的本地（线下）与远端（线上）全部 git 信息。
 */

/** 工作树中单个文件的状态 */
export interface GitFileStatus {
  /** 文件路径（相对仓库根） */
  path: string
  /** 暂存区状态：空格=未暂存, M=修改, A=新增, D=删除, R=重命名, C=复制 */
  index: string
  /** 工作区状态：同上 + ??=未跟踪, !=忽略 */
  worktree: string
  /** 重命名时的原路径 */
  renamedFrom?: string
}

/** 一次 commit */
export interface GitCommit {
  /** 短 hash（7 位） */
  hash: string
  /** 完整 hash */
  fullHash: string
  /** 作者名 */
  author: string
  /** ISO 8601 日期 */
  date: string
  /** 提交信息首行 */
  message: string
  /** 提交信息正文（首行之后的全部内容） */
  body?: string
}

/** 一条分支 */
export interface GitBranch {
  /** 分支名（本地分支不含 origin/，远端分支含） */
  name: string
  /** 是否当前分支 */
  current: boolean
  /** 最新 commit 短 hash */
  hash: string
  /** 最新 commit 信息首行 */
  message: string
  /** 是否为远端跟踪分支（refs/remotes/） */
  remote: boolean
  /** 本地分支的 upstream 跟踪名（如 origin/develop） */
  upstream?: string
  /** 本地领先远端的 commit 数 */
  ahead: number
  /** 本地落后远端的 commit 数 */
  behind: number
}

/** 一个 tag */
export interface GitTag {
  name: string
  hash: string
  message: string
  date: string
  /** 是否为附注标签（true）vs 轻量标签（false）；缺省视为轻量 */
  annotated?: boolean
  /** 远端是否已存在此标签；缺省视为未知（按未推送处理） */
  onRemote?: boolean
}

/** 一条 stash */
export interface GitStash {
  /** stash@{0} 形式的索引标识 */
  index: string
  /** stash 描述信息 */
  message: string
  /** 创建 stash 时所在的分支名 */
  branch: string
  date: string
}

/** 远端信息 */
export interface GitRemote {
  name: string
  /** fetch URL（脱敏：去除 user:pass@） */
  url: string
  /** push URL（脱敏） */
  pushUrl: string
}

/** 当前分支的同步状态 */
export interface GitSyncStatus {
  /** 本地领先远端的 commit 数（需 push） */
  ahead: number
  /** 本地落后远端的 commit 数（需 pull） */
  behind: number
  /** 是否有 upstream 配置 */
  hasUpstream: boolean
}

/** 工作区变更汇总 */
export interface GitStatusSummary {
  /** 已暂存的文件 */
  staged: GitFileStatus[]
  /** 已修改但未暂存的文件 */
  modified: GitFileStatus[]
  /** 未跟踪的新文件 */
  untracked: GitFileStatus[]
  /** 全部变更文件数 */
  totalChanges: number
  /** 是否工作区干净（无任何变更） */
  clean: boolean
}

/** GET /git/overview 响应：一次拿到全部概览数据 */
export interface GitOverviewResponse {
  /** 是否可用（配置了 VITE_WBSCF_WEB_ROOT 且为有效 git 仓库） */
  enabled: boolean
  /** 仓库根目录（回显，便于排查） */
  root: string
  /** 当前分支名 */
  branch: string
  /** 远端列表 */
  remotes: GitRemote[]
  /** 工作区状态汇总 */
  status: GitStatusSummary
  /** 当前分支的同步状态 */
  sync: GitSyncStatus
  /** 最近 commits（默认 20 条） */
  commits: GitCommit[]
  /** 本地分支列表 */
  branches: GitBranch[]
  /** 远端分支列表 */
  remoteBranches: GitBranch[]
  /** tag 列表 */
  tags: GitTag[]
  /** stash 列表 */
  stashes: GitStash[]
}

/** 可用操作类型（覆盖 git 全生命周期） */
export type GitAction =
  // 远端同步
  | 'fetch'
  | 'pull'
  | 'push'
  // 分支管理
  | 'checkout'
  | 'branch-create'
  | 'branch-delete'
  | 'merge'
  // 暂存 & 提交
  | 'add'
  | 'commit'
  | 'reset'
  | 'discard'
  // 储藏
  | 'stash'
  | 'stash-pop'
  | 'stash-apply'
  | 'stash-drop'
  // 历史操作
  | 'cherry-pick'
  | 'revert'
  // 标签
  | 'tag-create'
  | 'tag-update'
  | 'tag-delete'
  | 'tag-delete-remote'

/** 操作响应 */
export interface GitActionResponse {
  success: boolean
  /** git 命令的 stdout */
  message: string
  /** git 命令的 stderr */
  error?: string
  /** 操作引发冲突（merge / pull / cherry-pick / revert 等留下未解决冲突） */
  conflict?: boolean
}

// ─── 扩展类型（blame / reflog / contributors / config / tree） ────

/** git blame 的一行记录 */
export interface GitBlameLine {
  /** 最近修改此行的 commit hash */
  hash: string
  /** 作者名 */
  author: string
  /** ISO 8601 日期 */
  date: string
  /** 行号（1-indexed） */
  line: number
  /** 该行的代码内容 */
  content: string
}

/** git reflog 的一条记录 */
export interface GitReflogEntry {
  /** 短 hash */
  hash: string
  /** 操作描述（如 "checkout: moving from develop to feature/x"） */
  action: string
  /** ISO 8601 日期 */
  date: string
}

/** 贡献者统计 */
export interface GitContributor {
  name: string
  email: string
  /** 提交总数 */
  commits: number
}

/** git config 的一个键值对 */
export interface GitConfigEntry {
  key: string
  value: string
}
