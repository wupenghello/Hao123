<script setup lang="ts">
/**
 * Git 仓库信息仪表盘
 *
 * 展示 wbscf-web 代码库的完整 git 信息（本地 + 远端），包括：
 *   - 概览：仓库健康判断（可点交给小吴）、统计、最近提交、分支快照、远端、回滚（Reset）
 *   - 分支：本地 / 远端（搜索 / 切换 / 创建 / 删除 / 合并 / 检出远端）
 *   - 提交：commit 日志（revert / cherry-pick / 展开详情）+ 搜索 + reflog 操作历史
 *   - 变更：暂存 / 取消暂存 / 放弃修改 / blame / 提交（conventional 前缀 + 复用）
 *   - 标签 / Stash：tag 与 stash 管理
 *
 * 由状态栏 GitWidget 点击打开。HUD 玻璃面板风格。
 * 小吴（AI）在工作台是 ambient 的：健康判断 / 冲突 / diff 都可带上下文交给小吴（LLM 已配置时）。
 */
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { useGitDashboard } from '@/features/git'
import { useChatStore } from '@/features/chat'
import type { GitBlameLine, GitReflogEntry, GitCommit, GitTag } from '@/features/git'
import GitDiffBox from '@/components/GitDiffBox.vue'
import IconClose from '~icons/mdi/close'
import IconBranch from '~icons/mdi/source-branch'
import IconLoading from '~icons/mdi/loading'
import IconRefresh from '~icons/mdi/refresh'
import IconDownload from '~icons/mdi/download'
import IconUpload from '~icons/mdi/upload'
import IconSwitch from '~icons/mdi/source-branch-sync'
import IconCommit from '~icons/mdi/source-commit'
import IconFile from '~icons/mdi/file-outline'
import IconTag from '~icons/mdi/tag-outline'
import IconStash from '~icons/mdi/archive-outline'
import IconChevronRight from '~icons/mdi/chevron-right'
import IconChevronDown from '~icons/mdi/chevron-down'
import IconSync from '~icons/mdi/sync'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCheck from '~icons/mdi/check-circle-outline'
import IconModified from '~icons/mdi/circle-edit-outline'
import IconAdded from '~icons/mdi/plus-circle-outline'
import IconUntracked from '~icons/mdi/help-circle-outline'
import IconSearch from '~icons/mdi/magnify'
import IconPlus from '~icons/mdi/plus'
import IconTrash from '~icons/mdi/delete-outline'
import IconPlay from '~icons/mdi/play'
import IconPop from '~icons/mdi/arrow-up-bold-box-outline'
import IconRobot from '~icons/mdi/robot-outline'
import IconDiscard from '~icons/mdi/undo'
import IconReset from '~icons/mdi/backup-restore'
import IconMerge from '~icons/mdi/source-merge'
import IconCherryPick from '~icons/mdi/source-pull'
import IconRevert from '~icons/mdi/history'
import IconReflog from '~icons/mdi/clock-outline'
import IconBlame from '~icons/mdi/account-eye-outline'
import IconInfo from '~icons/mdi/information-outline'
import IconCopy from '~icons/mdi/content-copy'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const dash = useGitDashboard()
const chat = useChatStore()

const gitReady = computed(() => dash.gitReady.value)
const gitUnavailable = computed(() => dash.gitUnavailable.value)
const repoName = computed(() => dash.repoName.value)
const aiReady = computed(() => !!chat.configured)

const actionBannerClass = computed(() => {
  if (dash.actionStatus.value === 'error') return 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
  if (dash.actionStatus.value === 'conflict') return 'bg-amber-500/10 text-amber-300 border border-amber-500/25'
  if (dash.actionStatus.value === 'running') return 'bg-sky-500/10 text-sky-300 border border-sky-500/20'
  return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
})

// ─── 标签页 ────────────────────────────────────────

type TabKey = 'overview' | 'branches' | 'commits' | 'changes' | 'tags'
const activeTab = ref<TabKey>('overview')
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'branches', label: '分支' },
  { key: 'commits', label: '提交' },
  { key: 'changes', label: '变更' },
  { key: 'tags', label: '标签 / Stash' },
]

function goToTab(key: TabKey) {
  activeTab.value = key
}

// ─── More 下拉菜单（去重：Fetch/Pull/Push 已在 header，这里只放次要与高级操作） ───

const showMoreMenu = ref(false)

function toggleMoreMenu() {
  if (!gitReady.value) return
  showMoreMenu.value = !showMoreMenu.value
}
function closeMoreMenu() {
  showMoreMenu.value = false
}

// ─── 分支搜索 ──────────────────────────────────────

const branchSearch = ref('')
const showRemoteBranches = ref(false)

const filteredBranches = computed(() => {
  const q = branchSearch.value.toLowerCase().trim()
  if (!q) return dash.branches.value
  return dash.branches.value.filter((b) => b.name.toLowerCase().includes(q))
})

const filteredRemoteBranches = computed(() => {
  const q = branchSearch.value.toLowerCase().trim()
  if (!q) return dash.remoteBranches.value
  return dash.remoteBranches.value.filter((b) => b.name.toLowerCase().includes(q))
})

