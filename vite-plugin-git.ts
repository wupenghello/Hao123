/**
 * wbscf-web · Git 仓库信息 Vite 插件
 *
 * 浏览器无法执行 git 命令，故由本插件在 Vite dev server（Node 侧）承担：
 *   - 在 VITE_WBSCF_WEB_ROOT 指向的 wbscf-web 仓库执行 git 命令
 *   - 暴露 /git/* 中间件，返回 JSON：
 *       GET  /git/overview       全貌概览（分支 / 状态 / commits / remotes / tags / stashes）
 *       GET  /git/commits        指定分支的 commit 日志
 *       GET  /git/diff?path=     文件的 git diff
 *       GET  /git/commit-detail  单个 commit 的 diff
 *       GET  /git/blame          逐行追溯
 *       GET  /git/reflog         操作历史
 *       GET  /git/contributors   贡献者统计
 *       GET  /git/config         本地 git config
 *       GET  /git/search         --grep 搜索 commit
 *       POST /git/action         执行操作（fetch / pull / push / checkout / stash / merge / ...）
 *
 * 全部 git 命令走**异步 spawn**（不阻塞 dev server 事件循环）；
 * overview 带 ~1.5s 短缓存 + in-flight 去重，合并并发轮询；
 * 操作类（doAction）做 ref 合法性校验、冲突检测，成功后让 overview 缓存失效。
 *
 * 仅 dev 生效（configureServer 只在 serve 阶段跑）；生产构建无 dev server，
 * 前端 fetch /git/* 会 404 → composable 降级为不展示 git 入口。
 */
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import type { ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type {
  GitBranch,
  GitCommit,
  GitTag,
  GitStash,
  GitRemote,
  GitFileStatus,
  GitStatusSummary,
  GitSyncStatus,
  GitOverviewResponse,
  GitActionResponse,
  GitBlameLine,
  GitReflogEntry,
  GitContributor,
  GitConfigEntry,
} from './src/features/git/types'

interface GitPluginOptions {
  /** wbscf-web 仓库根目录（VITE_WBSCF_WEB_ROOT） */
  root: string
}

interface GitResult {
  status: number
  stdout: string
  stderr: string
}

/** stdout 软上限：超大输出（如整库 diff）只保留前 20MB，防止撑爆内存 */
const MAX_STDOUT = 20 * 1024 * 1024

/** 在 wbscf-web 仓库目录异步执行 git 命令（不阻塞事件循环） */
function git(cwd: string, args: string[], timeoutMs = 15_000): Promise<GitResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('git', args, { cwd, windowsHide: true })
    } catch (err) {
      resolve({ status: -1, stdout: '', stderr: String(err) })
      return
    }
    let stdout = ''
    let stderr = ''
    const out = child.stdout
    const errStream = child.stderr
    if (out) {
      out.setEncoding('utf-8')
      out.on('data', (d: string) => {
        if (stdout.length < MAX_STDOUT) stdout += d
      })
    }
    if (errStream) {
      errStream.setEncoding('utf-8')
      errStream.on('data', (d: string) => {
        if (stderr.length < MAX_STDOUT) stderr += d
      })
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* noop */
      }
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ status: -1, stdout, stderr: stderr + (stderr ? '\n' : '') + String(err) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ status: code ?? -1, stdout, stderr })
    })
  })
}

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

/** 脱敏：去除 URL 中的 user:pass@ 部分 */
function sanitizeUrl(url: string): string {
  return url.replace(/\/\/[^@]+@/, '//')
}

function isGitRepo(root: string): boolean {
  return !!root && fs.existsSync(path.join(root, '.git'))
}

/**
 * 校验 ref 名（分支 / tag / commit / merge 源等），拒绝会被 git 当作选项
 * 或路径穿越的输入。spawn 用数组传参本就无 shell 注入，这里堵的是 git 自身
 * 的「选项注入」——例如 ref 以 `-` 开头会被当成 flag。
 */
function assertSafeRef(ref: string, label = 'ref'): void {
  if (!ref || ref.startsWith('-')) {
    throw new Error(`非法${label}：${ref || '(空)'}`)
  }
  if (ref.includes('..') || ref.includes('\\') || /[\s~^:?*\[\]]/.test(ref)) {
    throw new Error(`非法${label}：${ref}`)
  }
}

