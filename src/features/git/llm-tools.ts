/**
 * Git 仓库信息模块 · LLM 工具层（function-calling / tool-use）
 *
 * 与天气 / 禅道 / 知识库 / 本地待办 / wbscf 工具层同构（复用 LlmToolDef 接口），
 * 把 wbscf-web git 仓库的**查询能力与基础写操作**以工具形式暴露给小吴
 * （merge / cherry-pick / revert / reset / stash / tag 等高级写操作仅走 Dashboard，不暴露给 LLM 以控制风险面）：
 *
 *   查询类（只读，安全）：
 *     git.status        查仓库概览（分支 / 状态 / ahead-behind / 最近提交）
 *     git.log           查 commit 日志
 *     git.blame         查文件逐行追溯（谁在什么时候改了什么）
 *     git.search        按关键词搜索 commit 信息
 *     git.contributors  查贡献者统计
 *     git.reflog        查操作历史
 *     git.config        查仓库 git config
 *
 *   操作类（会改变仓库状态）：
 *     git.checkout      切换分支
 *     git.fetch         拉取远端引用
 *     git.pull          拉取并合并
 *     git.push          推送到远端
 *     git.add           暂存文件
 *     git.commit        创建提交
 *     git.branch        创建 / 删除分支
 *
 * 生产构建无 dev server，端点 404：fetchGitOverview 抛错，catch 成 { enabled:false }。
 */
import type { LlmToolDef, LlmTool } from '@/features/chat/llm/types'
import {
  fetchGitOverview,
  fetchGitCommits,
  fetchGitBlame,
  fetchGitSearchCommits,
  fetchGitContributors,
  fetchGitReflog,
  fetchGitConfig,
  triggerGitAction,
} from './api'
import type { GitOverviewResponse } from './types'

async function safeFetch(): Promise<GitOverviewResponse | { enabled: false }> {
  try {
    return await fetchGitOverview()
  } catch {
    return { enabled: false }
  }
}

function notEnabled() {
  return {
    enabled: false,
    note: '未配置 wbscf-web 代码库（VITE_WBSCF_WEB_ROOT），或当前无 dev server。',
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  查询类工具
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 1. 查询仓库概览 */
const statusTool: LlmTool = {
  name: 'git.status',
  description:
    '查询 wbscf-web 代码库的 git 概览：当前分支、工作区状态（已修改/已暂存/未跟踪文件数及列表）、' +
    '领先/落后远端 commit 数、最近 10 条提交、本地分支列表（含 ahead/behind）。' +
    '【适用】用户问 git 相关——「现在什么分支」「有没有未提交的改动」「领先远端几个 commit」' +
    '「最近提交了什么」「有哪些分支」等。只读查询。',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute() {
    const resp = await safeFetch()
    if (!resp.enabled) return notEnabled()
    return {
      enabled: true,
      root: resp.root,
      branch: resp.branch,
      sync: resp.sync,
      status: {
        totalChanges: resp.status.totalChanges,
        clean: resp.status.clean,
        staged: resp.status.staged.length,
        modified: resp.status.modified.length,
        untracked: resp.status.untracked.length,
        files: [
          ...resp.status.staged.map((f) => ({ ...f, category: 'staged' })),
          ...resp.status.modified.map((f) => ({ ...f, category: 'modified' })),
          ...resp.status.untracked.map((f) => ({ ...f, category: 'untracked' })),
        ].slice(0, 30),
      },
      recentCommits: resp.commits.slice(0, 10),
      localBranches: resp.branches.map((b) => ({
        name: b.name,
        current: b.current,
        ahead: b.ahead,
        behind: b.behind,
        message: b.message,
      })),
    }
  },
}

/** 2. 查询 commit 日志 */
const logTool: LlmTool = {
  name: 'git.log',
  description:
    '查看 wbscf-web 代码库的 commit 提交日志。默认查当前分支最近 20 条，可指定分支名和条数。' +
    '【适用】用户问「develop 上最近提交了什么」「最近 5 个 commit」「谁改了什么」等。',
  parameters: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: '分支名（不传则当前分支）' },
      count: { type: 'number', description: '返回条数（默认 20，上限 50）' },
    },
    required: [],
  },
  async execute({ branch, count }: Record<string, unknown>) {
    try {
      const data = await fetchGitCommits(branch as string | undefined, Math.min((count as number) || 20, 50))
      if (!data.enabled) return notEnabled()
      return { enabled: true, branch: branch || '(current)', commits: data.commits }
    } catch (e) {
      return { enabled: false, error: (e as Error)?.message || '查询 commit 失败' }
    }
  },
}