function hasLocalCounterpart(remoteBranch: { name: string }): boolean {
  const shortName = remoteBranch.name.replace(/^[^/]+\//, '')
  return dash.branches.value.some((b) => b.name === shortName)
}

function shortRemoteName(name: string): string {
  return name.replace(/^[^/]+\//, '')
}

// ─── 创建分支 ──────────────────────────────────────

const showCreateBranch = ref(false)
const newBranchName = ref('')
const newBranchBase = ref('')

function toggleCreateBranch() {
  showCreateBranch.value = !showCreateBranch.value
  if (!showCreateBranch.value) {
    newBranchName.value = ''
    newBranchBase.value = ''
  }
}

async function submitCreateBranch() {
  const name = newBranchName.value.trim()
  if (!gitReady.value || !name) return
  await dash.doCreateBranch(name, newBranchBase.value.trim() || undefined)
  showCreateBranch.value = false
  newBranchName.value = ''
  newBranchBase.value = ''
}

// ─── 合并分支 ──────────────────────────────────────

const showMergeForm = ref(false)
const mergeSource = ref('')
const mergeNoCommit = ref(false)

function toggleMergeForm() {
  showMergeForm.value = !showMergeForm.value
  if (!showMergeForm.value) {
    mergeSource.value = ''
    mergeNoCommit.value = false
  }
}

function openMergeFromMore() {
  closeMoreMenu()
  goToTab('branches')
  showMergeForm.value = true
}

function submitMerge() {
  const source = mergeSource.value.trim()
  if (!gitReady.value || !source) return
  requestConfirm({
    message: `合并 <span class="gd-mono text-teal-300">${esc(source)}</span> 到当前分支 <span class="gd-mono text-teal-300">${esc(dash.branch.value || '—')}</span>？${gitPrecheckHtml()}`,
    confirmLabel: '确认合并',
    onConfirm: async () => {
      await dash.doMerge(source, { noCommit: mergeNoCommit.value })
      diffCache.clear()
    },
  })
}

// ─── 创建标签 ──────────────────────────────────────

const showCreateTag = ref(false)
const newTagName = ref('')
const newTagMessage = ref('')
const newTagRef = ref('')
/** 附注（true，推荐发版用）/ 轻量（false，仅 bookmark） */
const newTagAnnotated = ref(true)

const tagNameError = computed(() => {
  const name = newTagName.value.trim()
  if (!name) return ''
  if (name.startsWith('-')) return '标签名不能以 - 开头'
  if (/[\s~^:?*\[\]\\]/.test(name)) return '标签名含非法字符（空格 / ~ ^ : ? * [ ] \\）'
  if (name.includes('..')) return '标签名不能包含 ..'
  if (dash.tags.value.some((t) => t.name === name)) return `标签 ${name} 已存在`
  return ''
})

const canSubmitTag = computed(() => {
  const name = newTagName.value.trim()
  if (!name || tagNameError.value) return false
  // 附注标签要求写说明；轻量标签无需说明
  if (newTagAnnotated.value && !newTagMessage.value.trim()) return false
  return true
})

function toggleCreateTag() {
  showCreateTag.value = !showCreateTag.value
  if (!showCreateTag.value) {
    newTagName.value = ''
    newTagMessage.value = ''
    newTagRef.value = ''
    newTagAnnotated.value = true
  }
}

async function submitCreateTag() {
  if (!gitReady.value || !canSubmitTag.value) return
  const name = newTagName.value.trim()
  await dash.doCreateTag(name, {
    message: newTagAnnotated.value ? newTagMessage.value.trim() || undefined : undefined,
    ref: newTagRef.value.trim() || undefined,
  })
  showCreateTag.value = false
  newTagName.value = ''
  newTagMessage.value = ''
  newTagRef.value = ''
  newTagAnnotated.value = true
}

// ─── 标签详情（点行展开）────────────────────────────

const expandedTag = ref('')
const tagDetailLoading = ref(false)
const tagCommits = ref<GitCommit[]>([])
const tagPrevName = ref('')

/** 未推送到远端的标签数（驱动状态条 + 推送预览） */
const unpushedTagCount = computed(
  () => dash.tags.value.filter((t) => !t.onRemote).length,
)

/** 版本号样式的标签名（用于 latest 徽标，避免给 debug-xxx 误打） */
function isVersionTag(name: string): boolean {
  return /^v?\d+\.\d+/i.test(name)
}

/** tags 按日期倒序，第 idx 个的「上一个更旧的 tag」就是 idx+1 */
function previousTagOf(t: GitTag): GitTag | null {
  const idx = dash.tags.value.findIndex((x) => x.name === t.name)
  if (idx < 0 || idx >= dash.tags.value.length - 1) return null
  return dash.tags.value[idx + 1]
}

async function toggleTagDetail(t: GitTag) {
  if (!gitReady.value) return
  if (expandedTag.value === t.name) {
    expandedTag.value = ''
    tagCommits.value = []
    tagPrevName.value = ''
    return
  }
  // 展开新 tag 时关掉可能正开着的 diff，避免两块内容堆叠
  diffTarget.value = ''
  diffContent.value = ''
  expandedTag.value = t.name
  tagPrevName.value = previousTagOf(t)?.name || ''
  tagDetailLoading.value = true
  tagCommits.value = []
  try {
    const commits = await dash.getTagCommits(t.name, tagPrevName.value || undefined)
    // 防竞态：用户可能已切到别的 tag，仅当仍在展开此 tag 时回填
    if (expandedTag.value === t.name) tagCommits.value = commits
  } catch {
    if (expandedTag.value === t.name) tagCommits.value = []
  } finally {
    if (expandedTag.value === t.name) tagDetailLoading.value = false
  }
}

// ─── 标签搜索 / 排序 / 批量选择 ─────────────────────

type TagSort = 'date' | 'semver'
const tagSearch = ref('')
const tagSort = ref<TagSort>('date')

/** 把 `v1.2.3` / `1.2.3` 解析为 [major, minor, patch]，非版本号返回 null */
function parseSemver(name: string): [number, number, number] | null {
  const m = name.match(/^v?(\d+)\.(\d+)\.(\d+)/i)
  if (!m) return null
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
}

/** 语义化版本降序：版本号大的在前；版本号 tag 排在非版本号 tag 之前；同类内部稳定 */
function semverCompare(a: GitTag, b: GitTag): number {
  const sa = parseSemver(a.name)
  const sb = parseSemver(b.name)
  if (sa && sb) {
    for (let i = 0; i < 3; i++) {
      if (sa[i] !== sb[i]) return sb[i] - sa[i]
    }
    return 0
  }
  if (sa) return -1
  if (sb) return 1
  return 0
}

/** 实际渲染的标签列表：套用搜索过滤 + 排序 */
const displayedTags = computed(() => {
  const q = tagSearch.value.toLowerCase().trim()
  let list = dash.tags.value
  if (q) {
    list = list.filter(
      (t) => t.name.toLowerCase().includes(q) || t.message.toLowerCase().includes(q),
    )
  }
  if (tagSort.value === 'semver') {
    list = [...list].sort(semverCompare)
  }
  return list
})

// ─── 版本分组（仅 tagSort = semver 时启用）──────────

/** 按主版本号分组：v1.2.3 → v1.x；非版本号标签归「其他」 */
function tagGroupOf(name: string): string {
  const m = name.match(/^v?(\d+)\./i)
  return m ? `v${m[1]}.x` : '其他'
}

const collapsedGroups = ref<Set<string>>(new Set())

function toggleGroup(key: string) {
  const next = new Set(collapsedGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedGroups.value = next
}

/** 当前列表中某分组有多少条 */
function groupCount(key: string): number {
  let n = 0
  for (const t of displayedTags.value) {
    if (tagGroupOf(t.name) === key) n++
  }
  return n
}

/** displayedTags[idx] 是否是其所在分组的第一条（用于插入分组头） */
function isGroupStart(idx: number): boolean {
  if (idx === 0) return true
  return tagGroupOf(displayedTags.value[idx].name) !== tagGroupOf(displayedTags.value[idx - 1].name)
}

const TAG_GROUP_COLORS = [
  { bg: 'rgba(45,212,191,0.10)', border: 'rgba(45,212,191,0.22)', text: 'rgb(94,234,212)' },
  { bg: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.22)', text: 'rgb(216,180,254)' },
  { bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.22)', text: 'rgb(252,211,77)' },
  { bg: 'rgba(56,189,248,0.10)', border: 'rgba(56,189,248,0.22)', text: 'rgb(125,211,252)' },
  { bg: 'rgba(244,63,94,0.10)', border: 'rgba(244,63,94,0.22)', text: 'rgb(251,113,133)' },
]

/** 按分组名 hash 取稳定配色（对齐 UnifiedInbox threadColor 范式） */
function groupColor(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return TAG_GROUP_COLORS[h % TAG_GROUP_COLORS.length]
}

/** 分组头的内联 style（仅背景 + 文字色；左侧 3px 描边走 currentColor 自动取色） */
function groupStyleOf(name: string) {
  const c = groupColor(tagGroupOf(name))
  return { background: c.bg, color: c.text }
}

/** 该 tag 行是否因分组折叠而隐藏（仅版本排序时才可能折叠） */
function isTagRowHidden(name: string): boolean {
  return tagSort.value === 'semver' && collapsedGroups.value.has(tagGroupOf(name))
}

// ─── 复制检出命令 ───────────────────────────────────

const copiedTag = ref('')

async function copyCheckoutCmd(name: string) {
  const cmd = `git checkout ${name}`
  try {
    await navigator.clipboard.writeText(cmd)
  } catch {
    // 非安全上下文降级：临时 textarea + execCommand
    const ta = document.createElement('textarea')
    ta.value = cmd
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      /* noop */
    }
    document.body.removeChild(ta)
  }
  copiedTag.value = name
  setTimeout(() => {
    if (copiedTag.value === name) copiedTag.value = ''
  }, 1500)
}

// ─── 删远端 tag（危险）──────────────────────────────

function confirmDeleteRemoteTag(name: string) {
  const remote = dash.remotes.value[0]?.name || 'origin'
  requestConfirm({
    message: `删除远端标签 <span class="gd-mono text-rose-300">${esc(name)}</span>？<br><span class="text-rose-300/90 text-[12px] leading-relaxed">⚠ 这会从远端 <span class="gd-mono">${esc(remote)}</span> 删除此标签，影响所有协作者与 CI/CD，且不可撤销。如果流水线 / 发布依赖此标签，删除可能触发或破坏发布流程。建议先确认无依赖再删除。</span>`,
    confirmLabel: '删除远端标签',
    danger: true,
    onConfirm: async () => {
      await dash.doDeleteRemoteTag(name)
    },
  })
}

const showStashForm = ref(false)
const stashMessage = ref('')

function toggleStashForm() {
  showStashForm.value = !showStashForm.value
  if (!showStashForm.value) stashMessage.value = ''
}

async function submitStashPush() {
  if (!gitReady.value) return
  await dash.doStashPush(stashMessage.value.trim() || undefined)
  showStashForm.value = false
  stashMessage.value = ''
}

// ─── Reset / 回滚 ──────────────────────────────────

type ResetMode = 'soft' | 'mixed' | 'hard' | 'keep'
const RESET_MODES: ResetMode[] = ['soft', 'mixed', 'hard', 'keep']

const showResetForm = ref(false)
const resetMode = ref<string>('mixed')
const resetTarget = ref('')

function toggleResetForm() {
  showResetForm.value = !showResetForm.value
  if (!showResetForm.value) {
    resetTarget.value = ''
    resetMode.value = 'mixed'
  }
}

function openResetFromMore() {
  closeMoreMenu()
  goToTab('overview')
  showResetForm.value = true
}

function submitReset() {
  const mode = (RESET_MODES.includes(resetMode.value as ResetMode) ? resetMode.value : 'mixed') as ResetMode
  const target = resetTarget.value.trim() || undefined
  const hard = mode === 'hard'
  requestConfirm({
    message: hard
      ? `<span class="text-rose-300 font-medium">⚠ 硬回滚（hard reset）会丢弃所有未提交改动</span>，将当前分支移到 <span class="gd-mono text-teal-300">${esc(target || 'HEAD')}</span>？此操作可通过 reflog 找回提交，但工作区改动不可恢复。`
      : `以 <span class="gd-mono text-teal-300">${esc(mode)}</span> 模式 reset 到 <span class="gd-mono text-teal-300">${esc(target || 'HEAD')}</span>？${gitPrecheckHtml()}`,
    confirmLabel: '确认 Reset',
    danger: hard,
    onConfirm: async () => {
      await dash.doReset(mode, target)
      diffCache.clear()
    },
  })
}

// ─── Diff 查看 ─────────────────────────────────────

const diffLoading = ref(false)
const diffContent = ref('')
const diffTarget = ref('')
const diffCache = new Map<string, string>()

async function viewDiff(key: string, fetcher: () => Promise<string>) {
  if (!gitReady.value) return
  if (diffTarget.value === key) {
    diffTarget.value = ''
    diffContent.value = ''
    return
  }
  // 打开 diff 时关掉 blame，避免同文件两块内容堆叠
  blameTarget.value = ''
  blameLines.value = []
  const cached = diffCache.get(key)
  if (cached !== undefined) {
    diffTarget.value = key
    diffContent.value = cached
    return
  }
  diffLoading.value = true
  diffTarget.value = key
  try {
    const d = await fetcher()
    diffCache.set(key, d)
    diffContent.value = d
  } catch (e) {
    diffContent.value = `// 加载 diff 失败: ${(e as Error)?.message || e}`
  } finally {
    diffLoading.value = false
  }
}

// ─── Blame（逐行追溯）──────────────────────────────

const blameLoading = ref(false)
const blameTarget = ref('')
const blameLines = ref<GitBlameLine[]>([])

async function viewBlame(path: string) {
  if (!gitReady.value) return
  if (blameTarget.value === path) {
    blameTarget.value = ''
    blameLines.value = []
    return
  }
  // 打开 blame 时关掉 diff
  diffTarget.value = ''
  diffContent.value = ''
  blameLoading.value = true
  blameTarget.value = path
  try {
    blameLines.value = await dash.getBlame(path)
  } catch {
    blameLines.value = []
  } finally {
    blameLoading.value = false
  }
}

// ─── 文件暂存选择（Changes tab） ────────────────────

const selectedFiles = ref<Set<string>>(new Set())

watch(
  () => dash.status.value.staged,
  (staged) => {
    const next = new Set(selectedFiles.value)
    for (const f of next) {
      if (f.startsWith('staged:') && !staged.some((s) => s.path === f.slice(7))) {
        next.delete(f)
      }
    }
    for (const s of staged) {
      next.add('staged:' + s.path)
    }
    selectedFiles.value = next
  },
  { immediate: true },
)

function toggleFileSelection(key: string) {
  const next = new Set(selectedFiles.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedFiles.value = next
}

function selectAllModified() {
  const next = new Set(selectedFiles.value)
  for (const f of dash.status.value.modified) next.add('mod:' + f.path)
  for (const f of dash.status.value.untracked) next.add('untracked:' + f.path)
  selectedFiles.value = next
}

function selectAllStaged() {
  const next = new Set(selectedFiles.value)
  for (const f of dash.status.value.staged) next.add('staged:' + f.path)
  selectedFiles.value = next
}

function clearSelection() {
  selectedFiles.value = new Set()
}

const selectedModifiedCount = computed(() => {
  let n = 0
  for (const k of selectedFiles.value) {
    if (k.startsWith('mod:') || k.startsWith('untracked:')) n++
  }
  return n
})

const selectedStagedCount = computed(() => {
  let n = 0
  for (const k of selectedFiles.value) {
    if (k.startsWith('staged:')) n++
  }
  return n
})

async function stageSelected() {
  const files: string[] = []
  for (const k of selectedFiles.value) {
    if (k.startsWith('mod:') || k.startsWith('untracked:')) {
      files.push(k.includes(':') ? k.slice(k.indexOf(':') + 1) : k)
    }
  }
  if (files.length) {
    await dash.doStageFiles(files.join(','))
    diffCache.clear()
  }
}

async function unstageSelected() {
  const files: string[] = []
  for (const k of selectedFiles.value) {
    if (k.startsWith('staged:')) files.push(k.slice(7))
  }
  if (files.length) {
    await dash.doUnstageFiles(files.join(','))
    diffCache.clear()
  }
}

// ─── Commit（conventional 前缀 + 复用 + 多行）──────

const COMMIT_PREFIXES = ['feat', 'fix', 'refactor', 'docs', 'chore', 'test', 'perf', 'style', 'build', 'ci', 'revert']
const commitPrefix = ref('')
const commitMessage = ref('')

/** 拼接最终提交信息：把前缀加到首行前（首行已有 conventional 前缀则不重复） */
function buildCommitMessage(): string {
  const body = commitMessage.value.trim()
  if (!body) return ''
  if (!commitPrefix.value) return body
  const lines = body.split('\n')
  if (/^(feat|fix|refactor|docs|chore|test|perf|style|build|ci|revert)\b/.test(lines[0])) return body
  lines[0] = `${commitPrefix.value}: ${lines[0]}`
  return lines.join('\n')
}

const commitPreview = computed(() => buildCommitMessage())

function reuseLastMessage() {
  const last = dash.commits.value[0]
  if (last) commitMessage.value = last.message
}

async function doCommit() {
  const msg = buildCommitMessage()
  if (!msg || dash.status.value.staged.length === 0) return
  const r = await dash.doCommit(msg)
  if (r.success) {
    commitMessage.value = ''
    commitPrefix.value = ''
    diffCache.clear()
  }
}

async function doCommitAll() {
  const msg = buildCommitMessage()
  if (!msg || trackedChangeCount.value === 0) return
  requestConfirm({
    message: `提交已跟踪变更？<br><span class="text-white/45 text-[12px]">将执行 <span class="gd-mono text-teal-300">git commit -a</span>，只纳入已暂存文件和已跟踪文件的修改，不会自动包含未跟踪新文件。</span>${dash.status.value.untracked.length ? `<br><span class="text-amber-300/80 text-[12px]">当前还有 ${dash.status.value.untracked.length} 个未跟踪文件，若要提交请先勾选并暂存。</span>` : ''}`,
    confirmLabel: '提交已跟踪变更',
    onConfirm: async () => {
      const r = await dash.doCommit(msg, { all: true })
      if (r.success) {
        commitMessage.value = ''
        commitPrefix.value = ''
        diffCache.clear()
      }
    },
  })
}

const trackedChangeCount = computed(() =>
  dash.status.value.staged.length + dash.status.value.modified.length,
)
const canCommit = computed(() => commitPreview.value.length > 0 && dash.status.value.staged.length > 0)
const canCommitAll = computed(() => commitPreview.value.length > 0 && trackedChangeCount.value > 0)

// ─── 健康判断（可点交给小吴）────────────────────────

type HealthTone = 'ok' | 'warn' | 'danger'

const healthCue = computed<{ tone: HealthTone; title: string; detail: string; action: string }>(() => {
  const status = dash.status.value
  const sync = dash.sync.value
  const changes = status.totalChanges
  const hasUntracked = status.untracked.length > 0
  const dirtyText = status.clean
    ? '工作区干净'
    : `${changes} 个未提交变更${hasUntracked ? `，其中 ${status.untracked.length} 个未跟踪` : ''}`

  if (!dash.branch.value) {
    return { tone: 'warn', title: '正在读取 Git 状态', detail: dirtyText, action: '稍等刷新完成后再执行同步或提交操作。' }
  }
  if (!sync.hasUpstream) {
    return { tone: 'warn', title: '当前分支还没有 upstream', detail: dirtyText, action: '确认基线后发布分支；普通 Push 可能因为缺少上游分支失败。' }
  }
  if (sync.ahead > 0 && sync.behind > 0) {
    return {
      tone: 'danger',
      title: '本地与远端已经分叉',
      detail: `领先 ${sync.ahead} 个提交，落后 ${sync.behind} 个提交；${dirtyText}`,
      action: status.clean ? '先检查差异再同步，避免覆盖协作中的改动。' : '建议先提交或 Stash 本地变更，再处理同步。',
    }
  }
  if (sync.behind > 0) {
    return {
      tone: 'warn',
      title: `远端有 ${sync.behind} 个新提交`,
      detail: dirtyText,
      action: status.clean ? '可以 Pull 同步远端更新。' : '建议先提交或 Stash 本地变更，再 Pull。',
    }
  }
  if (sync.ahead > 0) {
    return { tone: 'warn', title: `本地有 ${sync.ahead} 个提交待推送`, detail: dirtyText, action: '确认提交内容后再 Push 到远端。' }
  }
  if (!status.clean) {
    return {
      tone: 'warn',
      title: `工作区有 ${changes} 个未提交变更`,
      detail: hasUntracked ? `包含 ${status.untracked.length} 个未跟踪文件，提交前确认是否纳入。` : '远端已同步，下一步重点是 review 与提交。',
      action: '先检查 diff，再按需暂存并提交。',
    }
  }
  return { tone: 'ok', title: '仓库状态安全', detail: '工作区干净，当前分支已与远端同步。', action: '可以安全切换分支或继续开发。' }
})

// ─── 小吴（AI）hand-off：健康概况 / 冲突 / diff ─────

function askXiaowuHealth() {
  if (!aiReady.value) return
  const h = healthCue.value
  const ctx = `Git 仓库（${repoName.value} / 分支 ${dash.branch.value || '—'}）健康概况：${h.title}。${h.detail} 我的建议是：${h.action} 帮我判断这事要不要紧，如果有风险帮我排出处理顺序。`
  chat.show()
  void chat.send(ctx)
}

function askXiaowuConflict() {
  if (!aiReady.value) return
  const r = dash.lastActionResult.value
  const out = (r?.error || r?.message || '').slice(0, 1500)
  chat.show()
  void chat.send(`刚才执行 git 操作时产生了冲突。这是 git 的原始输出：\n\n${out}\n\n帮我分析冲突的根因，并给出解决思路（不要直接改代码，先告诉我怎么判断）。`)
}

function askXiaowuDiff() {
  if (!aiReady.value || !diffContent.value) return
  const target = diffTarget.value
  const snippet = diffContent.value.slice(0, 2000)
  chat.show()
  void chat.send(`解释下面这段 git diff（${target}）的目的、改了什么、有没有潜在风险：\n\n${snippet}`)
}

/** 让小吴基于「自上一 tag 以来的提交」生成发版说明 */
function askXiaowuReleaseNotes(tagName: string, commits: GitCommit[]) {
  if (!aiReady.value) return
  const trimmed = commits.slice(0, 40)
  const list = trimmed.map((c) => `- ${c.hash} ${c.message}（@${c.author}）`).join('\n')
  const range = tagPrevName.value ? `自 ${tagPrevName.value} 以来` : '此版本累积'
  const note = `仓库 ${repoName.value}（分支 ${dash.branch.value || '—'}）准备发版标签 ${tagName}。请基于下面${range}的提交列表，生成一份发版说明（release notes）：

要求：
1. 开头一句话整体总结这版的主线（是什么版本、为什么发）
2. 按类型分组：✨ 新功能 / 🐛 修复 / ♻️ 重构 / ⚡ 性能 / 🔧 构建·杂项，无内容的组省略
3. 每条用一句话概括，去掉 commit hash，合并重复项，保留负责人
4. 末尾如发现破坏性变更、需要手动迁移、或风险点，单独用 ⚠️ 标注并说明影响
5. 用 Markdown 输出，可直接贴到 release / 群通知

提交列表（共 ${commits.length} 条${commits.length > 40 ? '，仅取最近 40 条' : ''}）：
${list || '（无提交）'}`
  chat.show()
  void chat.send(note)
}

// ─── Reflog（操作历史，救命用）──────────────────────

const showReflog = ref(false)
const reflogLoading = ref(false)
const reflog = ref<GitReflogEntry[]>([])

async function loadReflog() {
  if (reflog.value.length) return
  reflogLoading.value = true
  try {
    reflog.value = await dash.getReflog(40)
  } finally {
    reflogLoading.value = false
  }
}

function toggleReflog() {
  showReflog.value = !showReflog.value
  if (showReflog.value) void loadReflog()
}

// ─── Commit 搜索（--grep）───────────────────────────

const commitSearch = ref('')
const searchResults = ref<GitCommit[] | null>(null)
const searchLoading = ref(false)

async function runCommitSearch() {
  const q = commitSearch.value.trim()
  if (!q) {
    searchResults.value = null
    return
  }
  searchLoading.value = true
  try {
    searchResults.value = await dash.searchCommits(q, 30)
  } finally {
    searchLoading.value = false
  }
}

function clearCommitSearch() {
  commitSearch.value = ''
  searchResults.value = null
}

// ─── Pull/Push 预览：ahead / behind 实际 commit ─────

const aheadCommits = computed(() => dash.commits.value.slice(0, Math.max(0, dash.sync.value.ahead)))

const behindCommits = ref<GitCommit[]>([])
const behindLoading = ref(false)

async function loadBehindCommits() {
  const sync = dash.sync.value
  if (!sync.hasUpstream || sync.behind === 0) {
    behindCommits.value = []
    return
  }
  const cur = dash.branches.value.find((b) => b.current)
  const up = cur?.upstream
  if (!up) {
    behindCommits.value = []
    return
  }
  behindLoading.value = true
  try {
    behindCommits.value = await dash.getBranchLog(up, sync.behind)
  } catch {
    behindCommits.value = []
  } finally {
    behindLoading.value = false
  }
}

// ─── 格式化 ────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH} 小时前`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7) return `${diffD} 天前`
    if (diffD < 30) return `${Math.floor(diffD / 7)} 周前`
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}

function shortMsg(msg: string, max = 60): string {
  return msg.length > max ? msg.slice(0, max) + '…' : msg
}

function fileName(p: string): string {
  return p.split('/').pop() || p
}
function fileDir(p: string): string {
  const parts = p.split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : ''
}

/** 把 remote URL 压缩成 host/path 形式（SSH 与 HTTPS 都兼容） */
function shortUrl(u: string): string {
  if (!u) return ''
  const ssh = u.match(/^[\w.-]+@([^:]+):(.+)$/)
  if (ssh) return `${ssh[1]}/${ssh[2].replace(/\.git$/, '')}`
  try {
    const url = new URL(u)
    return (url.host + url.pathname).replace(/\.git$/, '')
  } catch {
    return u
  }
}

// ─── 统一确认栏 ────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function gitPrecheckHtml(): string {
  const current = dash.branches.value.find((b) => b.current)
  const sync = dash.sync.value
  const upstream = sync.hasUpstream ? current?.upstream || '已设置 upstream' : '无 upstream'
  const syncText = sync.hasUpstream ? `${upstream} · ↑${sync.ahead} ↓${sync.behind}` : upstream
  const status = dash.status.value
  const changeText = status.clean
    ? '工作区干净'
    : `${status.totalChanges} 个未提交变更（已暂存 ${status.staged.length} · 已修改 ${status.modified.length} · 未跟踪 ${status.untracked.length}）`
  return `<br><span class="text-white/45 text-[12px]">当前分支 <span class="gd-mono text-teal-300">${esc(dash.branch.value || '—')}</span> · ${esc(syncText)} · ${esc(changeText)}</span>`
}

function aheadCommitsHtml(): string {
  const list = aheadCommits.value
  if (!list.length) return ''
  const items = list
    .slice(0, 8)
    .map((c) => `<li><span class="gd-mono text-amber-300">${esc(c.hash)}</span> <span class="text-white/70">${esc(shortMsg(c.message, 48))}</span></li>`)
    .join('')
  const more = list.length > 8 ? `<li class="text-white/30">…共 ${list.length} 条</li>` : ''
  return `<br><span class="text-white/45 text-[12px]">将推送的提交（${list.length}）：</span><ul class="gd-preview-list">${items}${more}</ul>`
}

function behindCommitsHtml(): string {
  if (behindLoading.value) return `<br><span class="text-white/45 text-[12px]">正在读取远端待拉取提交…</span>`
  const list = behindCommits.value
  if (!list.length) return ''
  const items = list
    .slice(0, 8)
    .map((c) => `<li><span class="gd-mono text-sky-300">${esc(c.hash)}</span> <span class="text-white/70">${esc(shortMsg(c.message, 48))}</span></li>`)
    .join('')
  const more = list.length > 8 ? `<li class="text-white/30">…共 ${list.length} 条</li>` : ''
  return `<br><span class="text-white/45 text-[12px]">将拉取的提交（${list.length}）：</span><ul class="gd-preview-list">${items}${more}</ul>`
}

interface ConfirmDialog {
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
}

const confirmDialog = ref<ConfirmDialog | null>(null)

function requestConfirm(dialog: ConfirmDialog) {
  confirmDialog.value = dialog
}

async function executeConfirm() {
  if (!confirmDialog.value) return
  const cb = confirmDialog.value.onConfirm
  confirmDialog.value = null
  await cb()
}

function cancelConfirm() {
  confirmDialog.value = null
}

// ─── 便捷确认：分支 ────────────────────────────────

function confirmSwitchBranch(name: string) {
  if (name === dash.branch.value) return
  const dirty = !dash.status.value.clean
  const warning = dirty
    ? `<br><span class="text-amber-300/90 text-[12px]">⚠ 工作区有 ${dash.status.value.totalChanges} 个未提交变更，切换可能被 git 拒绝、或被带入目标分支。建议先提交或 Stash。</span>`
    : ''
  requestConfirm({
    message: `切换到 <span class="gd-mono text-teal-300">${esc(name)}</span>？${warning}`,
    confirmLabel: '确认切换',
    onConfirm: async () => {
      await dash.doCheckout(name)
      diffCache.clear()
    },
  })
}

function confirmCheckoutRemote(remoteName: string) {
  const short = shortRemoteName(remoteName)
  requestConfirm({
    message: `创建本地跟踪分支 <span class="gd-mono text-teal-300">${esc(short)}</span> 并切换？`,
    confirmLabel: '检出',
    onConfirm: async () => {
      await dash.doCheckout(short)
      diffCache.clear()
    },
  })
}

function confirmDeleteBranch(name: string) {
  const b = dash.branches.value.find((x) => x.name === name)
  const unmerged = !!(b && b.ahead > 0)
  const warning = unmerged
    ? `<br><span class="text-amber-300/90 text-[12px]">⚠ 该分支领先 upstream ${b!.ahead} 个提交，可能含未合并工作；git 默认会拒绝删除未合并分支，必要时可用强制删除。</span>`
    : ''
  requestConfirm({
    message: `删除分支 <span class="gd-mono text-rose-300">${esc(name)}</span>？此操作不可撤销${warning}`,
    confirmLabel: '删除',
    danger: true,
    onConfirm: async () => {
      await dash.doDeleteBranch(name)
    },
  })
}

// ─── 便捷确认：标签 / Stash ────────────────────────

function confirmDeleteTag(name: string) {
  requestConfirm({
    message: `删除标签 <span class="gd-mono text-rose-300">${esc(name)}</span>？${
      dash.tags.value.find((t) => t.name === name)?.onRemote
        ? '<br><span class="text-white/45 text-[12px]">仅删除本地标签，远端不受影响（如需删远端用 <span class="gd-mono">git push origin --delete</span>）。</span>'
        : ''
    }`,
    confirmLabel: '删除',
    danger: true,
    onConfirm: async () => {
      await dash.doDeleteTag(name)
      if (expandedTag.value === name) expandedTag.value = ''
    },
  })
}

/** 推送单个标签到远端（git push <remote> <tag>） */
function confirmPushTag(name: string) {
  const remote = dash.remotes.value[0]?.name || 'origin'
  requestConfirm({
    message: `推送标签 <span class="gd-mono text-violet-300">${esc(name)}</span> 到远端 <span class="gd-mono text-teal-300">${esc(remote)}</span>？${gitPrecheckHtml()}`,
    confirmLabel: '推送',
    onConfirm: async () => {
      await dash.doPushTag(name)
    },
  })
}

/** 检出标签（进入 detached HEAD，用于回滚排查 / 历史构建） */
function confirmCheckoutTag(name: string) {
  const dirty = !dash.status.value.clean
  const warning = dirty
    ? `<br><span class="text-amber-300/90 text-[12px]">⚠ 工作区有 ${dash.status.value.totalChanges} 个未提交变更，检出可能被 git 拒绝或带入目标。建议先提交或 Stash。</span>`
    : `<br><span class="text-white/45 text-[12px]">检出标签会进入分离头指针（detached HEAD）状态，适合查看 / 构建 / 回滚排查；若要在此处继续开发，请另建分支 <span class="gd-mono">git checkout -b &lt;新分支&gt; ${esc(name)}</span>。</span>`
  requestConfirm({
    message: `检出标签 <span class="gd-mono text-violet-300">${esc(name)}</span>？${warning}`,
    confirmLabel: '确认检出',
    onConfirm: async () => {
      await dash.doCheckout(name)
      diffCache.clear()
    },
  })
}

function confirmDropStash(index: string) {
  requestConfirm({
    message: `丢弃 <span class="gd-mono text-rose-300">${esc(index)}</span>？此操作不可撤销`,
    confirmLabel: '丢弃',
    danger: true,
    onConfirm: async () => {
      await dash.doStashDrop(index)
    },
  })
}

function confirmStashApply(index: string) {
  requestConfirm({
    message: `应用 <span class="gd-mono text-teal-300">${esc(index)}</span> 到当前工作区？stash 会保留。${gitPrecheckHtml()}`,
    confirmLabel: '应用 stash',
    onConfirm: async () => {
      await dash.doStashApply(index)
      diffCache.clear()
    },
  })
}

function confirmStashPop(index = 'stash@{0}') {
  closeMoreMenu()
  requestConfirm({
    message: `弹出 <span class="gd-mono text-amber-300">${esc(index)}</span>？将应用变更并从 stash 列表删除。${gitPrecheckHtml()}`,
    confirmLabel: '弹出 stash',
    onConfirm: async () => {
      await dash.doStashPop()
      diffCache.clear()
    },
  })
}

// ─── 便捷确认：同步（带 commit 预览）──────────────

async function confirmPull() {
  closeMoreMenu()
  await loadBehindCommits()
  requestConfirm({
    message: `拉取并合并远端更新？${gitPrecheckHtml()}${behindCommitsHtml()}`,
    confirmLabel: '确认 Pull',
    onConfirm: async () => {
      await dash.doPull()
      diffCache.clear()
    },
  })
}

function confirmPush() {
  closeMoreMenu()
  requestConfirm({
    message: `推送本地提交到远端？${gitPrecheckHtml()}${aheadCommitsHtml()}`,
    confirmLabel: '确认 Push',
    onConfirm: async () => {
      await dash.doPush()
      diffCache.clear()
    },
  })
}

function confirmPushTags() {
  closeMoreMenu()
  const n = unpushedTagCount.value
  const preview = n > 0
    ? `<br><span class="text-white/45 text-[12px]">将推送 <span class="text-amber-300 font-medium">${n}</span> 个未同步标签到远端（<span class="gd-mono">git push --tags</span>）。</span>`
    : `<br><span class="text-white/45 text-[12px]">所有标签均已同步，无需推送。</span>`
  requestConfirm({
    message: `推送所有本地标签到远端？${gitPrecheckHtml()}${preview}`,
    confirmLabel: '推送标签',
    onConfirm: async () => {
      await dash.doPushTags()
    },
  })
}

// ─── 便捷确认：变更（放弃修改）─────────────────────

function confirmDiscard(path: string, untracked: boolean) {
  requestConfirm({
    message: untracked
      ? `删除未跟踪文件 <span class="gd-mono text-rose-300">${esc(path)}</span>？此操作不可撤销`
      : `放弃 <span class="gd-mono text-rose-300">${esc(path)}</span> 的修改？将恢复到上次提交的状态，未提交改动不可恢复。`,
    confirmLabel: untracked ? '删除文件' : '放弃修改',
    danger: true,
    onConfirm: async () => {
      await dash.doDiscard(path, untracked)
      diffCache.clear()
      blameTarget.value = ''
      blameLines.value = []
    },
  })
}

// ─── 便捷确认：历史操作（revert / cherry-pick）─────

function confirmRevert(c: GitCommit) {
  requestConfirm({
    message: `撤销提交 <span class="gd-mono text-teal-300">${esc(c.hash)}</span>？将生成一个反向提交。<br><span class="text-white/45 text-[12px]">${esc(shortMsg(c.message, 50))}</span>`,
    confirmLabel: 'Revert',
    onConfirm: async () => {
      await dash.doRevert(c.fullHash)
      diffCache.clear()
    },
  })
}

function confirmCherryPick(c: GitCommit) {
  requestConfirm({
    message: `摘取提交 <span class="gd-mono text-teal-300">${esc(c.hash)}</span> 到当前分支 <span class="gd-mono text-teal-300">${esc(dash.branch.value || '—')}</span>？<br><span class="text-white/45 text-[12px]">${esc(shortMsg(c.message, 50))}</span>`,
    confirmLabel: 'Cherry-pick',
    onConfirm: async () => {
      await dash.doCherryPick(c.fullHash)
      diffCache.clear()
    },
  })
}

// ─── Header 操作 ───────────────────────────────────

async function handleFetch() {
  closeMoreMenu()
  await dash.doFetch()
  diffCache.clear()
}
async function handleStashPush() {
  closeMoreMenu()
  await dash.doStashPush()
}
async function handleRefresh() {
  await dash.refresh()
  diffCache.clear()
}

// ─── 打开/关闭 + 焦点管理 ──────────────────────────

const dialogRef = ref<HTMLElement | null>(null)
let lastActiveElement: HTMLElement | null = null

function getFocusable(): HTMLElement[] {
  const root = dialogRef.value
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (showMoreMenu.value) {
      showMoreMenu.value = false
      e.stopPropagation()
      return
    }
    if (confirmDialog.value) {
      cancelConfirm()
      e.stopPropagation()
      return
    }
    close()
    return
  }
  if (e.key === 'Tab' && dialogRef.value) {
    const f = getFocusable()
    if (!f.length) return
    const first = f[0]
    const last = f[f.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      dash.open.value = true
      lastActiveElement = document.activeElement as HTMLElement | null
      void nextTick(() => {
        const f = getFocusable()
        f[0]?.focus()
      })
    } else {
      dash.open.value = false
      diffTarget.value = ''
      diffContent.value = ''
      blameTarget.value = ''
      blameLines.value = []
      confirmDialog.value = null
      showMoreMenu.value = false
      showCreateBranch.value = false
      showMergeForm.value = false
      showCreateTag.value = false
      showStashForm.value = false
      showResetForm.value = false
      showReflog.value = false
      lastActiveElement?.focus?.()
      lastActiveElement = null
    }
  },
)