/** 校验 commit hash（仅允许十六进制，4~40 位） */
function assertSafeHash(hash: string): void {
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
    throw new Error(`非法 commit hash：${hash || '(空)'}`)
  }
}

// ─── 数据获取（全部异步，互不阻塞 dev server） ──────

async function getCurrentBranch(cwd: string): Promise<string> {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return r.status === 0 ? r.stdout.trim() : ''
}

async function getRemotes(cwd: string): Promise<GitRemote[]> {
  const r = await git(cwd, ['remote', '-v'])
  if (r.status !== 0) return []
  const map = new Map<string, GitRemote>()
  for (const line of r.stdout.trim().split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/)
    if (!m) continue
    const [, name, url, type] = m
    if (!map.has(name)) map.set(name, { name, url: sanitizeUrl(url), pushUrl: '' })
    if (type === 'push') map.get(name)!.pushUrl = sanitizeUrl(url)
  }
  return [...map.values()]
}

async function getFileStatus(cwd: string): Promise<GitStatusSummary> {
  const r = await git(cwd, ['status', '--porcelain', '-uall'])
  const staged: GitFileStatus[] = []
  const modified: GitFileStatus[] = []
  const untracked: GitFileStatus[] = []

  if (r.status === 0 && r.stdout.trim()) {
    for (const line of r.stdout.split('\n')) {
      if (line.length < 3) continue
      const index = line[0]
      const worktree = line[1]
      const rest = line.slice(3)
      const renamedFrom = rest.includes(' -> ') ? rest.split(' -> ')[0] : undefined
      const filePath = rest.includes(' -> ') ? rest.split(' -> ')[1] : rest

      const file: GitFileStatus = { path: filePath, index, worktree, renamedFrom }

      if (index === '?' && worktree === '?') {
        untracked.push(file)
      } else if (index !== ' ' && index !== '?') {
        staged.push(file)
        if (worktree !== ' ' && worktree !== '?') modified.push(file)
      } else {
        modified.push(file)
      }
    }
  }

  return {
    staged,
    modified,
    untracked,
    totalChanges: staged.length + modified.length + untracked.length,
    clean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
  }
}

async function getSyncStatus(cwd: string): Promise<GitSyncStatus> {
  const upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '@{u}'])
  if (upstream.status !== 0) return { ahead: 0, behind: 0, hasUpstream: false }
  const counts = await git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
  if (counts.status !== 0) return { ahead: 0, behind: 0, hasUpstream: true }
  const parts = counts.stdout.trim().split(/\s+/)
  return {
    ahead: parseInt(parts[0] || '0', 10),
    behind: parseInt(parts[1] || '0', 10),
    hasUpstream: true,
  }
}

async function getLocalBranches(cwd: string): Promise<GitBranch[]> {
  const SEP = '|||'
  // git branch --format 使用 %(fieldname) 语法（非 git log 的 %h %H 语法）
  const r = await git(cwd, [
    'branch',
    '--format',
    `%(HEAD)${SEP}%(refname:short)${SEP}%(objectname:short)${SEP}%(subject)${SEP}%(upstream:short)${SEP}%(upstream:track)`,
  ])
  if (r.status !== 0) return []

  const branches: GitBranch[] = []
  for (const line of r.stdout.trim().split('\n')) {
    if (!line.trim()) continue
    const parts = line.split(SEP)
    if (parts.length < 4) continue
    const head = parts[0].trim()
    const name = parts[1].trim()
    const hash = parts[2].trim()
    const message = parts[3].trim()
    const upstream = parts[4]?.trim() || ''
    const track = parts[5]?.trim() || ''

    const aheadMatch = track.match(/ahead (\d+)/)
    const behindMatch = track.match(/behind (\d+)/)

    branches.push({
      name,
      current: head === '*',
      hash,
      message,
      remote: false,
      upstream: upstream || undefined,
      ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : 0,
      behind: behindMatch ? parseInt(behindMatch[1], 10) : 0,
    })
  }
  return branches
}