/** 3. 文件 blame（逐行追溯） */
const blameTool: LlmTool = {
  name: 'git.blame',
  description:
    '查看 wbscf-web 代码库中某个文件的 git blame（逐行追溯：每一行最后被谁、在哪个 commit、什么时候修改的）。' +
    '【适用】用户问「这个文件谁改的」「这行代码什么时候加的」「谁写了这段逻辑」等。' +
    '注意：返回结果按行展示，文件较大时只返回前 100 行，建议指定关键行号范围。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径（相对仓库根，如 src/views/Home.vue）' },
      ref: { type: 'string', description: '可选，指定 commit 或分支（默认 HEAD）' },
    },
    required: ['path'],
  },
  async execute({ path, ref }: Record<string, unknown>) {
    try {
      const data = await fetchGitBlame(path as string, ref as string | undefined)
      if (!data.enabled) return notEnabled()
      // 截取前 100 行避免 token 爆炸
      const lines = data.blame.slice(0, 100)
      return {
        enabled: true,
        file: path,
        totalLines: data.blame.length,
        truncated: data.blame.length > 100,
        lines: lines.map((l) => ({
          line: l.line,
          author: l.author,
          hash: l.hash,
          date: l.date,
          content: l.content.slice(0, 120),
        })),
      }
    } catch (e) {
      return { enabled: false, error: (e as Error)?.message || 'blame 查询失败' }
    }
  },
}

/** 4. 搜索 commit */
const searchTool: LlmTool = {
  name: 'git.search',
  description:
    '按关键词搜索 wbscf-web 代码库的全部 commit 信息（git log --grep，不区分大小写，跨所有分支）。' +
    '【适用】用户问「有没有提交过 xxx 相关的改动」「搜索包含某关键词的 commit」等。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词（匹配 commit message）' },
      count: { type: 'number', description: '返回条数（默认 20，上限 50）' },
    },
    required: ['query'],
  },
  async execute({ query, count }: Record<string, unknown>) {
    try {
      const data = await fetchGitSearchCommits(
        query as string,
        Math.min((count as number) || 20, 50),
      )
      if (!data.enabled) return notEnabled()
      return { enabled: true, query, matchCount: data.commits.length, commits: data.commits }
    } catch (e) {
      return { enabled: false, error: (e as Error)?.message || '搜索失败' }
    }
  },
}

/** 5. 贡献者统计 */
const contributorsTool: LlmTool = {
  name: 'git.contributors',
  description:
    '查看 wbscf-web 代码库的贡献者统计（git shortlog -sne --all）：每位贡献者的姓名、邮箱、提交总数，按提交数降序。' +
    '【适用】用户问「这个项目谁贡献最多」「有哪些贡献者」「某某提交了多少」等。',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute() {
    try {
      const data = await fetchGitContributors()
      if (!data.enabled) return notEnabled()
      return { enabled: true, total: data.contributors.length, contributors: data.contributors }
    } catch (e) {
      return { enabled: false, error: (e as Error)?.message || '查询贡献者失败' }
    }
  },
}

/** 6. Reflog（操作历史） */
const reflogTool: LlmTool = {
  name: 'git.reflog',
  description:
    '查看 wbscf-web 代码库的 reflog（操作历史）：checkout、merge、reset、commit 等操作记录。' +
    '可用于找回丢失的 commit（比如 reset --hard 之前的状态）。' +
    '【适用】用户问「我之前在什么分支」「刚才 reset 之前的 commit hash 是什么」等。',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number', description: '返回条数（默认 30，上限 100）' },
    },
    required: [],
  },
  async execute({ count }: Record<string, unknown>) {
    try {
      const data = await fetchGitReflog(Math.min((count as number) || 30, 100))
      if (!data.enabled) return notEnabled()
      return { enabled: true, reflog: data.reflog }
    } catch (e) {
      return { enabled: false, error: (e as Error)?.message || '查询 reflog 失败' }
    }
  },
}