onUnmounted(() => {
  dash.open.value = false
})

function close() {
  emit('update:open', false)
}

/** 遮罩点击：More/Reset 等浮层开着时只关浮层，否则关弹窗（卡片自身 @click.stop） */
function onBackdropClick() {
  if (showMoreMenu.value) {
    showMoreMenu.value = false
    return
  }
  close()
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      leave-active-class="transition-opacity duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        ref="dialogRef"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-dashboard-title"
        tabindex="-1"
        @keydown="onKeydown"
        @click="onBackdropClick"
      >
        <div class="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />

        <Transition
          appear
          enter-active-class="transition-all duration-300 ease-out"
          leave-active-class="transition-all duration-200 ease-in"
          enter-from-class="opacity-0 translate-y-3 scale-[0.97]"
          leave-to-class="opacity-0 translate-y-2 scale-[0.98]"
        >
          <div
            class="gd-card relative z-10 w-[94vw] max-w-[960px] min-h-[70vh] max-h-[90vh] flex flex-col overflow-hidden"
            @click.stop
          >
            <!-- HUD 四角装饰 -->
            <div class="gd-corners" aria-hidden="true" />
            <!-- 顶部渐变高光条 -->
            <div class="gd-accent" />

            <!-- ═══ 头部 ═══ -->
            <div class="flex-shrink-0 px-6 pt-5 pb-3">
              <div class="flex items-start gap-3">
                <div class="flex-shrink-0 mt-0.5">
                  <div class="w-9 h-9 rounded-xl bg-teal-400/10 border border-teal-400/20 flex items-center justify-center">
                    <IconBranch class="w-5 h-5 text-teal-300" />
                  </div>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <h2 id="git-dashboard-title" class="text-[15px] font-semibold text-white/90">{{ repoName }}</h2>
                    <span class="gd-badge">Git</span>
                  </div>
                  <div class="flex items-center gap-3 mt-1 text-[12px] text-white/45 min-w-0">
                    <span class="flex items-center gap-1 flex-shrink-0">
                      <IconBranch class="w-3 h-3" />
                      <span class="gd-mono text-teal-300">{{ dash.branch.value || '—' }}</span>
                    </span>
                    <template v-if="dash.sync.value.hasUpstream">
                      <span v-if="dash.sync.value.ahead" class="text-amber-300">↑{{ dash.sync.value.ahead }}</span>
                      <span v-if="dash.sync.value.behind" class="text-sky-300">↓{{ dash.sync.value.behind }}</span>
                      <span v-if="!dash.sync.value.ahead && !dash.sync.value.behind" class="text-emerald-400/70">
                        <IconCheck class="w-3 h-3" />
                      </span>
                    </template>
                    <span v-else class="text-white/30">无 upstream</span>
                    <span
                      v-if="dash.remotes.value.length"
                      class="truncate text-white/35"
                      :title="dash.remotes.value[0].url"
                    >
                      {{ shortUrl(dash.remotes.value[0].url) }}
                    </span>
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    class="gd-action"
                    :class="{ 'is-loading': dash.actionLoading.value === 'fetch' }"
                    title="拉取远端引用（不合并）— git fetch --all --prune"
                    aria-label="拉取远端引用，不合并"
                    :disabled="!!dash.actionLoading.value || !gitReady"
                    @click="handleFetch"
                  >
                    <IconDownload class="w-3.5 h-3.5" />
                    <span>Fetch</span>
                  </button>
                  <button
                    class="gd-action"
                    :class="{ 'is-loading': dash.actionLoading.value === 'pull' }"
                    title="拉取并合并远端更新 — git pull"
                    aria-label="拉取并合并远端更新"
                    :disabled="!!dash.actionLoading.value || !gitReady"
                    @click="confirmPull"
                  >
                    <IconSwitch class="w-3.5 h-3.5" />
                    <span>Pull</span>
                  </button>
                  <button
                    class="gd-action"
                    :class="{ 'is-loading': dash.actionLoading.value === 'push' }"
                    title="推送本地提交到远端 — git push"
                    aria-label="推送本地提交到远端"
                    :disabled="!!dash.actionLoading.value || !gitReady"
                    @click="confirmPush"
                  >
                    <IconUpload class="w-3.5 h-3.5" />
                    <span>Push</span>
                  </button>

                  <!-- More 下拉（去重：不再重复 Fetch/Pull/Push） -->
                  <div class="relative">
                    <button
                      class="gd-action"
                      title="更多操作"
                      aria-label="打开更多 Git 操作"
                      :disabled="!!dash.actionLoading.value || !gitReady"
                      @click.stop="toggleMoreMenu"
                    >
                      <span>More</span>
                      <IconChevronDown class="w-3 h-3" :class="{ 'rotate-180': showMoreMenu }" />
                    </button>
                    <Transition
                      enter-active-class="transition-all duration-150 ease-out"
                      leave-active-class="transition-all duration-100 ease-in"
                      enter-from-class="opacity-0 -translate-y-1"
                      leave-to-class="opacity-0 -translate-y-1"
                    >
                      <div v-if="showMoreMenu" class="gd-dropdown">
                        <button class="gd-dropdown-item" @click="confirmPushTags">
                          <IconTag class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">推送所有标签</span>
                          <span class="gd-dropdown-hint">git push --tags</span>
                        </button>
                        <button class="gd-dropdown-item" @click="handleStashPush">
                          <IconStash class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">Stash 所有变更</span>
                          <span class="gd-dropdown-hint">git stash</span>
                        </button>
                        <button class="gd-dropdown-item" @click="confirmStashPop()">
                          <IconPop class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">Pop 最近 Stash</span>
                          <span class="gd-dropdown-hint">git stash pop</span>
                        </button>
                        <div class="gd-dropdown-divider" />
                        <button class="gd-dropdown-item" @click="openMergeFromMore">
                          <IconMerge class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">合并分支…</span>
                          <span class="gd-dropdown-hint">git merge</span>
                        </button>
                        <button class="gd-dropdown-item danger" @click="openResetFromMore">
                          <IconReset class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">回滚（Reset）…</span>
                          <span class="gd-dropdown-hint">git reset</span>
                        </button>
                      </div>
                    </Transition>
                  </div>

                  <div class="w-px h-4 bg-white/10 mx-1" />
                  <button
                    class="gd-icon-btn"
                    title="刷新"
                    aria-label="刷新 Git 仓库状态"
                    :disabled="dash.loading.value"
                    @click="handleRefresh"
                  >
                    <IconRefresh class="w-3.5 h-3.5" :class="{ 'gd-spin': dash.loading.value }" />
                  </button>
                  <button
                    class="gd-icon-btn"
                    aria-label="关闭 Git 仪表盘"
                    @click="close"
                  >
                    <IconClose class="w-5 h-5" />
                  </button>
                </div>
              </div>

              <!-- 操作反馈 -->
              <Transition
                enter-active-class="transition-all duration-200"
                leave-active-class="transition-all duration-150"
                enter-from-class="opacity-0 -translate-y-1"
                leave-to-class="opacity-0 -translate-y-1"
              >
                <div
                  v-if="dash.actionMessage.value"
                  class="mt-2 px-3 py-1.5 rounded-lg text-[12px] flex items-center gap-2"
                  :class="actionBannerClass"
                >
                  <IconLoading v-if="dash.actionLoading.value" class="w-3 h-3 gd-spin" />
                  <span class="flex-1 min-w-0">{{ dash.actionMessage.value }}</span>
                  <button
                    v-if="dash.actionStatus.value === 'conflict' && aiReady"
                    class="gd-handoff-btn"
                    @click="askXiaowuConflict"
                  >
                    <IconRobot class="w-3 h-3" />
                    <span>让小吴帮我理冲突</span>
                  </button>
                </div>
              </Transition>

              <!-- 标签页导航 -->
              <div class="flex gap-1 mt-3 -mb-px">
                <button
                  v-for="tab in TABS"
                  :key="tab.key"
                  class="gd-tab"
                  :class="{ active: activeTab === tab.key }"
                  @click="activeTab = tab.key"
                >
                  {{ tab.label }}
                  <span v-if="tab.key === 'changes' && dash.status.value.totalChanges > 0" class="gd-tab-badge">
                    {{ dash.status.value.totalChanges }}
                  </span>
                </button>
              </div>
            </div>

            <!-- ═══ 主体 ═══ -->
            <div class="flex-1 min-h-0 overflow-y-auto gd-body">
              <!-- 加载中 -->
              <div v-if="dash.loading.value && !dash.overview.value" class="flex flex-col items-center gap-3 py-20 text-white/50">
                <IconLoading class="w-7 h-7 gd-spin text-teal-300/70" />
                <span class="text-sm">加载仓库信息…</span>
              </div>

              <!-- Git 未连接 / 不可用 -->
              <div v-else-if="gitUnavailable" class="flex flex-col items-center gap-4 py-16 text-center text-white/60">
                <IconAlert class="w-10 h-10 text-rose-300/80" />
                <div class="space-y-1 px-6">
                  <p class="text-sm font-medium text-rose-200">{{ dash.error.value || 'Git 仓库暂不可用' }}</p>
                  <p class="text-[12px] text-white/42">请确认连接配置后重试：</p>
                </div>
                <ul class="gd-connect-checklist">
                  <li>.env 中配置了 <span class="gd-mono">VITE_WBSCF_WEB_ROOT</span></li>
                  <li>该路径指向 wbscf-web 根目录，且目录内存在 <span class="gd-mono">.git</span></li>
                  <li>修改 .env 后已重启 <span class="gd-mono">npm run dev</span></li>
                </ul>
                <button class="gd-confirm-btn ok" :disabled="dash.loading.value" @click="handleRefresh">
                  {{ dash.loading.value ? '正在重试…' : '重新连接' }}
                </button>
              </div>

              <!-- ─── 概览 ─── -->
              <div v-else-if="activeTab === 'overview'" class="space-y-5 p-5">
                <!-- 仓库健康判断（可点交给小吴） -->
                <div class="gd-health-wrap">
                  <div class="gd-health" :class="`tone-${healthCue.tone}`" :title="aiReady ? '点击让小吴排出处理顺序' : ''">
                    <div class="gd-health-icon">
                      <IconCheck v-if="healthCue.tone === 'ok'" class="w-4 h-4" />
                      <IconAlert v-else class="w-4 h-4" />
                    </div>
                    <div class="min-w-0 flex-1 cursor-pointer" :class="{ 'gd-clickable': aiReady }" @click="aiReady && askXiaowuHealth()">
                      <div class="gd-health-title">{{ healthCue.title }}</div>
                      <div class="gd-health-detail">{{ healthCue.detail }}</div>
                      <div class="gd-health-action">{{ healthCue.action }}</div>
                    </div>
                    <button
                      v-if="aiReady"
                      class="gd-handoff-btn flex-shrink-0"
                      title="把当前仓库状况交给小吴"
                      @click.stop="askXiaowuHealth"
                    >
                      <IconRobot class="w-3 h-3" />
                      <span>让小吴排一下</span>
                    </button>
                  </div>
                </div>

                <!-- Reset 表单（从 More 触发） -->
                <Transition
                  enter-active-class="transition-all duration-200"
                  leave-active-class="transition-all duration-150"
                  enter-from-class="opacity-0 -translate-y-2"
                  leave-to-class="opacity-0 -translate-y-2"
                >
                  <div v-if="showResetForm" class="gd-inline-form gd-danger-zone">
                    <div class="gd-section-title text-rose-300/80">
                      <IconReset class="w-3.5 h-3.5" />
                      回滚（Reset）
                    </div>
                    <div class="gd-form-row">
                      <select v-model="resetMode" class="gd-input w-auto">
                        <option value="soft">soft · 保留工作区与暂存区</option>
                        <option value="mixed">mixed · 保留工作区，清暂存区</option>
                        <option value="hard">hard · ⚠ 清除工作区与暂存区</option>
                        <option value="keep">keep · 保留工作区与暂存区</option>
                      </select>
                      <input v-model="resetTarget" type="text" placeholder="目标 ref（可选，默认 HEAD）" class="gd-input flex-1" @keydown.enter="submitReset" />
                      <button class="gd-confirm-btn danger" @click="submitReset">执行 Reset</button>
                      <button class="gd-confirm-btn cancel" @click="toggleResetForm">取消</button>
                    </div>
                    <p class="text-[11px] text-rose-300/70 mt-1.5">⚠ Reset 会改写当前分支位置；hard 模式会丢失未提交改动。可通过「提交」tab 的 reflog 找回。</p>
                  </div>
                </Transition>

                <!-- 统计卡片 -->
                <div class="grid grid-cols-4 gap-3">
                  <div class="gd-stat">
                    <div class="gd-stat-label">已暂存</div>
                    <div class="gd-stat-value text-emerald-400">{{ dash.status.value.staged.length }}</div>
                  </div>
                  <div class="gd-stat">
                    <div class="gd-stat-label">已修改</div>
                    <div class="gd-stat-value text-amber-400">{{ dash.status.value.modified.length }}</div>
                  </div>
                  <div class="gd-stat">
                    <div class="gd-stat-label">未跟踪</div>
                    <div class="gd-stat-value text-sky-400">{{ dash.status.value.untracked.length }}</div>
                  </div>
                  <div class="gd-stat">
                    <div class="gd-stat-label">同步</div>
                    <div class="gd-stat-value">
                      <template v-if="dash.sync.value.hasUpstream">
                        <span v-if="dash.sync.value.ahead" class="text-amber-400">↑{{ dash.sync.value.ahead }}</span>
                        <span v-if="dash.sync.value.behind" class="text-sky-400"> ↓{{ dash.sync.value.behind }}</span>
                        <span v-if="!dash.sync.value.ahead && !dash.sync.value.behind" class="text-emerald-400">✓</span>
                      </template>
                      <span v-else class="text-white/30 text-sm">—</span>
                    </div>
                  </div>
                </div>

                <!-- 色彩语义 legend -->
                <div class="gd-legend">
                  <IconInfo class="w-3 h-3 text-white/30 flex-shrink-0" />
                  <span><i class="gd-dot bg-emerald-400" /> 已暂存 / 已同步</span>
                  <span><i class="gd-dot bg-amber-400" /> 已修改 / 领先 ↑</span>
                  <span><i class="gd-dot bg-sky-400" /> 未跟踪 / 落后 ↓</span>
                  <span><i class="gd-dot bg-rose-400" /> 危险 / 冲突</span>
                  <span><i class="gd-dot bg-violet-400" /> 标签</span>
                </div>

                <!-- 最近提交 -->
                <div>
                  <div class="gd-section-title">
                    <IconCommit class="w-3.5 h-3.5" />
                    最近提交
                  </div>
                  <div class="gd-list">
                    <div
                      v-for="c in dash.commits.value.slice(0, 8)"
                      :key="c.fullHash"
                      class="gd-list-row group cursor-pointer"
                      @click="viewDiff(`commit-${c.fullHash}`, () => dash.getCommitDetail(c.fullHash))"
                    >
                      <span class="gd-hash">{{ c.hash }}</span>
                      <span class="flex-1 truncate text-white/75">{{ shortMsg(c.message, 55) }}</span>
                      <span class="text-white/35 text-[11px] flex-shrink-0">{{ c.author }}</span>
                      <span class="text-white/30 text-[11px] flex-shrink-0 w-16 text-right">{{ fmtDate(c.date) }}</span>
                      <div class="gd-row-actions">
                        <button
                          v-if="aiReady"
                          class="gd-mini-btn"
                          title="摘取此提交到当前分支"
                          :aria-label="`Cherry-pick ${c.hash}`"
                          @click.stop="confirmCherryPick(c)"
                        >
                          <IconCherryPick class="w-3 h-3" />
                        </button>
                        <button
                          class="gd-mini-btn"
                          title="生成反向提交撤销此变更"
                          :aria-label="`Revert ${c.hash}`"
                          @click.stop="confirmRevert(c)"
                        >
                          <IconRevert class="w-3 h-3" />
                        </button>
                      </div>
                      <IconChevronRight
                        class="w-3.5 h-3.5 text-white/20 flex-shrink-0 transition-transform"
                        :class="{ 'rotate-90 text-teal-400/60': diffTarget === `commit-${c.fullHash}` }"
                      />
                    </div>
                    <GitDiffBox
                      v-if="diffTarget.startsWith('commit-')"
                      :content="diffContent"
                      :loading="diffLoading"
                      :ai-ready="aiReady"
                      @explain="askXiaowuDiff"
                    />
                  </div>
                </div>

                <!-- 分支快照 -->
                <div>
                  <div class="gd-section-title">
                    <IconBranch class="w-3.5 h-3.5" />
                    分支 ({{ dash.branches.value.length }})
                  </div>
                  <div class="gd-list">
                    <div
                      v-for="b in dash.branches.value.slice(0, 6)"
                      :key="b.name"
                      class="gd-list-row"
                      :class="{ 'is-current': b.current }"
                    >
                      <IconBranch class="w-3.5 h-3.5 flex-shrink-0" :class="b.current ? 'text-teal-400' : 'text-white/30'" />
                      <span class="gd-mono flex-1 truncate" :class="b.current ? 'text-teal-300' : 'text-white/70'">{{ b.name }}</span>
                      <span class="gd-hash flex-shrink-0">{{ b.hash }}</span>
                      <span v-if="b.ahead" class="text-amber-400/80 text-[11px]">↑{{ b.ahead }}</span>
                      <span v-if="b.behind" class="text-sky-400/80 text-[11px]">↓{{ b.behind }}</span>
                      <span class="text-white/35 text-[11px] truncate max-w-[200px]">{{ shortMsg(b.message, 40) }}</span>
                    </div>
                  </div>
                </div>

                <!-- 远端信息（从 tags tab 归位到概览） -->
                <div>
                  <div class="gd-section-title">
                    <IconSync class="w-3.5 h-3.5" />
                    远端 ({{ dash.remotes.value.length }})
                  </div>
                  <div class="gd-list">
                    <div v-for="r in dash.remotes.value" :key="r.name" class="gd-list-row">
                      <span class="gd-mono text-teal-300/70 flex-shrink-0">{{ r.name }}</span>
                      <span class="flex-1 truncate text-white/45 text-[12px] gd-mono" :title="r.url">{{ shortUrl(r.url) }}</span>
                    </div>
                    <div v-if="!dash.remotes.value.length" class="py-4 text-center text-white/30 text-[12px]">未配置远端</div>
                  </div>
                </div>
              </div>

              <!-- ─── 分支 ─── -->
              <div v-else-if="activeTab === 'branches'" class="space-y-4 p-5">
                <!-- 搜索 + 新建 + 合并 -->
                <div class="flex gap-2">
                  <div class="relative flex-1">
                    <IconSearch class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input v-model="branchSearch" type="text" placeholder="搜索分支…" class="gd-input pl-9" />
                  </div>
                  <button class="gd-action" title="合并其他分支到当前分支" @click="toggleMergeForm">
                    <IconMerge class="w-3.5 h-3.5" />
                    <span>合并</span>
                  </button>
                  <button class="gd-action" @click="toggleCreateBranch">
                    <IconPlus class="w-3.5 h-3.5" />
                    <span>新建分支</span>
                  </button>
                </div>

                <!-- 合并表单 -->
                <Transition
                  enter-active-class="transition-all duration-200"
                  leave-active-class="transition-all duration-150"
                  enter-from-class="opacity-0 -translate-y-2"
                  leave-to-class="opacity-0 -translate-y-2"
                >
                  <div v-if="showMergeForm" class="gd-inline-form">
                    <div class="gd-section-title">
                      <IconMerge class="w-3.5 h-3.5" />
                      合并分支到 <span class="gd-mono text-teal-300">{{ dash.branch.value || '—' }}</span>
                    </div>
                    <div class="gd-form-row">
                      <select v-model="mergeSource" class="gd-input flex-1">
                        <option value="" disabled>选择要合并的分支</option>
                        <option v-for="b in dash.branches.value.filter((x) => !x.current)" :key="b.name" :value="b.name">
                          {{ b.name }}
                        </option>
                      </select>
                      <label class="gd-check-inline">
                        <input v-model="mergeNoCommit" type="checkbox" />
                        <span>--no-commit（只合并到工作区，不自动提交）</span>
                      </label>
                      <button class="gd-confirm-btn ok" :disabled="!mergeSource" @click="submitMerge">合并</button>
                      <button class="gd-confirm-btn cancel" @click="toggleMergeForm">取消</button>
                    </div>
                  </div>
                </Transition>

                <!-- 创建分支表单 -->
                <Transition
                  enter-active-class="transition-all duration-200"
                  leave-active-class="transition-all duration-150"
                  enter-from-class="opacity-0 -translate-y-2"
                  leave-to-class="opacity-0 -translate-y-2"
                >
                  <div v-if="showCreateBranch" class="gd-inline-form">
                    <div class="gd-form-row">
                      <input v-model="newBranchName" type="text" placeholder="分支名称 *" class="gd-input flex-1" @keydown.enter="submitCreateBranch" />
                      <input v-model="newBranchBase" type="text" placeholder="基于分支（可选，默认 HEAD）" class="gd-input flex-1" @keydown.enter="submitCreateBranch" />
                      <button class="gd-confirm-btn ok" :disabled="!newBranchName.trim()" @click="submitCreateBranch">创建</button>
                      <button class="gd-confirm-btn cancel" @click="toggleCreateBranch">取消</button>
                    </div>
                  </div>
                </Transition>

                <!-- 本地分支 -->
                <div>
                  <div class="gd-section-title">
                    <IconBranch class="w-3.5 h-3.5" />
                    本地分支 ({{ filteredBranches.length }})
                  </div>
                  <div class="gd-list">
                    <div
                      v-for="b in filteredBranches"
                      :key="b.name"
                      class="gd-list-row"
                      :class="{ 'is-current': b.current }"
                    >
                      <IconBranch class="w-3.5 h-3.5 flex-shrink-0" :class="b.current ? 'text-teal-400' : 'text-white/30'" />
                      <span class="gd-mono flex-1 truncate" :class="b.current ? 'text-teal-300' : 'text-white/70'">{{ b.name }}</span>
                      <span class="gd-hash flex-shrink-0">{{ b.hash }}</span>
                      <span v-if="b.ahead" class="text-amber-400/80 text-[11px]">↑{{ b.ahead }}</span>
                      <span v-if="b.behind" class="text-sky-400/80 text-[11px]">↓{{ b.behind }}</span>
                      <span class="text-white/35 text-[11px] truncate max-w-[180px]">{{ shortMsg(b.message, 35) }}</span>
                      <button
                        v-if="!b.current"
                        class="gd-mini-btn"
                        title="切换到此分支"
                        :aria-label="`切换到分支 ${b.name}`"
                        @click.stop="confirmSwitchBranch(b.name)"
                      >
                        <IconSwitch class="w-3 h-3" />
                      </button>
                      <button
                        v-if="!b.current"
                        class="gd-mini-btn danger"
                        title="删除此分支"
                        :aria-label="`删除分支 ${b.name}`"
                        @click.stop="confirmDeleteBranch(b.name)"
                      >
                        <IconTrash class="w-3 h-3" />
                      </button>
                    </div>
                    <div v-if="filteredBranches.length === 0" class="py-6 text-center text-white/30 text-[12px]">无匹配分支</div>
                  </div>
                </div>

                <!-- 远端分支 -->
                <div>
                  <button
                    class="gd-section-title cursor-pointer hover:text-white/60 transition-colors"
                    @click="showRemoteBranches = !showRemoteBranches"
                  >
                    <IconChevronRight class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-90': showRemoteBranches }" />
                    远端分支 ({{ filteredRemoteBranches.length }})
                  </button>
                  <div v-if="showRemoteBranches" class="gd-list mt-1">
                    <div
                      v-for="b in filteredRemoteBranches"
                      :key="b.name"
                      class="gd-list-row text-white/55"
                    >
                      <IconBranch class="w-3.5 h-3.5 flex-shrink-0 text-white/20" />
                      <span class="gd-mono flex-1 truncate">{{ b.name }}</span>
                      <span class="gd-hash flex-shrink-0">{{ b.hash }}</span>
                      <span class="text-white/30 text-[11px] truncate max-w-[200px]">{{ shortMsg(b.message, 35) }}</span>
                      <button
                        v-if="!hasLocalCounterpart(b)"
                        class="gd-mini-btn"
                        :title="`检出为本地跟踪分支 ${shortRemoteName(b.name)}`"
                        :aria-label="`检出远端分支 ${b.name}`"
                        @click.stop="confirmCheckoutRemote(b.name)"
                      >
                        <IconDownload class="w-3 h-3" />
                      </button>
                      <span v-else class="text-white/20 text-[10px] flex-shrink-0" title="已有同名本地分支">已有</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- ─── 提交 ─── -->
              <div v-else-if="activeTab === 'commits'" class="space-y-3 p-5">
                <!-- 搜索 commit -->
                <div class="flex gap-2">
                  <div class="relative flex-1">
                    <IconSearch class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input
                      v-model="commitSearch"
                      type="text"
                      placeholder="搜索提交信息（--grep）…"
                      class="gd-input pl-9"
                      @keydown.enter="runCommitSearch"
                    />
                  </div>
                  <button v-if="searchResults !== null" class="gd-action" @click="clearCommitSearch">清除</button>
                  <button class="gd-action" :disabled="!commitSearch.trim() || searchLoading" @click="runCommitSearch">
                    <IconSearch class="w-3.5 h-3.5" :class="{ 'gd-spin': searchLoading }" />
                    <span>搜索</span>
                  </button>
                </div>

                <!-- 搜索结果 -->
                <div v-if="searchResults !== null">
                  <div class="gd-section-title">
                    <IconSearch class="w-3.5 h-3.5" />
                    搜索结果 ({{ searchResults.length }})
                  </div>
                  <div class="gd-list">
                    <div v-for="c in searchResults" :key="c.fullHash" class="gd-list-row">
                      <IconCommit class="w-3.5 h-3.5 flex-shrink-0 text-white/25" />
                      <span class="gd-hash flex-shrink-0">{{ c.hash }}</span>
                      <span class="flex-1 truncate text-white/75">{{ c.message }}</span>
                      <span class="text-white/35 text-[11px] flex-shrink-0">{{ c.author }}</span>
                    </div>
                    <div v-if="!searchResults.length" class="py-6 text-center text-white/30 text-[12px]">无匹配提交</div>
                  </div>
                </div>

                <!-- 提交日志 -->
                <div>
                  <div class="gd-section-title">
                    <IconCommit class="w-3.5 h-3.5" />
                    提交日志
                  </div>
                  <div class="gd-list">
                    <template v-for="c in dash.commits.value" :key="c.fullHash">
                      <div
                        class="gd-list-row group cursor-pointer"
                        @click="viewDiff(`c-${c.fullHash}`, () => dash.getCommitDetail(c.fullHash))"
                      >
                        <IconCommit class="w-3.5 h-3.5 flex-shrink-0 text-white/25" />
                        <span class="gd-hash flex-shrink-0">{{ c.hash }}</span>
                        <span class="flex-1 truncate text-white/75">{{ c.message }}</span>
                        <span class="text-white/35 text-[11px] flex-shrink-0">{{ c.author }}</span>
                        <span class="text-white/30 text-[11px] flex-shrink-0 w-16 text-right">{{ fmtDate(c.date) }}</span>
                        <div class="gd-row-actions">
                          <button
                            v-if="aiReady"
                            class="gd-mini-btn"
                            title="摘取此提交到当前分支"
                            :aria-label="`Cherry-pick ${c.hash}`"
                            @click.stop="confirmCherryPick(c)"
                          >
                            <IconCherryPick class="w-3 h-3" />
                          </button>
                          <button
                            class="gd-mini-btn"
                            title="生成反向提交撤销此变更"
                            :aria-label="`Revert ${c.hash}`"
                            @click.stop="confirmRevert(c)"
                          >
                            <IconRevert class="w-3 h-3" />
                          </button>
                        </div>
                        <IconChevronRight
                          class="w-3.5 h-3.5 text-white/20 flex-shrink-0 transition-transform"
                          :class="{ 'rotate-90 text-teal-400/60': diffTarget === `c-${c.fullHash}` }"
                        />
                      </div>
                      <GitDiffBox
                        v-if="diffTarget === `c-${c.fullHash}`"
                        :content="diffContent"
                        :loading="diffLoading"
                        :ai-ready="aiReady"
                        @explain="askXiaowuDiff"
                      />
                    </template>
                    <div v-if="dash.commits.value.length === 0" class="py-10 text-center text-white/30 text-[12px]">暂无提交记录</div>
                  </div>
                </div>

                <!-- Reflog 操作历史（救命用） -->
                <div>
                  <button
                    class="gd-section-title cursor-pointer hover:text-white/60 transition-colors w-full"
                    @click="toggleReflog"
                  >
                    <IconChevronRight class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-90': showReflog }" />
                    <IconReflog class="w-3.5 h-3.5" />
                    操作历史 reflog
                    <span class="text-white/30 text-[10px] font-normal normal-case ml-1">误操作可在此找回</span>
                  </button>
                  <div v-if="showReflog" class="gd-list mt-1">
                    <div v-if="reflogLoading" class="py-4 text-center text-white/40 text-[12px]">
                      <IconLoading class="w-4 h-4 gd-spin inline" /> 加载中…
                    </div>
                    <template v-else>
                      <div v-for="(r, i) in reflog" :key="i" class="gd-list-row">
                        <IconReflog class="w-3.5 h-3.5 flex-shrink-0 text-white/25" />
                        <span class="gd-hash flex-shrink-0">{{ r.hash }}</span>
                        <span class="flex-1 truncate text-white/65 text-[12px]">{{ r.action }}</span>
                        <span class="text-white/30 text-[11px] flex-shrink-0">{{ fmtDate(r.date) }}</span>
                      </div>
                      <div v-if="!reflog.length" class="py-4 text-center text-white/30 text-[12px]">暂无操作历史</div>
                    </template>
                  </div>
                </div>
              </div>

              <!-- ─── 变更 ─── -->
              <div v-else-if="activeTab === 'changes'" class="flex flex-col">
                <div v-if="dash.status.value.clean" class="flex flex-col items-center gap-3 py-16 text-white/40">
                  <IconCheck class="w-10 h-10 text-emerald-400/50" />
                  <span class="text-sm">工作区干净，没有未提交的变更</span>
                </div>

                <template v-else>
                  <!-- 批量操作栏 -->
                  <div class="gd-toolbar mx-5 mt-4 mb-2">
                    <div class="flex items-center gap-2">
                      <button class="gd-mini-btn text" @click="selectAllModified">全选未暂存</button>
                      <button class="gd-mini-btn text" @click="selectAllStaged">全选已暂存</button>
                      <button class="gd-mini-btn text" @click="clearSelection">清除选择</button>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-[11px] text-white/35">已选 {{ selectedModifiedCount + selectedStagedCount }} 个文件</span>
                      <button v-if="selectedModifiedCount > 0" class="gd-confirm-btn ok text-[11px]" @click="stageSelected">
                        暂存选中 ({{ selectedModifiedCount }})
                      </button>
                      <button v-if="selectedStagedCount > 0" class="gd-confirm-btn cancel text-[11px]" @click="unstageSelected">
                        取消暂存 ({{ selectedStagedCount }})
                      </button>
                    </div>
                  </div>

                  <div class="flex-1 overflow-y-auto space-y-4 px-5 pb-2">
                    <!-- 已暂存 -->
                    <div v-if="dash.status.value.staged.length">
                      <div class="gd-section-title text-emerald-400/80">
                        <IconAdded class="w-3.5 h-3.5" />
                        已暂存 ({{ dash.status.value.staged.length }})
                      </div>
                      <div class="gd-list">
                        <template v-for="f in dash.status.value.staged" :key="'s-' + f.path">
                          <div
                            class="gd-list-row cursor-pointer border-l-2 border-l-emerald-500/50"
                            @click="viewDiff('staged-' + f.path, () => dash.getDiff(f.path, { cached: true }))"
                          >
                            <label class="gd-checkbox" @click.stop>
                              <input type="checkbox" :checked="selectedFiles.has('staged:' + f.path)" @change="toggleFileSelection('staged:' + f.path)" />
                              <span class="gd-check-mark" />
                            </label>
                            <IconFile class="w-3.5 h-3.5 flex-shrink-0 text-emerald-400/60" />
                            <span class="text-white/40 text-[11px]">{{ fileDir(f.path) }}</span>
                            <span class="gd-mono text-emerald-300/80 flex-1 truncate">{{ fileName(f.path) }}</span>
                            <span class="gd-status-badge bg-emerald-500/15 text-emerald-400">{{ f.index }}</span>
                            <IconChevronRight
                              class="w-3.5 h-3.5 text-white/20 flex-shrink-0 transition-transform"
                              :class="{ 'rotate-90 text-teal-400/60': diffTarget === 'staged-' + f.path }"
                            />
                          </div>
                          <GitDiffBox
                            v-if="diffTarget === 'staged-' + f.path"
                            :content="diffContent"
                            :loading="diffLoading"
                            :ai-ready="aiReady"
                            @explain="askXiaowuDiff"
                          />
                        </template>
                      </div>
                    </div>

                    <!-- 已修改 -->
                    <div v-if="dash.status.value.modified.length">
                      <div class="gd-section-title text-amber-400/80">
                        <IconModified class="w-3.5 h-3.5" />
                        已修改 ({{ dash.status.value.modified.length }})
                      </div>
                      <div class="gd-list">
                        <template v-for="f in dash.status.value.modified" :key="'m-' + f.path">
                          <div
                            class="gd-list-row cursor-pointer border-l-2 border-l-amber-500/50"
                            @click="viewDiff('mod-' + f.path, () => dash.getDiff(f.path))"
                          >
                            <label class="gd-checkbox" @click.stop>
                              <input type="checkbox" :checked="selectedFiles.has('mod:' + f.path)" @change="toggleFileSelection('mod:' + f.path)" />
                              <span class="gd-check-mark" />
                            </label>
                            <IconFile class="w-3.5 h-3.5 flex-shrink-0 text-amber-400/60" />
                            <span class="text-white/40 text-[11px]">{{ fileDir(f.path) }}</span>
                            <span class="gd-mono text-amber-300/80 flex-1 truncate">{{ fileName(f.path) }}</span>
                            <span class="gd-status-badge bg-amber-500/15 text-amber-400">{{ f.worktree || f.index }}</span>
                            <div class="gd-row-actions">
                              <button
                                class="gd-mini-btn"
                                title="逐行追溯修改人与时间"
                                :aria-label="`Blame ${f.path}`"
                                @click.stop="viewBlame(f.path)"
                              >
                                <IconBlame class="w-3 h-3" />
                              </button>
                              <button
                                class="gd-mini-btn danger"
                                title="放弃此文件的修改"
                                :aria-label="`放弃修改 ${f.path}`"
                                @click.stop="confirmDiscard(f.path, false)"
                              >
                                <IconDiscard class="w-3 h-3" />
                              </button>
                            </div>
                            <IconChevronRight
                              class="w-3.5 h-3.5 text-white/20 flex-shrink-0 transition-transform"
                              :class="{ 'rotate-90 text-teal-400/60': diffTarget === 'mod-' + f.path }"
                            />
                          </div>
                          <GitDiffBox
                            v-if="diffTarget === 'mod-' + f.path"
                            :content="diffContent"
                            :loading="diffLoading"
                            :ai-ready="aiReady"
                            @explain="askXiaowuDiff"
                          />
                          <!-- Blame 面板 -->
                          <div v-if="blameTarget === f.path" class="gd-blame-box">
                            <div v-if="blameLoading" class="py-3 text-center text-white/40 text-[12px]">
                              <IconLoading class="w-4 h-4 gd-spin inline" /> 加载中…
                            </div>
                            <template v-else>
                              <div v-for="(ln, i) in blameLines.slice(0, 500)" :key="i" class="gd-blame-row">
                                <span class="gd-hash flex-shrink-0">{{ ln.hash }}</span>
                                <span class="text-white/40 text-[11px] flex-shrink-0 w-20 truncate" :title="ln.author">{{ ln.author }}</span>
                                <span class="text-white/30 text-[11px] flex-shrink-0 w-14 text-right">{{ ln.line }}</span>
                                <span class="gd-mono text-white/65 flex-1 truncate text-[12px]" :title="ln.content">{{ ln.content }}</span>
                              </div>
                              <div v-if="!blameLines.length" class="py-3 text-center text-white/30 text-[12px]">无 blame 数据</div>
                            </template>
                          </div>
                        </template>
                      </div>
                    </div>

                    <!-- 未跟踪 -->
                    <div v-if="dash.status.value.untracked.length">
                      <div class="gd-section-title text-sky-400/80">
                        <IconUntracked class="w-3.5 h-3.5" />
                        未跟踪 ({{ dash.status.value.untracked.length }})
                      </div>
                      <div class="gd-list">
                        <div v-for="f in dash.status.value.untracked" :key="'u-' + f.path" class="gd-list-row border-l-2 border-l-sky-500/30">
                          <label class="gd-checkbox" @click.stop>
                            <input type="checkbox" :checked="selectedFiles.has('untracked:' + f.path)" @change="toggleFileSelection('untracked:' + f.path)" />
                            <span class="gd-check-mark" />
                          </label>
                          <IconFile class="w-3.5 h-3.5 flex-shrink-0 text-sky-400/50" />
                          <span class="text-white/40 text-[11px]">{{ fileDir(f.path) }}</span>
                          <span class="gd-mono text-sky-300/70 flex-1 truncate">{{ fileName(f.path) }}</span>
                          <span class="gd-status-badge bg-sky-500/15 text-sky-400">?</span>
                          <button
                            class="gd-mini-btn danger"
                            title="删除此未跟踪文件"
                            :aria-label="`删除文件 ${f.path}`"
                            @click.stop="confirmDiscard(f.path, true)"
                          >
                            <IconTrash class="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Commit 栏（conventional 前缀 + 多行 + 复用） -->
                  <div class="gd-commit-bar flex-shrink-0 px-5 py-3 border-t border-white/8">
                    <div class="flex items-start gap-2">
                      <select v-model="commitPrefix" class="gd-input gd-prefix-select" title="Conventional Commit 前缀">
                        <option value="">无前缀</option>
                        <option v-for="p in COMMIT_PREFIXES" :key="p" :value="p">{{ p }}:</option>
                      </select>
                      <textarea
                        v-model="commitMessage"
                        rows="2"
                        placeholder="提交信息（支持多行）…"
                        class="gd-input gd-textarea flex-1"
                        @keydown.ctrl.enter="doCommit"
                        @keydown.meta.enter="doCommit"
                      />
                      <div class="flex flex-col gap-1.5">
                        <button
                          class="gd-confirm-btn ok"
                          :disabled="!!dash.actionLoading.value || !canCommit"
                          title="提交已暂存的文件（Ctrl+Enter）"
                          @click="doCommit"
                        >
                          提交
                        </button>
                        <button
                          class="gd-confirm-btn ok ghost"
                          :disabled="!!dash.actionLoading.value || !canCommitAll"
                          title="提交已暂存文件和已跟踪文件修改（git commit -a），不包含未跟踪新文件"
                          @click="doCommitAll"
                        >
                          commit -a
                        </button>
                      </div>
                    </div>
                    <div class="flex items-center justify-between gap-3 mt-1.5 text-[11px] text-white/35">
                      <span class="min-w-0 truncate">
                        <span>已暂存 {{ dash.status.value.staged.length }} · 未暂存 {{ dash.status.value.modified.length }} · 未跟踪 {{ dash.status.value.untracked.length }}</span>
                        <span v-if="commitPreview" class="text-white/45 ml-2">→ <span class="gd-mono text-teal-300/80">{{ shortMsg(commitPreview.split('\n')[0], 50) }}</span></span>
                      </span>
                      <button v-if="dash.commits.value[0]" class="gd-mini-btn text" title="复用上一条提交信息" @click="reuseLastMessage">
                        <IconRefresh class="w-3 h-3" />
                        <span class="ml-1">复用上条</span>
                      </button>
                    </div>
                  </div>
                </template>
              </div>

              <!-- ─── 标签 / Stash（远端已移至概览） ─── -->
              <div v-else-if="activeTab === 'tags'" class="space-y-5 p-5">
                <!-- Tags -->
                <div>
                  <div class="gd-section-title justify-between">
                    <div class="flex items-center gap-1.5">
                      <IconTag class="w-3.5 h-3.5" />
                      Tags ({{ dash.tags.value.length }})
                      <span
                        v-if="unpushedTagCount > 0"
                        class="gd-badge-sm"
                        style="background: rgba(251,191,36,0.14); color: rgb(251,191,36); border-color: rgba(251,191,36,0.22)"
                        :title="`${unpushedTagCount} 个标签未推送到远端`"
                      >未推送 {{ unpushedTagCount }}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <button class="gd-action text-[11px]" @click="confirmPushTags" title="推送所有本地标签（git push --tags）">
                        <IconUpload class="w-3 h-3" />
                        <span>推送全部</span>
                      </button>
                      <button class="gd-action text-[11px]" @click="toggleCreateTag">
                        <IconPlus class="w-3 h-3" />
                        <span>新建标签</span>
                      </button>
                    </div>
                  </div>

                  <Transition
                    enter-active-class="transition-all duration-200"
                    leave-active-class="transition-all duration-150"
                    enter-from-class="opacity-0 -translate-y-2"
                    leave-to-class="opacity-0 -translate-y-2"
                  >
                    <div v-if="showCreateTag" class="gd-inline-form gd-tag-create mb-2">
                      <!-- 类型 -->
                      <div class="gd-form-field">
                        <span class="gd-field-label">类型</span>
                        <div class="gd-seg-group">
                          <button
                            type="button"
                            class="gd-seg"
                            :class="{ active: newTagAnnotated }"
                            @click="newTagAnnotated = true"
                          >附注标签</button>
                          <button
                            type="button"
                            class="gd-seg"
                            :class="{ active: !newTagAnnotated }"
                            @click="newTagAnnotated = false"
                          >轻量标签</button>
                        </div>
                        <span class="gd-field-hint">
                          {{ newTagAnnotated
                            ? '保存打标签人、时间与说明，发版推荐用附注标签。'
                            : '只是 bookmark，不保存额外元数据；临时标记可用。' }}
                        </span>
                      </div>

                      <!-- 标签名 -->
                      <div class="gd-form-field">
                        <span class="gd-field-label">标签名 *</span>
                        <input
                          v-model="newTagName"
                          type="text"
                          placeholder="如 v1.2.3、release-2026-07"
                          class="gd-input"
                          @keydown.enter="submitCreateTag"
                        />
                        <span v-if="tagNameError" class="gd-field-hint danger">{{ tagNameError }}</span>
                        <span v-else-if="newTagName.trim()" class="gd-field-hint ok">可用</span>
                      </div>

                      <!-- 指向 commit -->
                      <div class="gd-form-field">
                        <span class="gd-field-label">指向</span>
                        <select v-model="newTagRef" class="gd-input">
                          <option value="">HEAD · {{ dash.commits.value[0]?.message?.slice(0, 40) || '最新提交' }}</option>
                          <option v-for="c in dash.commits.value" :key="c.fullHash" :value="c.hash">
                            {{ c.hash }} · {{ c.message.slice(0, 48) }}
                          </option>
                        </select>
                        <span class="gd-field-hint">默认打在最新提交；可选最近 {{ dash.commits.value.length }} 条中的任意一条。</span>
                      </div>

                      <!-- 发版说明（仅附注）-->
                      <div v-if="newTagAnnotated" class="gd-form-field">
                        <span class="gd-field-label">发版说明 *</span>
                        <textarea
                          v-model="newTagMessage"
                          class="gd-input gd-textarea"
                          rows="3"
                          placeholder="如：发版 v1.2.3&#10;- 新增 xxx&#10;- 修复 yyy（Ctrl+Enter 提交）"
                          @keydown.ctrl.enter="submitCreateTag"
                          @keydown.meta.enter="submitCreateTag"
                        />
                      </div>

                      <!-- 操作 -->
                      <div class="flex items-center justify-end gap-2 mt-1">
                        <button class="gd-confirm-btn ok" :disabled="!canSubmitTag" @click="submitCreateTag">创建标签</button>
                        <button class="gd-confirm-btn cancel" @click="toggleCreateTag">取消</button>
                      </div>
                    </div>
                  </Transition>

                  <!-- 搜索 / 排序 / 批量工具栏（仅有标签时显示）-->
                  <div v-if="dash.tags.value.length" class="gd-tag-toolbar mb-2">
                    <div class="relative flex-1 min-w-0 max-w-[260px]">
                      <IconSearch class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                      <input
                        v-model="tagSearch"
                        type="text"
                        placeholder="搜索标签名或说明…"
                        class="gd-input gd-input-sm"
                        @keydown.esc="tagSearch = ''"
                      />
                    </div>
                    <div class="gd-seg-group flex-shrink-0 ml-auto">
                      <button
                        type="button"
                        class="gd-seg"
                        :class="{ active: tagSort === 'date' }"
                        title="按创建时间倒序"
                        @click="tagSort = 'date'"
                      >日期</button>
                      <button
                        type="button"
                        class="gd-seg"
                        :class="{ active: tagSort === 'semver' }"
                        title="按语义化版本号倒序"
                        @click="tagSort = 'semver'"
                      >版本</button>
                    </div>
                  </div>

                  <div v-if="dash.tags.value.length">
                    <div v-if="displayedTags.length" class="gd-list">
                      <template v-for="(t, idx) in displayedTags" :key="t.name">
                        <!-- 版本分组头（仅版本排序时，在该组首条前渲染）-->
                        <div
                          v-if="tagSort === 'semver' && isGroupStart(idx)"
                          class="gd-tag-group-header"
                          :style="groupStyleOf(t.name)"
                          role="button"
                          tabindex="0"
                          :aria-label="`${tagGroupOf(t.name)} 分组，${groupCount(tagGroupOf(t.name))} 个标签，点击${collapsedGroups.has(tagGroupOf(t.name)) ? '展开' : '折叠'}`"
                          @click="toggleGroup(tagGroupOf(t.name))"
                          @keydown.enter="toggleGroup(tagGroupOf(t.name))"
                          @keydown.space.prevent="toggleGroup(tagGroupOf(t.name))"
                        >
                          <IconChevronRight
                            class="w-3.5 h-3.5 flex-shrink-0 transition-transform"
                            :class="{ 'rotate-90': !collapsedGroups.has(tagGroupOf(t.name)) }"
                          />
                          <span class="font-semibold">{{ tagGroupOf(t.name) }}</span>
                          <span class="text-[11px] opacity-70">{{ groupCount(tagGroupOf(t.name)) }} 个标签</span>
                          <span
                            v-if="collapsedGroups.has(tagGroupOf(t.name))"
                            class="ml-auto text-[10px] opacity-50"
                          >已折叠</span>
                        </div>
                        <div
                          v-if="!isTagRowHidden(t.name)"
                          class="gd-list-row group cursor-pointer"
                          @click="toggleTagDetail(t)"
                        >
                          <IconTag class="w-3.5 h-3.5 flex-shrink-0 text-violet-400/60" />
                          <span
                            v-if="idx === 0 && !tagSearch.trim() && isVersionTag(t.name)"
                            class="gd-badge-sm"
                            style="background: rgba(45,212,191,0.14); color: rgb(94,234,212); border-color: rgba(45,212,191,0.24)"
                            title="最新版本标签"
                          >latest</span>
                        <span class="gd-mono text-violet-300/80 flex-shrink-0">{{ t.name }}</span>
                        <span
                          v-if="!t.onRemote"
                          class="gd-badge-sm"
                          style="background: rgba(251,191,36,0.14); color: rgb(251,191,36); border-color: rgba(251,191,36,0.22)"
                          title="本地已创建，远端还没有此标签"
                        >未推送</span>
                        <span class="gd-hash flex-shrink-0">{{ t.hash }}</span>
                        <span class="flex-1 truncate text-white/50 text-[12px]">{{ t.message || '(轻量标签)' }}</span>
                        <span class="text-white/30 text-[11px] flex-shrink-0">{{ fmtDate(t.date) }}</span>
                        <div class="gd-row-actions">
                          <button
                            v-if="!t.onRemote"
                            class="gd-mini-btn"
                            title="推送此标签到远端"
                            :aria-label="`推送标签 ${t.name}`"
                            @click.stop="confirmPushTag(t.name)"
                          >
                            <IconUpload class="w-3 h-3" />
                          </button>
                          <button
                            class="gd-mini-btn"
                            title="检出此标签（detached HEAD，用于回滚排查）"
                            :aria-label="`检出标签 ${t.name}`"
                            @click.stop="confirmCheckoutTag(t.name)"
                          >
                            <IconSwitch class="w-3 h-3" />
                          </button>
                          <button
                            class="gd-mini-btn danger"
                            title="删除此标签"
                            :aria-label="`删除标签 ${t.name}`"
                            @click.stop="confirmDeleteTag(t.name)"
                          >
                            <IconTrash class="w-3 h-3" />
                          </button>
                        </div>
                        <IconChevronRight
                          class="w-3.5 h-3.5 text-white/20 flex-shrink-0 transition-transform"
                          :class="{ 'rotate-90 text-teal-400/60': expandedTag === t.name }"
                        />
                      </div>

                      <!-- 标签详情：metadata + 自上一 tag 以来的提交 + 操作栏 -->
                      <div v-if="expandedTag === t.name && !isTagRowHidden(t.name)" class="gd-tag-detail">
                        <div v-if="tagDetailLoading" class="py-4 text-center text-white/40 text-[12px]">
                          <IconLoading class="w-4 h-4 gd-spin inline align-middle" /> 加载发版内容…
                        </div>
                        <template v-else>
                          <div class="gd-tag-meta">
                            <div class="flex items-center gap-2 flex-wrap text-[11px] text-white/40">
                              <span class="gd-hash">{{ t.hash }}</span>
                              <span class="text-white/20">·</span>
                              <span>{{ fmtDate(t.date) }}</span>
                              <span class="text-white/20">·</span>
                              <span>{{ t.annotated ? '附注标签' : '轻量标签' }}</span>
                              <span
                                v-if="t.onRemote"
                                class="gd-badge-sm"
                                style="background: rgba(45,212,191,0.12); color: rgb(94,234,212); border-color: rgba(45,212,191,0.2)"
                              >已同步</span>
                              <span
                                v-else
                                class="gd-badge-sm"
                                style="background: rgba(251,191,36,0.14); color: rgb(251,191,36); border-color: rgba(251,191,36,0.22)"
                              >仅本地</span>
                            </div>
                            <p v-if="t.message" class="mt-2 text-[13px] text-white/72 leading-relaxed">{{ t.message }}</p>
                          </div>

                          <div class="gd-tag-commits">
                            <div class="gd-section-title text-[10px] mb-1">
                              <IconCommit class="w-3 h-3" />
                              {{ tagPrevName ? `自 ${tagPrevName} 以来的提交` : '此标签包含的提交' }}
                              <span class="text-white/30 font-normal normal-case">({{ tagCommits.length }})</span>
                            </div>
                            <div v-if="tagCommits.length" class="gd-list gd-tag-commit-list">
                              <template v-for="c in tagCommits" :key="c.fullHash">
                                <div
                                  class="gd-list-row group cursor-pointer"
                                  @click="viewDiff(`c-${c.fullHash}`, () => dash.getCommitDetail(c.fullHash))"
                                >
                                  <IconCommit class="w-3 h-3 flex-shrink-0 text-white/25" />
                                  <span class="gd-hash flex-shrink-0">{{ c.hash }}</span>
                                  <span class="flex-1 truncate text-white/70 text-[12px]">{{ c.message }}</span>
                                  <span class="text-white/30 text-[11px] flex-shrink-0">{{ c.author }}</span>
                                  <IconChevronRight
                                    class="w-3 h-3 text-white/20 flex-shrink-0 transition-transform"
                                    :class="{ 'rotate-90 text-teal-400/60': diffTarget === `c-${c.fullHash}` }"
                                  />
                                </div>
                                <GitDiffBox
                                  v-if="diffTarget === `c-${c.fullHash}`"
                                  :content="diffContent"
                                  :loading="diffLoading"
                                  :ai-ready="aiReady"
                                  @explain="askXiaowuDiff"
                                />
                              </template>
                            </div>
                            <div v-else class="py-3 text-center text-white/30 text-[12px]">无新增提交（与上一标签间无差异）</div>
                          </div>

                          <div class="gd-tag-actions">
                            <button
                              v-if="aiReady"
                              class="gd-handoff-btn"
                              title="让小吴根据这批提交生成发版说明"
                              @click="askXiaowuReleaseNotes(t.name, tagCommits)"
                            >
                              <IconRobot class="w-3 h-3" />
                              <span>让小吴写发版说明</span>
                            </button>
                            <button
                              v-if="!t.onRemote"
                              class="gd-confirm-btn ok ghost"
                              title="推送此标签到远端"
                              @click="confirmPushTag(t.name)"
                            >
                              <IconUpload class="w-3 h-3" />
                              推送
                            </button>
                            <button
                              class="gd-confirm-btn ok ghost"
                              title="检出此标签（detached HEAD）"
                              @click="confirmCheckoutTag(t.name)"
                            >
                              <IconSwitch class="w-3 h-3" />
                              检出
                            </button>
                            <button
                              class="gd-confirm-btn ok ghost"
                              :title="`复制 git checkout ${t.name}`"
                              @click="copyCheckoutCmd(t.name)"
                            >
                              <IconCopy class="w-3 h-3" />
                              {{ copiedTag === t.name ? '已复制' : '复制命令' }}
                            </button>
                            <button
                              v-if="t.onRemote"
                              class="gd-confirm-btn danger ml-auto"
                              title="删除远端标签（影响所有协作者与 CI/CD）"
                              @click="confirmDeleteRemoteTag(t.name)"
                            >
                              <IconTrash class="w-3 h-3" />
                              删远端
                            </button>
                          </div>
                        </template>
                      </div>
                    </template>
                    </div>
                    <div v-else class="py-8 text-center text-white/30 text-[12px]">
                      无匹配标签 · <button class="gd-link-btn" @click="tagSearch = ''">清除搜索</button>
                    </div>
                  </div>
                  <div v-else class="py-8 text-center text-white/30 text-[12px]">
                    暂无标签 · 打一个发版标签试试
                  </div>
                </div>

                <!-- Stashes -->
                <div>
                  <div class="gd-section-title justify-between">
                    <div class="flex items-center gap-1.5">
                      <IconStash class="w-3.5 h-3.5" />
                      Stash ({{ dash.stashes.value.length }})
                    </div>
                    <button class="gd-action text-[11px]" @click="toggleStashForm">
                      <IconStash class="w-3 h-3" />
                      <span>Stash 变更</span>
                    </button>
                  </div>

                  <Transition
                    enter-active-class="transition-all duration-200"
                    leave-active-class="transition-all duration-150"
                    enter-from-class="opacity-0 -translate-y-2"
                    leave-to-class="opacity-0 -translate-y-2"
                  >
                    <div v-if="showStashForm" class="gd-inline-form mb-2">
                      <div class="gd-form-row">
                        <input v-model="stashMessage" type="text" placeholder="暂存说明（可选）" class="gd-input flex-1" @keydown.enter="submitStashPush" />
                        <button class="gd-confirm-btn ok" @click="submitStashPush">暂存</button>
                        <button class="gd-confirm-btn cancel" @click="toggleStashForm">取消</button>
                      </div>
                    </div>
                  </Transition>

                  <div v-if="dash.stashes.value.length" class="gd-list">
                    <div v-for="s in dash.stashes.value" :key="s.index" class="gd-list-row">
                      <IconStash class="w-3.5 h-3.5 flex-shrink-0 text-white/30" />
                      <span class="gd-mono text-white/50 flex-shrink-0">{{ s.index }}</span>
                      <span class="flex-1 truncate text-white/60 text-[12px]">{{ s.message }}</span>
                      <span v-if="s.branch" class="gd-badge-sm">{{ s.branch }}</span>
                      <span class="text-white/30 text-[11px] flex-shrink-0">{{ fmtDate(s.date) }}</span>
                      <button class="gd-mini-btn" title="应用此暂存（保留 stash）" :aria-label="`应用暂存 ${s.index}`" @click.stop="confirmStashApply(s.index)">
                        <IconPlay class="w-3 h-3" />
                      </button>
                      <button v-if="s.index === 'stash@{0}'" class="gd-mini-btn" title="弹出此暂存（应用并删除）" :aria-label="`弹出暂存 ${s.index}`" @click.stop="confirmStashPop(s.index)">
                        <IconPop class="w-3 h-3" />
                      </button>
                      <button class="gd-mini-btn danger" title="丢弃此暂存" :aria-label="`丢弃暂存 ${s.index}`" @click.stop="confirmDropStash(s.index)">
                        <IconTrash class="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div v-else class="py-4 text-center text-white/25 text-[12px]">暂无 stash</div>
                </div>
              </div>
            </div>

            <!-- ═══ 统一确认栏 ═══ -->
            <Transition
              enter-active-class="transition-all duration-200"
              leave-active-class="transition-all duration-150"
              enter-from-class="opacity-0 translate-y-2"
              leave-to-class="opacity-0 translate-y-2"
            >
              <div
                v-if="confirmDialog"
                class="flex-shrink-0 px-6 py-3 border-t border-white/8 flex items-center justify-between gap-3"
              >
                <span class="text-[13px] text-white/70 min-w-0" v-html="confirmDialog.message" />
                <div class="flex gap-2 flex-shrink-0">
                  <button class="gd-confirm-btn cancel" @click="cancelConfirm">取消</button>
                  <button
                    class="gd-confirm-btn"
                    :class="confirmDialog.danger ? 'danger' : 'ok'"
                    @click="executeConfirm"
                  >
                    {{ confirmDialog.confirmLabel }}
                  </button>
                </div>
              </div>
            </Transition>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ═══ 卡片 ═══ */
.gd-card {
  border-radius: 20px;
  background:
    linear-gradient(160deg, rgba(30, 58, 95, 0.92) 0%, rgba(15, 23, 42, 0.94) 55%, rgba(13, 64, 64, 0.92) 100%),
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 28px),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 28px);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 24px 70px -12px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(45, 212, 191, 0.18),
    0 0 32px -4px rgba(45, 212, 191, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  contain: layout paint;
}

