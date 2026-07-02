/**
 * Git 仓库信息模块 · 浏览器侧 HTTP 客户端
 *
 * 浏览器无法直接执行 git 命令，故由 vite-plugin-git.ts 在 dev server（Node）暴露
 * /git/* 中间件：执行 git 命令并返回 JSON。这里封装浏览器侧的全部 fetch 调用。
 *
 * 只保留前端真正在用的端点（dashboard 走 overview 拿全量；LLM 工具按需调下列
 * 单项查询；操作统一走 /git/action）：
 *   - overview        概览（分支 / 状态 / commits / remotes / tags / stashes）
 *   - commits         指定分支 commit 日志
 *   - diff            文件 diff
 *   - commit-detail   单个 commit 的 diff
 *   - tag-detail      单个 tag 的完整附注说明
 *   - blame / reflog / contributors / config / search
 *   - action          执行操作
 *
 * 生产构建无 dev server，端点 404 → 调用方 catch 后降级为「不展示 git 入口」。
 */
import type {
  GitOverviewResponse,
  GitCommit,
  GitActionResponse,
  GitBlameLine,
  GitReflogEntry,
  GitContributor,
  GitConfigEntry,
  GitTagDetail,
} from './types'

const BASE = '/git'

async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.clone().json()) as { error?: string; message?: string }
    return data.error || data.message || fallback
  } catch {
    return fallback
  }
}

/** 拉取仓库全貌概览（分支 / 状态 / commits / remotes / tags / stashes） */
export async function fetchGitOverview(): Promise<GitOverviewResponse> {
  const res = await fetch(`${BASE}/overview`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(await responseError(res, `/git/overview -> ${res.status}`))
  return (await res.json()) as GitOverviewResponse
}

/**
 * 拉取 commit 日志。
 * - 仅 branch：`git log <branch>`
 * - branch + ref2：`git log <branch>..<ref2>`（用于「自上一 tag 以来的提交」等区间查询）
 */
export async function fetchGitCommits(
  branch?: string,
  count = 20,
  options?: { ref2?: string },
): Promise<{ enabled: boolean; commits: GitCommit[] }> {
  const params = new URLSearchParams()
  if (branch) params.set('branch', branch)
  if (options?.ref2) params.set('ref2', options.ref2)
  params.set('count', String(count))
  const res = await fetch(`${BASE}/commits?${params}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`/git/commits -> ${res.status}`)
  return (await res.json()) as { enabled: boolean; commits: GitCommit[] }
}

/** 拉取文件的 git diff */
export async function fetchGitDiff(
  filePath: string,
  options?: { cached?: boolean; ref1?: string; ref2?: string },
): Promise<{ enabled: boolean; diff: string }> {
  const params = new URLSearchParams({ path: filePath })
  if (options?.cached) params.set('cached', '1')
  if (options?.ref1) params.set('ref1', options.ref1)
  if (options?.ref2) params.set('ref2', options.ref2)
  const res = await fetch(`${BASE}/diff?${params}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`/git/diff -> ${res.status}`)
  return (await res.json()) as { enabled: boolean; diff: string }
}

/** 拉取单个 commit 的详情（diff） */
export async function fetchGitCommitDetail(
  hash: string,
): Promise<{ enabled: boolean; diff: string }> {
  const params = new URLSearchParams({ hash })
  const res = await fetch(`${BASE}/commit-detail?${params}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`/git/commit-detail -> ${res.status}`)
  return (await res.json()) as { enabled: boolean; diff: string }
}

/** 拉取 tag 详情（完整附注说明，避免编辑时只拿 subject 第一行） */
export async function fetchGitTagDetail(
  name: string,
): Promise<{ enabled: boolean; tag: GitTagDetail | null }> {
  const params = new URLSearchParams({ name })
  const res = await fetch(`${BASE}/tag-detail?${params}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`/git/tag-detail -> ${res.status}`)
  return (await res.json()) as { enabled: boolean; tag: GitTagDetail | null }
}

/** 拉取文件的 git blame（逐行追溯） */
export async function fetchGitBlame(
  filePath: string,
  ref?: string,
): Promise<{ enabled: boolean; blame: GitBlameLine[] }> {
  const params = new URLSearchParams({ path: filePath })
  if (ref) params.set('ref', ref)
  const res = await fetch(`${BASE}/blame?${params}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`/git/blame -> ${res.status}`)
  return (await res.json()) as { enabled: boolean; blame: GitBlameLine[] }
}

/** 拉取 reflog（操作历史，含 checkout / merge / reset 等） */
export async function fetchGitReflog(
  count = 30,
): Promise<{ enabled: boolean; reflog: GitReflogEntry[] }> {
  const params = new URLSearchParams({ count: String(count) })
  const res = await fetch(`${BASE}/reflog?${params}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`/git/reflog -> ${res.status}`)
  return (await res.json()) as { enabled: boolean; reflog: GitReflogEntry[] }
}

/** 拉取贡献者统计（按提交数降序） */
export async function fetchGitContributors(): Promise<{
  enabled: boolean
  contributors: GitContributor[]
}> {
  const res = await fetch(`${BASE}/contributors`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`/git/contributors -> ${res.status}`)
  return (await res.json()) as { enabled: boolean; contributors: GitContributor[] }
}

/** 拉取仓库本地 git config */
export async function fetchGitConfig(): Promise<{
  enabled: boolean
  config: GitConfigEntry[]
}> {
  const res = await fetch(`${BASE}/config`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`/git/config -> ${res.status}`)
  return (await res.json()) as { enabled: boolean; config: GitConfigEntry[] }
}

/** 按关键词搜索 commit 信息（--grep，不区分大小写） */
export async function fetchGitSearchCommits(
  query: string,
  count = 20,
): Promise<{ enabled: boolean; commits: GitCommit[] }> {
  const params = new URLSearchParams({ q: query, count: String(count) })
  const res = await fetch(`${BASE}/search?${params}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`/git/search -> ${res.status}`)
  return (await res.json()) as { enabled: boolean; commits: GitCommit[] }
}

/** 执行 git 操作（fetch / pull / push / checkout / add / commit / branch-* / merge / stash / cherry-pick / revert / tag-* / reset） */
export async function triggerGitAction(
  action: string,
  params?: Record<string, string>,
): Promise<GitActionResponse> {
  const res = await fetch(`${BASE}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ action, params }),
  })
  if (!res.ok) throw new Error(await responseError(res, `/git/action -> ${res.status}`))
  return (await res.json()) as GitActionResponse
}