async function getRemoteBranches(cwd: string): Promise<GitBranch[]> {
  const SEP = '|||'
  const r = await git(cwd, [
    'branch',
    '-r',
    '--format',
    `%(refname)${SEP}%(refname:short)${SEP}%(objectname:short)${SEP}%(subject)`,
  ])
  if (r.status !== 0) return []

  return r.stdout
    .trim()
    .split('\n')
    .filter((l) => {
      if (!l.trim()) return false
      // 用完整 refname 过滤 origin/HEAD 符号引用
      const fullRef = l.split(SEP)[0]?.trim() || ''
      return fullRef && !fullRef.endsWith('/HEAD')
    })
    .map((line) => {
      const parts = line.split(SEP)
      return {
        name: parts[1]?.trim() || '',
        current: false,
        hash: parts[2]?.trim() || '',
        message: parts[3]?.trim() || '',
        remote: true,
        ahead: 0,
        behind: 0,
      }
    })
}

async function getCommits(
  cwd: string,
  ref: string,
  count: number,
  ref2?: string,
): Promise<GitCommit[]> {
  const SEP = '|||'
  // ref1..ref2 形式只能由两个已校验的 ref 拼出（assertSafeRef 会拒 `..`），
  // 调用方（端点 / overview）负责确保 ref / ref2 合法。
  const range = ref2 ? `${ref}..${ref2}` : ref
  const r = await git(cwd, [
    'log',
    range,
    `--max-count=${count}`,
    `--format=%h${SEP}%H${SEP}%an${SEP}%aI${SEP}%s`,
  ])
  if (r.status !== 0) return []

  return r.stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split(SEP)
      return {
        hash: parts[0] || '',
        fullHash: parts[1] || '',
        author: parts[2] || '',
        date: parts[3] || '',
        message: parts[4] || '',
      }
    })
}

// ─── 远端 tag 名缓存 ──────────────────────────────────
// git ls-remote --tags 有网络开销，每次 overview（8s/30s 轮询）都打会拖慢；
// 单独缓存 + in-flight 去重，写操作成功后由 invalidateOverview() 清空。

const REMOTE_TAG_TTL_MS = 30_000
let remoteTagCache: { names: Set<string>; ts: number } | null = null
let remoteTagInFlight: Promise<Set<string>> | null = null

/** 远端已存在的 tag 名集合（失败 / 离线返回空集，所有 tag 视为未推送） */
async function getRemoteTagNames(cwd: string): Promise<Set<string>> {
  const now = Date.now()
  if (remoteTagCache && now - remoteTagCache.ts < REMOTE_TAG_TTL_MS) {
    return remoteTagCache.names
  }
  if (remoteTagInFlight) return remoteTagInFlight
  remoteTagInFlight = (async () => {
    try {
      const r = await git(cwd, ['ls-remote', '--tags', 'origin'], 12_000)
      const names = new Set<string>()
      if (r.status === 0) {
        for (const line of r.stdout.split('\n')) {
          // 格式：<hash>\trefs/tags/<name>，附注 tag 还会多一行 ^{} 后缀
          const m = line.match(/^\S+\trefs\/tags\/([^\s]+)$/)
          if (m) {
            const n = m[1].replace(/\^\{\}$/, '')
            if (n) names.add(n)
          }
        }
      }
      remoteTagCache = { names, ts: Date.now() }
      return names
    } catch {
      if (!remoteTagCache) remoteTagCache = { names: new Set(), ts: Date.now() }
      return remoteTagCache.names
    } finally {
      remoteTagInFlight = null
    }
  })()
  return remoteTagInFlight
}

async function getTags(cwd: string): Promise<GitTag[]> {
  const SEP = '|||'
  const r = await git(cwd, [
    'tag',
    '--sort=-creatordate',
    `--format=%(refname:short)${SEP}%(objectname:short)${SEP}%(contents:subject)${SEP}%(creatordate:iso)${SEP}%(objecttype)`,
  ])
  if (r.status !== 0) return []

  // 与 ls-remote 并行无依赖，但需等待结果回填 onRemote
  const remoteNames = await getRemoteTagNames(cwd)

  return r.stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split(SEP)
      const name = parts[0] || ''
      return {
        name,
        hash: parts[1] || '',
        message: parts[2] || '',
        date: parts[3] || '',
        // objecttype：附注 tag 指向 tag 对象（type=tag），轻量 tag 直接指向 commit
        annotated: parts[4]?.trim() === 'tag',
        onRemote: remoteNames.has(name),
      }
    })
}