/* HUD 四角 */
.gd-corners {
  position: absolute; inset: 0; z-index: 5; pointer-events: none;
  border-radius: 20px; overflow: hidden;
}
.gd-corners::before,
.gd-corners::after {
  content: ''; position: absolute; width: 18px; height: 18px;
  border-color: rgba(94, 234, 212, 0.55); border-style: solid;
  filter: drop-shadow(0 0 4px rgba(94, 234, 212, 0.5));
}
.gd-corners::before { top: 9px; left: 9px; border-width: 2px 0 0 2px; border-top-left-radius: 6px; }
.gd-corners::after { bottom: 9px; right: 9px; border-width: 0 2px 2px 0; border-bottom-right-radius: 6px; }

/* 入场微光（reduced-motion 下关闭，见末尾） */
.gd-card::after {
  content: ''; position: absolute; inset: 0; z-index: 4; pointer-events: none;
  border-radius: 20px;
  background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.08) 48%, rgba(94,234,212,0.06) 52%, transparent 70%);
  background-size: 250% 100%; background-position: 150% 0;
  animation: gd-sheen 0.9s ease-out 0.05s both;
}
@keyframes gd-sheen { from { background-position: 150% 0; } to { background-position: -120% 0; } }

/* 顶部流光 */
.gd-accent {
  height: 4px; width: 100%; flex-shrink: 0;
  background: linear-gradient(90deg, #14b8a6, #2dd4bf, #5eead4, #2dd4bf, #14b8a6);
  background-size: 200% 100%;
  box-shadow: 0 0 12px rgba(45, 212, 191, 0.5);
  animation: gd-accent-flow 3.5s linear infinite;
}
@keyframes gd-accent-flow { from { background-position: 0% 0; } to { background-position: 200% 0; } }

/* ═══ 徽标 / 标签 ═══ */
.gd-badge {
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px;
  background: rgba(45, 212, 191, 0.12); color: rgb(94, 234, 212);
  border: 1px solid rgba(45, 212, 191, 0.2);
}
.gd-badge-sm {
  font-size: 10px; padding: 0 5px; border-radius: 3px;
  background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.gd-mono { font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace; }
.gd-hash {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 11px; color: rgba(255, 255, 255, 0.35);
}

/* ═══ 操作按钮 ═══ */
.gd-action {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 7px;
  background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.gd-action:hover:not(:disabled) {
  background: rgba(45, 212, 191, 0.12); color: rgb(94, 234, 212);
  border-color: rgba(45, 212, 191, 0.25);
}
.gd-action:disabled { opacity: 0.4; cursor: not-allowed; }
.gd-action.is-loading { color: rgba(45, 212, 191, 0.7); }
.gd-action.is-loading :first-child { animation: gd-spin 1s linear infinite; }

.gd-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  color: rgba(255, 255, 255, 0.4);
  border-radius: 8px; padding: 4px; cursor: pointer;
  transition: all 0.15s;
}
.gd-icon-btn:hover:not(:disabled) { color: rgba(255, 255, 255, 0.8); background: rgba(255, 255, 255, 0.1); }
.gd-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.gd-spin { animation: gd-spin 1s linear infinite; }
@keyframes gd-spin { to { transform: rotate(360deg); } }

/* ═══ More 下拉菜单 ═══ */
.gd-dropdown {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 50;
  min-width: 260px; padding: 4px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 40px -8px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(16px);
}
.gd-dropdown-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 7px 10px; border-radius: 6px;
  font-size: 12px; color: rgba(255, 255, 255, 0.7);
  cursor: pointer; transition: all 0.12s;
}
.gd-dropdown-item:hover { background: rgba(45, 212, 191, 0.1); color: rgb(94, 234, 212); }
.gd-dropdown-item.danger:hover { background: rgba(244, 63, 94, 0.12); color: rgb(251, 113, 133); }
.gd-dropdown-hint {
  font-family: ui-monospace, monospace;
  font-size: 10px; color: rgba(255, 255, 255, 0.25);
}
.gd-dropdown-divider { height: 1px; margin: 3px 8px; background: rgba(255, 255, 255, 0.06); }

/* ═══ 标签页 ═══ */
.gd-tab {
  position: relative; padding: 6px 14px; font-size: 13px; font-weight: 500;
  color: rgba(255, 255, 255, 0.4); cursor: pointer;
  border-radius: 8px 8px 0 0; transition: all 0.15s;
  display: flex; align-items: center; gap: 4px;
}
.gd-tab:hover { color: rgba(255, 255, 255, 0.65); }
.gd-tab.active { color: rgb(94, 234, 212); background: rgba(45, 212, 191, 0.06); }
.gd-tab.active::after {
  content: ''; position: absolute; bottom: 0; left: 20%; right: 20%;
  height: 2px; border-radius: 1px;
  background: linear-gradient(90deg, transparent, rgb(45, 212, 191), transparent);
}
.gd-tab-badge {
  font-size: 10px; font-weight: 600; padding: 0 5px; min-width: 16px;
  border-radius: 8px; text-align: center;
  background: rgba(251, 191, 36, 0.15); color: rgb(251, 191, 36);
}

/* ═══ 主体区域 ═══ */
.gd-body {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}
.gd-body::-webkit-scrollbar { width: 6px; }
.gd-body::-webkit-scrollbar-track { background: transparent; }
.gd-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 3px; }