/** 7. Git Config */
const configTool: LlmTool = {
  name: 'git.config',
  description:
    '查看 wbscf-web 代码库的本地 git config（.git/config）：user.name、user.email、remote 配置、分支跟踪等。' +
    '【适用】用户问「git 配的什么邮箱」「remote 地址是什么」等。',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute() {
    try {
      const data = await fetchGitConfig()
      if (!data.enabled) return notEnabled()
      // 脱敏：去除 remote URL 中的密码
      const config = data.config.map((c) => ({
        key: c.key,
        value: c.key.includes('url') ? c.value.replace(/\/\/[^@]+@/, '//') : c.value,
      }))
      return { enabled: true, config }
    } catch (e) {
      return { enabled: false, error: (e as Error)?.message || '查询 config 失败' }
    }
  },
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  操作类工具
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 8. 切换分支 */
const checkoutTool: LlmTool = {
  name: 'git.checkout',
  description:
    '切换 wbscf-web 代码库到指定分支（git checkout）。如果本地不存在但远端有，会自动创建跟踪分支。' +
    '【适用】用户说「切到 develop」「切换到 xxx 分支」等。' +
    '【注意】切换前建议确认工作区是否干净（用 git.status）。',
  parameters: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: '要切换到的分支名' },
    },
    required: ['branch'],
  },
  async execute({ branch, signal }: Record<string, unknown>) {
    if ((signal as AbortSignal)?.aborted) return { aborted: true }
    try {
      const result = await triggerGitAction('checkout', { branch: branch as string })
      return { enabled: true, success: result.success, message: result.message, error: result.error }
    } catch (e) {
      return { enabled: false, success: false, error: (e as Error)?.message || '切换分支失败' }
    }
  },
}

/** 9. Fetch */
const fetchTool: LlmTool = {
  name: 'git.fetch',
  description:
    '从远端拉取最新引用（git fetch --all --prune），不合并到本地分支。更新远端分支列表和 ahead/behind 状态。' +
    '【适用】用户说「fetch 一下」「更新远端」「看看远端有没有新的」等。',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute({ signal }: Record<string, unknown>) {
    if ((signal as AbortSignal)?.aborted) return { aborted: true }
    try {
      const result = await triggerGitAction('fetch')
      return { enabled: true, success: result.success, message: result.message, error: result.error }
    } catch (e) {
      return { enabled: false, success: false, error: (e as Error)?.message || 'fetch 失败' }
    }
  },
}

/** 10. Pull */
const pullTool: LlmTool = {
  name: 'git.pull',
  description:
    '拉取远端并合并到当前分支（git pull）。如果有冲突会返回错误信息。' +
    '【适用】用户说「pull 一下」「拉最新代码」「同步一下」等。',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute({ signal }: Record<string, unknown>) {
    if ((signal as AbortSignal)?.aborted) return { aborted: true }
    try {
      const result = await triggerGitAction('pull')
      return { enabled: true, success: result.success, message: result.message, error: result.error }
    } catch (e) {
      return { enabled: false, success: false, error: (e as Error)?.message || 'pull 失败' }
    }
  },
}

/** 11. Push */
const pushTool: LlmTool = {
  name: 'git.push',
  description:
    '推送当前分支到远端（git push）。可指定远端名、分支名、是否 force-with-lease、是否带 tags。' +
    '【适用】用户说「push 一下」「推到远端」「提交到线上」等。' +
    '【注意】force push 使用 --force-with-lease（安全强推），仅在用户明确要求时使用。',
  parameters: {
    type: 'object',
    properties: {
      remote: { type: 'string', description: '远端名（默认 origin）' },
      branch: { type: 'string', description: '分支名（默认当前分支）' },
      setUpstream: { type: 'boolean', description: '是否设置 upstream（-u），新分支首次 push 时需要' },
      force: { type: 'boolean', description: '是否强推（--force-with-lease），谨慎使用' },
      tags: { type: 'boolean', description: '是否同时推送 tags' },
    },
    required: [],
  },
  async execute(params: Record<string, unknown>) {
    if ((params.signal as AbortSignal)?.aborted) return { aborted: true }
    try {
      const result = await triggerGitAction('push', {
        remote: (params.remote as string) || '',
        branch: (params.branch as string) || '',
        setUpstream: params.setUpstream ? 'true' : '',
        force: params.force ? 'true' : '',
        tags: params.tags ? 'true' : '',
      })
      return { enabled: true, success: result.success, message: result.message, error: result.error }
    } catch (e) {
      return { enabled: false, success: false, error: (e as Error)?.message || 'push 失败' }
    }
  },
}