async function getStashes(cwd: string): Promise<GitStash[]> {
  const r = await git(cwd, ['stash', 'list', '--format=%gd|||%gs|||%ci'])
  if (r.status !== 0) return []

  return r.stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split('|||')
      const msg = parts[1] || ''
      // stash 消息通常形如 "WIP on branch: hash msg" 或 "On branch: msg"
      const branchMatch = msg.match(/(?:WIP\s+)?[Oo]n\s+([^:]+):?\s*(.*)/)
      return {
        index: parts[0] || '',
        message: branchMatch?.[2]?.trim() || msg,
        branch: branchMatch?.[1]?.trim() || '',
        date: parts[2] || '',
      }
    })
}

// ─── 扩展查询 ──────────────────────────────────────────

async function getBlame(cwd: string, filePath: string, ref?: string): Promise<GitBlameLine[]> {
  const args = ['blame', '--porcelain']
  if (ref) args.push(ref)
  args.push('--', filePath)
  const r = await git(cwd, args, 30_000)
  if (r.status !== 0) return []

  const lines: GitBlameLine[] = []
  let hash = ''
  let author = ''
  let date = ''
  let lineNum = 0
  const raw = r.stdout.split('\n')

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]
    // blame --porcelain 格式：
    //   <hash> <origLine> <finalLine> [<numLines>]
    //   author <name>
    //   author-time <timestamp>
    //   ...
    //   \t<content>
    const headerMatch = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/)
    if (headerMatch) {
      hash = headerMatch[1].slice(0, 7)
      lineNum = parseInt(headerMatch[2], 10)
    } else if (line.startsWith('author ')) {
      author = line.slice(7)
    } else if (line.startsWith('author-time ')) {
      const ts = parseInt(line.slice(12), 10)
      date = ts ? new Date(ts * 1000).toISOString() : ''
    } else if (line.startsWith('\t')) {
      lines.push({ hash, author, date, line: lineNum, content: line.slice(1) })
    }
  }
  return lines
}

async function getReflog(cwd: string, count: number): Promise<GitReflogEntry[]> {
  const SEP = '|||'
  const r = await git(cwd, ['reflog', `--max-count=${count}`, `--format=%h${SEP}%gs${SEP}%ci`])
  if (r.status !== 0) return []

  return r.stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split(SEP)
      return {
        hash: parts[0] || '',
        action: parts[1] || '',
        date: parts[2] || '',
      }
    })
}

async function getContributors(cwd: string): Promise<GitContributor[]> {
  const r = await git(cwd, ['shortlog', '-sne', '--all'], 30_000)
  if (r.status !== 0) return []

  return r.stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      // 格式："  123\tName <email>"
      const m = line.match(/^\s*(\d+)\t(.+?)\s*<(.+?)>\s*$/)
      if (!m) return null
      return { commits: parseInt(m[1], 10), name: m[2], email: m[3] }
    })
    .filter((c): c is GitContributor => c !== null)
    .sort((a, b) => b.commits - a.commits)
}

async function getConfig(cwd: string): Promise<GitConfigEntry[]> {
  const r = await git(cwd, ['config', '--list', '--local'])
  if (r.status !== 0) return []

  return r.stdout
    .trim()
    .split('\n')
    .filter((l) => l.includes('='))
    .map((line) => {
      const idx = line.indexOf('=')
      const key = line.slice(0, idx)
      let value = line.slice(idx + 1)
      // 脱敏：remote URL 中可能含 user:pass@
      if (key.endsWith('.url') || key.endsWith('.pushurl')) {
        value = sanitizeUrl(value)
      }
      return { key, value }
    })
}

async function searchCommits(cwd: string, query: string, count: number): Promise<GitCommit[]> {
  const SEP = '|||'
  const r = await git(cwd, [
    'log',
    '--all',
    `--max-count=${count}`,
    `--grep=${query}`,
    '-i',
    `--format=%h${SEP}%H${SEP}%an${SEP}%aI${SEP}%s`,
  ])
  if (r.status !== 0) return []

  return r.stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split(SEP)
      return {
        hash: parts[0] || '',
        fullHash: parts[1] || '',
        author: parts[2] || '',
        date: parts[3] || '',
        message: parts[4] || '',
      }
    })
}