/* ═══ Git 连接提示 ═══ */
.gd-connect-checklist {
  display: flex; flex-direction: column; gap: 6px;
  max-width: 520px; margin: 0; padding: 12px 16px;
  text-align: left; list-style: disc inside;
  border-radius: 12px;
  background: rgba(244, 63, 94, 0.06);
  border: 1px solid rgba(244, 63, 94, 0.16);
  color: rgba(255, 255, 255, 0.58);
  font-size: 12px; line-height: 1.55;
}
.gd-connect-checklist .gd-mono { color: rgba(254, 205, 211, 0.9); }

/* ═══ 仓库健康判断 ═══ */
.gd-health-wrap { position: relative; }
.gd-health {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.gd-health.tone-ok { background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.18); }
.gd-health.tone-warn { background: rgba(251, 191, 36, 0.08); border-color: rgba(251, 191, 36, 0.2); }
.gd-health.tone-danger { background: rgba(244, 63, 94, 0.08); border-color: rgba(244, 63, 94, 0.22); }
.gd-health-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 10px; flex-shrink: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.65);
}
.tone-ok .gd-health-icon { color: rgb(52, 211, 153); }
.tone-warn .gd-health-icon { color: rgb(251, 191, 36); }
.tone-danger .gd-health-icon { color: rgb(251, 113, 133); }
.gd-health-title { font-size: 13px; font-weight: 600; color: rgba(255, 255, 255, 0.82); }
.gd-health-detail { margin-top: 2px; font-size: 12px; color: rgba(255, 255, 255, 0.48); }
.gd-health-action { margin-top: 4px; font-size: 12px; line-height: 1.45; color: rgba(255, 255, 255, 0.55); }
.gd-clickable:hover .gd-health-title { color: rgb(94, 234, 212); }