/** 12. Add（暂存文件） */
const addTool: LlmTool = {
  name: 'git.add',
  description:
    '暂存 wbscf-web 代码库的文件到 git 暂存区（git add），为后续 commit 做准备。' +
    'files 可以是逗号分隔的文件路径列表，或 "." 表示暂存全部变更。' +
    '【适用】用户说「暂存一下」「add 这些文件」「把改动加到暂存区」等。',
  parameters: {
    type: 'object',
    properties: {
      files: {
        type: 'string',
        description: '逗号分隔的文件路径（相对仓库根），或 "." 暂存全部',
      },
    },
    required: ['files'],
  },
  async execute({ files }: Record<string, unknown>) {
    try {
      const result = await triggerGitAction('add', { files: files as string })
      return { enabled: true, success: result.success, message: result.message, error: result.error }
    } catch (e) {
      return { enabled: false, success: false, error: (e as Error)?.message || 'add 失败' }
    }
  },
}

/** 13. Commit（创建提交） */
const commitTool: LlmTool = {
  name: 'git.commit',
  description:
    '在 wbscf-web 代码库创建一次 git commit。暂存区的文件会被提交。' +
    'all=true 时自动暂存所有已跟踪文件的修改（git commit -a），无需先 git add。' +
    'amend=true 时修正上一次 commit：传 message 则用新 message 覆盖，不传 message 则保留原 message（--amend --no-edit）。' +
    '【适用】用户说「提交一下」「commit 这些改动」「修正上一个 commit」等。' +
    '【注意】提交前请先确认已暂存需要的文件（用 git.add 或 all=true）。',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '提交信息（非 amend 时必填；amend=true 时可选，不传则保留原 message）' },
      all: { type: 'boolean', description: '是否自动暂存所有已跟踪文件的修改（-a）' },
      amend: { type: 'boolean', description: '是否修正上一次 commit（--amend）' },
    },
    required: [],
  },
  async execute(params: Record<string, unknown>) {
    try {
      const result = await triggerGitAction('commit', {
        message: (params.message as string) || '',
        all: params.all ? 'true' : '',
        amend: params.amend ? 'true' : '',
      })
      return { enabled: true, success: result.success, message: result.message, error: result.error }
    } catch (e) {
      return { enabled: false, success: false, error: (e as Error)?.message || 'commit 失败' }
    }
  },
}

/** 14. 分支管理（创建 / 删除） */
const branchTool: LlmTool = {
  name: 'git.branch',
  description:
    '管理 wbscf-web 代码库的分支：创建新分支（git branch <name> [base]）或删除分支（git branch -d/-D <name>）。' +
    '创建时可指定 base（基于哪个分支/commit 创建，默认 HEAD）。' +
    '删除时 force=true 使用 -D（强制删除未合并分支），默认 -d（安全删除已合并分支）。' +
    '【适用】用户说「创建一个 xxx 分支」「删掉那个废弃分支」等。' +
    '【注意】不会自动切换分支，创建后需 git.checkout 切过去。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: '操作类型', enum: ['create', 'delete'] },
      name: { type: 'string', description: '分支名' },
      base: { type: 'string', description: '创建时基于的分支/commit（仅 create）' },
      force: { type: 'boolean', description: '删除时是否强制（-D，仅 delete）' },
    },
    required: ['action', 'name'],
  },
  async execute(params: Record<string, unknown>) {
    const act = params.action as string
    const name = params.name as string
    if (act === 'create') {
      const result = await triggerGitAction('branch-create', {
        name,
        base: (params.base as string) || '',
      })
      return { enabled: true, action: 'create', success: result.success, message: result.message, error: result.error }
    }
    if (act === 'delete') {
      const result = await triggerGitAction('branch-delete', {
        name,
        force: params.force ? 'true' : '',
      })
      return { enabled: true, action: 'delete', success: result.success, message: result.message, error: result.error }
    }
    return { enabled: true, success: false, error: `未知分支操作：${act}` }
  },
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  聚合 & 分发
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 全部 git 工具（14 个） */
export const gitTools: LlmTool[] = [
  // 查询
  statusTool,
  logTool,
  blameTool,
  searchTool,
  contributorsTool,
  reflogTool,
  configTool,
  // 操作
  checkoutTool,
  fetchTool,
  pullTool,
  pushTool,
  addTool,
  commitTool,
  branchTool,
]

/** 喂给 LLM 的工具声明（剥离 execute，可直接序列化） */
export const gitToolDefs: LlmToolDef[] = gitTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

export async function callGitTool(
  name: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const tool = gitTools.find((t) => t.name === name)
  if (!tool) return { error: `未知 git 工具：${name}` }
  try {
    const args = { ...(params as Record<string, unknown> | null), signal } as Record<string, unknown>
    return await tool.execute(args)
  } catch (e) {
    return { error: (e as Error)?.message || 'git 操作失败' }
  }
}