// ─── 操作 ─────────────────────────────────────────────

const RESET_MODES = new Set(['soft', 'mixed', 'hard', 'keep'])

async function doAction(
  cwd: string,
  action: string,
  params: Record<string, string>,
): Promise<GitActionResponse> {
  let r: GitResult = { status: -1, stdout: '', stderr: '' }

  try {
    switch (action) {
      // ─── 远端同步 ─────────────────────────────
      case 'fetch':
        r = await git(cwd, ['fetch', '--all', '--prune'], 60_000)
        break
      case 'pull':
        r = await git(cwd, ['pull'], 60_000)
        break
      case 'push': {
        const args = ['push']
        if (params.remote) {
          assertSafeRef(params.remote, '远端名')
          args.push(params.remote)
        }
        if (params.branch) {
          assertSafeRef(params.branch, '分支名')
          args.push(params.branch)
        }
        if (params.setUpstream === 'true') args.push('-u')
        if (params.force === 'true') args.push('--force-with-lease')
        if (params.tags === 'true') args.push('--tags')
        r = await git(cwd, args, 60_000)
        break
      }

      // ─── 分支管理 ─────────────────────────────
      case 'checkout': {
        const branch = params.branch
        if (!branch) return { success: false, message: '', error: '未指定分支名' }
        assertSafeRef(branch, '分支名')
        r = await git(cwd, ['checkout', branch], 30_000)
        if (r.status !== 0 && r.stderr.includes('did not match any')) {
          // 本地不存在，尝试从远端创建跟踪分支
          r = await git(cwd, ['checkout', '-b', branch, `origin/${branch}`], 30_000)
        }
        break
      }
      case 'branch-create': {
        const name = params.name
        if (!name) return { success: false, message: '', error: '未指定分支名' }
        assertSafeRef(name, '分支名')
        const args = ['branch', name]
        if (params.base) {
          assertSafeRef(params.base, 'base')
          args.push(params.base)
        }
        r = await git(cwd, args)
        break
      }
      case 'branch-delete': {
        const name = params.name
        if (!name) return { success: false, message: '', error: '未指定分支名' }
        assertSafeRef(name, '分支名')
        const force = params.force === 'true'
        r = await git(cwd, ['branch', force ? '-D' : '-d', name])
        break
      }
      case 'merge': {
        const source = params.source
        if (!source) return { success: false, message: '', error: '未指定要合并的分支' }
        assertSafeRef(source, '合并源')
        const args = ['merge', source]
        if (params.noCommit === 'true') args.push('--no-commit')
        if (params.squash === 'true') args.push('--squash')
        r = await git(cwd, args, 60_000)
        break
      }

      // ─── 暂存 & 提交 ──────────────────────────
      case 'add': {
        const files = params.files
        if (!files) return { success: false, message: '', error: '未指定文件' }
        // files 可以是逗号分隔的路径列表，或 "." 表示全部
        // `--` 明确分隔，杜绝路径名被当 flag
        const fileList = files === '.' ? ['.'] : files.split(',').map((f) => f.trim()).filter(Boolean)
        r = await git(cwd, ['add', '--', ...fileList])
        break
      }
      case 'commit': {
        const amend = params.amend === 'true'
        const message = params.message
        // amend 走 --no-edit 时无需 message；其余情况必须提供
        if (!amend && !message) {
          return { success: false, message: '', error: '未提供提交信息' }
        }
        const args = ['commit']
        if (amend) {
          args.push('--amend')
          // 有 message 就用新 message，没有则保留原 message（--no-edit）
          args.push(message ? '-m' : '--no-edit')
          if (message) args.push(message)
        } else {
          args.push('-m', message!)
        }
        if (params.all === 'true') args.push('-a')
        r = await git(cwd, args)
        break
      }
      case 'reset': {
        const args = ['reset']
        if (params.files) {
          // 取消暂存：git reset HEAD -- file1 file2 ...
          args.push('HEAD', '--', ...params.files.split(',').map((f) => f.trim()).filter(Boolean))
        } else {
          if (params.mode) {
            if (!RESET_MODES.has(params.mode)) {
              return { success: false, message: '', error: `非法 reset 模式：${params.mode}` }
            }
            args.push(`--${params.mode}`) // soft / mixed / hard / keep
          }
          if (params.target) {
            assertSafeRef(params.target, 'reset 目标')
            args.push(params.target)
          }
        }
        r = await git(cwd, args)
        break
      }
      case 'discard': {
        // 丢弃工作区修改：已跟踪 → git restore -- <files>；未跟踪 → git clean -f -- <files>
        const files = params.files
        if (!files) return { success: false, message: '', error: '未指定文件' }
        const fileList = files.split(',').map((f) => f.trim()).filter(Boolean)
        if (params.untracked === 'true') {
          r = await git(cwd, ['clean', '-f', '--', ...fileList])
        } else {
          r = await git(cwd, ['restore', '--', ...fileList])
        }
        break
      }

      // ─── 储藏 ─────────────────────────────────
      case 'stash':
        r = await git(cwd, ['stash', 'push', '-m', params.message || 'auto-stash'])
        break
      case 'stash-pop':
        r = await git(cwd, ['stash', 'pop'])
        break
      case 'stash-apply': {
        const idx = params.index || 'stash@{0}'
        r = await git(cwd, ['stash', 'apply', idx])
        break
      }
      case 'stash-drop': {
        const idx = params.index || 'stash@{0}'
        r = await git(cwd, ['stash', 'drop', idx])
        break
      }

      // ─── 历史操作 ─────────────────────────────
      case 'cherry-pick': {
        const hash = params.hash
        if (!hash) return { success: false, message: '', error: '未指定 commit hash' }
        assertSafeHash(hash)
        const args = ['cherry-pick', hash]
        if (params.noCommit === 'true') args.push('--no-commit')
        r = await git(cwd, args, 30_000)
        break
      }
      case 'revert': {
        const hash = params.hash
        if (!hash) return { success: false, message: '', error: '未指定 commit hash' }
        assertSafeHash(hash)
        const args = ['revert', hash]
        if (params.noCommit === 'true') args.push('--no-commit')
        r = await git(cwd, args, 30_000)
        break
      }

      // ─── 标签 ─────────────────────────────────
      case 'tag-create': {
        const name = params.name
        if (!name) return { success: false, message: '', error: '未指定标签名' }
        assertSafeRef(name, '标签名')
        const args = ['tag']
        if (params.message) {
          args.push('-a', name, '-m', params.message)
        } else {
          args.push(name)
        }
        if (params.ref) {
          assertSafeRef(params.ref, '标签 ref')
          args.push(params.ref)
        }
        r = await git(cwd, args)
        break
      }
      case 'tag-delete': {
        const name = params.name
        if (!name) return { success: false, message: '', error: '未指定标签名' }
        assertSafeRef(name, '标签名')
        r = await git(cwd, ['tag', '-d', name])
        break
      }
      case 'tag-delete-remote': {
        // 删远端标签：`git push <remote> --delete <tag>`
        const name = params.name
        if (!name) return { success: false, message: '', error: '未指定标签名' }
        assertSafeRef(name, '标签名')
        const remote = params.remote || 'origin'
        assertSafeRef(remote, '远端名')
        r = await git(cwd, ['push', remote, '--delete', name], 60_000)
        break
      }

      default:
        return { success: false, message: '', error: `未知操作：${action}` }
    }
  } catch (e) {
    // assertSafeRef / assertSafeHash 抛错在这里兜底
    return { success: false, message: '', error: e instanceof Error ? e.message : String(e) }
  }

  const success = r.status === 0
  const combined = (r.stdout || '') + (r.stderr || '')
  // 冲突：merge / pull / cherry-pick / revert 等失败且 stderr 含 CONFLICT
  const conflict = !success && /CONFLICT/i.test(combined)

  // 写操作成功后让 overview 缓存失效，下一次请求拿到新状态
  if (success) {
    invalidateOverview()
  }

  return {
    success,
    message: r.stdout?.trim() || '',
    error: r.stderr?.trim() || undefined,
    conflict: conflict || undefined,
  }
}