/* 小吴 hand-off 按钮 */
.gd-handoff-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 7px; flex-shrink: 0;
  background: rgba(45, 212, 191, 0.12);
  border: 1px solid rgba(45, 212, 191, 0.25);
  color: rgb(94, 234, 212);
  font-size: 11px; font-weight: 500; cursor: pointer;
  transition: all 0.15s; white-space: nowrap;
}
.gd-handoff-btn:hover { background: rgba(45, 212, 191, 0.22); }

/* ═══ 统计卡片 ═══ */
.gd-stat {
  padding: 12px 14px; border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.gd-stat-label { font-size: 11px; color: rgba(255, 255, 255, 0.35); margin-bottom: 4px; }
.gd-stat-value { font-size: 20px; font-weight: 600; }

/* ═══ 色彩 legend ═══ */
.gd-legend {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
  padding: 8px 12px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 11px; color: rgba(255, 255, 255, 0.45);
}
.gd-legend > span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.gd-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }

/* ═══ 列表 ═══ */
.gd-section-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase; letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.gd-list {
  border-radius: 10px; overflow: hidden;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.gd-list-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; font-size: 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.12s;
}
.gd-list-row:last-child { border-bottom: none; }
.gd-list-row:hover { background: rgba(255, 255, 255, 0.03); }
.gd-list-row.is-current { background: rgba(45, 212, 191, 0.06); }
.gd-list-row.is-current:hover { background: rgba(45, 212, 191, 0.1); }

.gd-status-badge {
  font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 4px;
  font-family: ui-monospace, monospace; text-transform: uppercase;
}

/* 行内操作（hover 才显，降低噪音） */
.gd-row-actions {
  display: flex; align-items: center; gap: 2px; flex-shrink: 0;
  opacity: 0; transition: opacity 0.12s;
}
.gd-list-row:hover .gd-row-actions,
.gd-list-row:focus-within .gd-row-actions { opacity: 1; }
@media (hover: none) {
  .gd-row-actions { opacity: 1; } /* 触屏始终可见 */
}

.gd-mini-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 6px;
  background: rgba(255, 255, 255, 0.04); color: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer; transition: all 0.15s; flex-shrink: 0;
}
.gd-mini-btn:hover { background: rgba(45, 212, 191, 0.12); color: rgb(94, 234, 212); border-color: rgba(45, 212, 191, 0.25); }
.gd-mini-btn.danger:hover { background: rgba(244, 63, 94, 0.12); color: rgb(251, 113, 133); border-color: rgba(244, 63, 94, 0.25); }
.gd-mini-btn.text {
  width: auto; padding: 3px 9px; font-size: 11px;
  gap: 2px;
}

/* ═══ Blame ═══ */
.gd-blame-box {
  background: rgba(0, 0, 0, 0.22);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  max-height: 280px; overflow-y: auto;
  scrollbar-width: thin;
}
.gd-blame-row {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 12px; font-size: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}
.gd-blame-row:hover { background: rgba(255, 255, 255, 0.03); }