// ─── 插件主体 ─────────────────────────────────────────

const OVERVIEW_TTL_MS = 1500
let overviewCache: { data: GitOverviewResponse; ts: number } | null = null
let overviewInFlight: Promise<GitOverviewResponse> | null = null

function invalidateOverview(): void {
  overviewCache = null
  // 写操作（push tag / delete tag 等）可能改变远端 tag 集合，一并清掉
  remoteTagCache = null
}

export function gitPlugin(options: GitPluginOptions): Plugin {
  const root = options.root?.trim() ? path.resolve(options.root.trim()) : ''

  async function computeOverview(): Promise<GitOverviewResponse> {
    const enabled = !!root && isGitRepo(root)
    if (!enabled) {
      return {
        enabled: false,
        root,
        branch: '',
        remotes: [],
        status: { staged: [], modified: [], untracked: [], totalChanges: 0, clean: true },
        sync: { ahead: 0, behind: 0, hasUpstream: false },
        commits: [],
        branches: [],
        remoteBranches: [],
        tags: [],
        stashes: [],
      }
    }
    // 9 条命令互相独立，并行执行（异步 spawn 不阻塞事件循环）
    const [branch, remotes, status, sync, commits, branches, remoteBranches, tags, stashes] =
      await Promise.all([
        getCurrentBranch(root),
        getRemotes(root),
        getFileStatus(root),
        getSyncStatus(root),
        getCommits(root, 'HEAD', 20),
        getLocalBranches(root),
        getRemoteBranches(root),
        getTags(root),
        getStashes(root),
      ])
    return {
      enabled: true,
      root,
      branch,
      remotes,
      status,
      sync,
      commits,
      branches,
      remoteBranches,
      tags,
      stashes,
    }
  }

  /** overview 带 TTL 短缓存 + in-flight 去重，合并并发轮询 */
  async function buildOverview(force = false): Promise<GitOverviewResponse> {
    const now = Date.now()
    if (!force && overviewCache && now - overviewCache.ts < OVERVIEW_TTL_MS) {
      return overviewCache.data
    }
    if (overviewInFlight) return overviewInFlight
    overviewInFlight = (async () => {
      try {
        const data = await computeOverview()
        overviewCache = { data, ts: Date.now() }
        return data
      } finally {
        overviewInFlight = null
      }
    })()
    return overviewInFlight
  }

  return {
    name: 'git-repo-info',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqUrl = req.url ?? ''
        if (!reqUrl.startsWith('/git/')) return next()

        void (async () => {
          const u = new URL(reqUrl, 'http://localhost')
          const pathname = u.pathname.replace(/\/+$/, '') || '/'
          const repoOk = isGitRepo(root)

          // --- 读取类端点 ---

          if (pathname === '/git/overview' && req.method === 'GET') {
            sendJson(res, 200, await buildOverview())
            return
          }

          if (pathname === '/git/commits' && req.method === 'GET') {
            if (!repoOk) {
              sendJson(res, 200, { enabled: false, commits: [] })
              return
            }
            const ref = u.searchParams.get('branch') || 'HEAD'
            const ref2 = u.searchParams.get('ref2') || ''
            const count = Math.min(parseInt(u.searchParams.get('count') || '20', 10), 100)
            // 区间查询两个 ref 都要单独校验（getCommits 内部拼 `ref..ref2`，assertSafeRef 拒 `..`）
            assertSafeRef(ref, 'ref')
            if (ref2) assertSafeRef(ref2, 'ref2')
            sendJson(res, 200, { enabled: true, commits: await getCommits(root, ref, count, ref2 || undefined) })
            return
          }

          if (pathname === '/git/diff' && req.method === 'GET') {
            if (!repoOk) {
              sendJson(res, 200, { enabled: false, diff: '' })
              return
            }
            const filePath = u.searchParams.get('path') || ''
            const cached = u.searchParams.get('cached') === '1'
            const ref1 = u.searchParams.get('ref1')
            const ref2 = u.searchParams.get('ref2')
            const args = ['diff']
            if (cached) args.push('--cached')
            if (ref1 && ref2) {
              assertSafeRef(ref1, 'ref1')
              assertSafeRef(ref2, 'ref2')
              args.push(`${ref1}..${ref2}`)
            } else if (ref1) {
              assertSafeRef(ref1, 'ref1')
              args.push(ref1)
            }
            args.push('--', filePath)
            const r = await git(root, args)
            sendJson(res, 200, { enabled: true, diff: r.stdout || '' })
            return
          }

          if (pathname === '/git/commit-detail' && req.method === 'GET') {
            if (!repoOk) {
              sendJson(res, 200, { enabled: false, diff: '' })
              return
            }
            const hash = u.searchParams.get('hash') || 'HEAD'
            assertSafeHash(hash)
            const r = await git(root, ['show', hash, '--stat', '--format=fuller'])
            sendJson(res, 200, { enabled: true, diff: r.stdout || '' })
            return
          }

          // --- 扩展查询端点 ---

          if (pathname === '/git/blame' && req.method === 'GET') {
            if (!repoOk) {
              sendJson(res, 200, { enabled: false, blame: [] })
              return
            }
            const filePath = u.searchParams.get('path') || ''
            const ref = u.searchParams.get('ref') || undefined
            if (ref) assertSafeRef(ref, 'ref')
            sendJson(res, 200, { enabled: true, blame: await getBlame(root, filePath, ref) })
            return
          }

          if (pathname === '/git/reflog' && req.method === 'GET') {
            if (!repoOk) {
              sendJson(res, 200, { enabled: false, reflog: [] })
              return
            }
            const count = Math.min(parseInt(u.searchParams.get('count') || '30', 10), 100)
            sendJson(res, 200, { enabled: true, reflog: await getReflog(root, count) })
            return
          }

          if (pathname === '/git/contributors' && req.method === 'GET') {
            if (!repoOk) {
              sendJson(res, 200, { enabled: false, contributors: [] })
              return
            }
            sendJson(res, 200, { enabled: true, contributors: await getContributors(root) })
            return
          }

          if (pathname === '/git/config' && req.method === 'GET') {
            if (!repoOk) {
              sendJson(res, 200, { enabled: false, config: [] })
              return
            }
            sendJson(res, 200, { enabled: true, config: await getConfig(root) })
            return
          }

          if (pathname === '/git/search' && req.method === 'GET') {
            if (!repoOk) {
              sendJson(res, 200, { enabled: false, commits: [] })
              return
            }
            const query = u.searchParams.get('q') || ''
            const count = Math.min(parseInt(u.searchParams.get('count') || '20', 10), 50)
            sendJson(res, 200, { enabled: true, commits: await searchCommits(root, query, count) })
            return
          }

          // --- 操作类端点 ---

          if (pathname === '/git/action' && req.method === 'POST') {
            if (!repoOk) {
              sendJson(res, 200, {
                success: false,
                message: '',
                error: 'wbscf-web 仓库未配置或不是有效的 git 仓库',
              })
              return
            }
            const bodyChunks: Buffer[] = []
            let bodySize = 0
            const MAX_BODY = 64 * 1024
            for await (const chunk of req as AsyncIterable<Buffer>) {
              bodySize += chunk.length
              if (bodySize > MAX_BODY) {
                sendJson(res, 413, { success: false, message: '', error: '请求体过大' })
                return
              }
              bodyChunks.push(chunk)
            }
            const raw = Buffer.concat(bodyChunks).toString()
            let parsed: { action: string; params: Record<string, string> }
            try {
              parsed = JSON.parse(raw || '{}')
            } catch {
              sendJson(res, 400, { success: false, message: '', error: '请求体不是合法 JSON' })
              return
            }
            sendJson(res, 200, await doAction(root, parsed.action || '', parsed.params || {}))
            return
          }

          sendJson(res, 404, { error: `未知端点：${pathname}` })
        })().catch((err) => {
          // 端点内的 assertSafeRef/Hash 抛错在此兜底（非 doAction 内部已处理的）
          if (!res.headersSent) {
            sendJson(res, 200, {
              success: false,
              message: '',
              error: err instanceof Error ? err.message : String(err),
            })
          }
        })
      })
    },
  }
}