/* ═══ 标签详情面板 ═══ */
.gd-tag-detail {
  padding: 12px 14px;
  background: rgba(0, 0, 0, 0.18);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex; flex-direction: column; gap: 12px;
}
.gd-tag-meta { line-height: 1.5; }
.gd-tag-commits { display: flex; flex-direction: column; gap: 4px; }
.gd-tag-commit-list {
  max-height: 320px; overflow-y: auto;
  scrollbar-width: thin;
}
.gd-tag-actions {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
.gd-tag-actions .gd-confirm-btn { display: inline-flex; align-items: center; gap: 4px; }

/* ═══ 版本分组头（仅 semver 排序时出现）═══ */
.gd-tag-group-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; font-size: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  border-left: 3px solid;
  cursor: pointer; user-select: none;
  transition: filter 0.12s;
}
.gd-tag-group-header:hover { filter: brightness(1.12); }
.gd-tag-group-header:focus-visible { outline: 2px solid rgba(94, 234, 212, 0.5); outline-offset: -2px; }

/* ═══ 标签创建表单（竖向字段） ═══ */
.gd-tag-create { display: flex; flex-direction: column; gap: 12px; }
.gd-form-field { display: flex; flex-direction: column; gap: 5px; }
.gd-field-label {
  font-size: 11px; font-weight: 600; color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.02em;
}
.gd-field-hint {
  font-size: 11px; line-height: 1.45; color: rgba(255, 255, 255, 0.38);
}
.gd-field-hint.danger { color: rgb(252, 165, 165); }
.gd-field-hint.ok { color: rgb(134, 239, 172); }

/* 分段选择（annotated/轻量、日期/版本 排序等） */
.gd-seg-group { display: inline-flex; gap: 2px; }
.gd-seg {
  padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 500;
  background: rgba(255, 255, 255, 0.04); color: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer; transition: all 0.15s;
}
.gd-seg:hover { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.72); }
.gd-seg.active {
  background: rgba(45, 212, 191, 0.14); color: rgb(94, 234, 212);
  border-color: rgba(45, 212, 191, 0.28);
}

/* ═══ 标签工具栏（搜索 / 排序 / 批量） ═══ */
.gd-tag-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.gd-input-sm { padding: 5px 10px 5px 30px; font-size: 12px; }

/* 文字链接按钮（清除搜索等） */
.gd-link-btn {
  color: rgb(94, 234, 212); cursor: pointer; font-size: 12px;
  background: none; border: none; padding: 0;
}
.gd-link-btn:hover { text-decoration: underline; }

/* ═══ 输入 ═══ */
.gd-input {
  width: 100%; padding: 8px 12px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8); font-size: 13px;
  outline: none; transition: border-color 0.15s;
}
.gd-input::placeholder { color: rgba(255, 255, 255, 0.25); }
.gd-input:focus { border-color: rgba(45, 212, 191, 0.35); }
select.gd-input { cursor: pointer; }
/* <option> 在 Windows 下不继承 <select> 的背景，只继承白字 → 白字白底看不清；显式配深色 */
.gd-input option {
  background-color: rgb(15, 23, 42);
  color: rgba(255, 255, 255, 0.88);
}
.gd-prefix-select { width: auto; flex-shrink: 0; padding-right: 28px; }
.gd-textarea { resize: vertical; min-height: 56px; font-family: inherit; line-height: 1.5; }

/* ═══ 内联表单 ═══ */
.gd-inline-form {
  padding: 12px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.gd-inline-form.gd-danger-zone {
  background: rgba(244, 63, 94, 0.05);
  border-color: rgba(244, 63, 94, 0.2);
}
.gd-form-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gd-check-inline {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: rgba(255, 255, 255, 0.5); cursor: pointer;
}
.gd-check-inline input { accent-color: rgb(45, 212, 191); }

/* ═══ 确认按钮 ═══ */
.gd-confirm-btn {
  padding: 5px 16px; border-radius: 7px;
  font-size: 12px; font-weight: 500; cursor: pointer;
  transition: all 0.15s; white-space: nowrap;
}
.gd-confirm-btn.cancel {
  background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.gd-confirm-btn.cancel:hover { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.7); }
.gd-confirm-btn.ok {
  background: rgba(45, 212, 191, 0.15); color: rgb(94, 234, 212);
  border: 1px solid rgba(45, 212, 191, 0.3);
}
.gd-confirm-btn.ok:hover { background: rgba(45, 212, 191, 0.25); }
.gd-confirm-btn.ok:disabled { opacity: 0.4; cursor: not-allowed; }
.gd-confirm-btn.ok.ghost {
  background: rgba(255, 255, 255, 0.04); color: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.1);
}
.gd-confirm-btn.ok.ghost:hover { background: rgba(45, 212, 191, 0.12); color: rgb(94, 234, 212); }
.gd-confirm-btn.danger {
  background: rgba(244, 63, 94, 0.15); color: rgb(251, 113, 133);
  border: 1px solid rgba(244, 63, 94, 0.3);
}
.gd-confirm-btn.danger:hover { background: rgba(244, 63, 94, 0.25); }

/* ═══ 复选框 ═══ */
.gd-checkbox {
  display: inline-flex; align-items: center; justify-content: center;
  position: relative; width: 16px; height: 16px; flex-shrink: 0; cursor: pointer;
}
.gd-checkbox input { position: absolute; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.gd-check-mark {
  width: 14px; height: 14px; border-radius: 3px;
  border: 1.5px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.04);
  transition: all 0.15s;
}
.gd-checkbox input:checked + .gd-check-mark {
  background: rgba(45, 212, 191, 0.2);
  border-color: rgba(45, 212, 191, 0.5);
}
.gd-checkbox input:checked + .gd-check-mark::after {
  content: '✓'; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px; font-weight: 700; color: rgb(94, 234, 212);
}

/* ═══ 批量操作工具栏 ═══ */
.gd-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 10px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  flex-wrap: wrap;
}

/* ═══ Commit 栏 ═══ */
.gd-commit-bar { background: rgba(0, 0, 0, 0.15); }

/* ═══ Pull/Push 预览列表（v-html 注入，需 :deep 穿透） ═══ */
:deep(.gd-preview-list) {
  margin: 4px 0 2px; padding-left: 18px;
  font-size: 11px; line-height: 1.7;
  list-style: disc;
}

/* ═══ 焦点可见 ═══ */
.gd-card :focus-visible {
  outline: 2px solid rgba(94, 234, 212, 0.6);
  outline-offset: 1px;
  border-radius: 4px;
}

/* ═══ 降低动效（覆盖 accent / sheen / spin / transition） ═══ */
@media (prefers-reduced-motion: reduce) {
  .gd-accent,
  .gd-card::after,
  .gd-spin,
  .gd-action.is-loading :first-child { animation: none !important; }
  .gd-card::after { background: none; }
  .gd-action,
  .gd-mini-btn,
  .gd-confirm-btn,
  .gd-tab,
  .gd-list-row,
  .gd-icon-btn,
  .gd-handoff-btn,
  .gd-dropdown-item { transition: none !important; }
}
</style>
