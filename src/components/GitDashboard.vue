<script setup lang="ts">
/**
 * Git 仓库信息仪表盘
 *
 * 展示 wbscf-web 代码库的完整 git 信息（本地 + 远端），包括：
 *   - 概览：当前分支、同步状态、快捷统计、最近提交
 *   - 分支：本地 / 远端分支列表（可搜索、可切换、可创建/删除）
 *   - 提交：commit 日志（可展开查看详情）
 *   - 变更：工作区文件变更（勾选暂存/取消暂存、提交）
 *   - 标签：tag 管理（创建/删除/推送）+ stash 管理（暂存/恢复/丢弃）
 *
 * 由状态栏 GitWidget 点击打开。
 * 使用 HUD 玻璃面板风格。
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { useGitDashboard } from '@/features/git'
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

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const dash = useGitDashboard()

// ─── 标签页 ────────────────────────────────────────

type TabKey = 'overview' | 'branches' | 'commits' | 'changes' | 'tags'
const activeTab = ref<TabKey>('overview')
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'branches', label: '分支' },
  { key: 'commits', label: '提交' },
  { key: 'changes', label: '变更' },
  { key: 'tags', label: '标签' },
]

// ─── More 下拉菜单 ─────────────────────────────────

const showMoreMenu = ref(false)

function toggleMoreMenu() {
  showMoreMenu.value = !showMoreMenu.value
}
function closeMoreMenu() {
  showMoreMenu.value = false
}

// 点击外部关闭
function onBackdropClick(e: MouseEvent) {
  // 只关闭下拉菜单，不关闭弹窗
  if (showMoreMenu.value) {
    closeMoreMenu()
    e.stopPropagation()
  }
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

/** 远端分支是否已有同名本地分支 */
function hasLocalCounterpart(remoteBranch: { name: string }): boolean {
  const shortName = remoteBranch.name.replace(/^[^/]+\//, '')
  return dash.branches.value.some((b) => b.name === shortName)
}

function shortRemoteName(name: string): string {
  return name.replace(/^[^/]+\//, '')
}

// ─── 创建分支表单 ──────────────────────────────────

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
  if (!name) return
  await dash.doCreateBranch(name, newBranchBase.value.trim() || undefined)
  showCreateBranch.value = false
  newBranchName.value = ''
  newBranchBase.value = ''
}

// ─── 创建标签表单 ──────────────────────────────────

const showCreateTag = ref(false)
const newTagName = ref('')
const newTagMessage = ref('')
const newTagRef = ref('')

function toggleCreateTag() {
  showCreateTag.value = !showCreateTag.value
  if (!showCreateTag.value) {
    newTagName.value = ''
    newTagMessage.value = ''
    newTagRef.value = ''
  }
}

async function submitCreateTag() {
  const name = newTagName.value.trim()
  if (!name) return
  await dash.doCreateTag(name, {
    message: newTagMessage.value.trim() || undefined,
    ref: newTagRef.value.trim() || undefined,
  })
  showCreateTag.value = false
  newTagName.value = ''
  newTagMessage.value = ''
  newTagRef.value = ''
}

// ─── Stash Push ────────────────────────────────────

const showStashForm = ref(false)
const stashMessage = ref('')

function toggleStashForm() {
  showStashForm.value = !showStashForm.value
  if (!showStashForm.value) stashMessage.value = ''
}

async function submitStashPush() {
  await dash.doStashPush(stashMessage.value.trim() || undefined)
  showStashForm.value = false
  stashMessage.value = ''
}

// ─── Diff 查看 ─────────────────────────────────────

const diffLoading = ref(false)
const diffContent = ref('')
const diffTarget = ref('')
const diffCache = new Map<string, string>()

async function viewDiff(key: string, fetcher: () => Promise<string>) {
  if (diffTarget.value === key) {
    diffTarget.value = ''
    diffContent.value = ''
    return
  }
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

// ─── 文件暂存选择（Changes tab） ────────────────────

const selectedFiles = ref<Set<string>>(new Set())

/** 初始化：已暂存的文件默认勾选 */
watch(
  () => dash.status.value.staged,
  (staged) => {
    const next = new Set(selectedFiles.value)
    // 移除不再暂存的
    for (const f of next) {
      if (f.startsWith('staged:') && !staged.some((s) => s.path === f.slice(7))) {
        next.delete(f)
      }
    }
    // 新增刚暂存的
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

// ─── Commit ────────────────────────────────────────

const commitMessage = ref('')

async function doCommit() {
  const msg = commitMessage.value.trim()
  if (!msg || dash.status.value.staged.length === 0) return
  const r = await dash.doCommit(msg)
  if (r.success) {
    commitMessage.value = ''
    diffCache.clear()
  }
}

async function doCommitAll() {
  const msg = commitMessage.value.trim()
  if (!msg || dash.status.value.totalChanges === 0) return
  const r = await dash.doCommit(msg, { all: true })
  if (r.success) {
    commitMessage.value = ''
    diffCache.clear()
  }
}

const canCommit = computed(() =>
  commitMessage.value.trim().length > 0 && dash.status.value.staged.length > 0,
)
const canCommitAll = computed(() =>
  commitMessage.value.trim().length > 0 && dash.status.value.totalChanges > 0,
)

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

// ─── 统一确认栏 ────────────────────────────────────

/** 转义动态文本后才能安全拼进 v-html 的 confirm message */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

// 便捷确认方法
function confirmSwitchBranch(name: string) {
  if (name === dash.branch.value) return
  requestConfirm({
    message: `切换到 <span class="gd-mono text-teal-300">${esc(name)}</span>？`,
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
  requestConfirm({
    message: `确定删除分支 <span class="gd-mono text-rose-300">${esc(name)}</span>？此操作不可撤销`,
    confirmLabel: '删除',
    danger: true,
    onConfirm: async () => { await dash.doDeleteBranch(name) },
  })
}

function confirmDeleteTag(name: string) {
  requestConfirm({
    message: `确定删除标签 <span class="gd-mono text-rose-300">${esc(name)}</span>？`,
    confirmLabel: '删除',
    danger: true,
    onConfirm: async () => { await dash.doDeleteTag(name) },
  })
}

function confirmDropStash(index: string) {
  requestConfirm({
    message: `确定丢弃 <span class="gd-mono text-rose-300">${esc(index)}</span>？此操作不可撤销`,
    confirmLabel: '丢弃',
    danger: true,
    onConfirm: async () => { await dash.doStashDrop(index) },
  })
}

// ─── Header 操作 ───────────────────────────────────

async function handleFetch() {
  closeMoreMenu()
  await dash.doFetch()
  diffCache.clear()
}
async function handlePull() {
  closeMoreMenu()
  await dash.doPull()
  diffCache.clear()
}
async function handlePush() {
  closeMoreMenu()
  await dash.doPush()
  diffCache.clear()
}
async function handlePushTags() {
  closeMoreMenu()
  await dash.doPushTags()
}
async function handleStashPush() {
  closeMoreMenu()
  await dash.doStashPush()
}
async function handleStashPop() {
  closeMoreMenu()
  await dash.doStashPop()
}
async function handleRefresh() {
  await dash.refresh()
  diffCache.clear()
}

// ─── 打开/关闭联动 ─────────────────────────────────
// body 全局已是 overflow:hidden（见全局布局），弹窗自身 fixed inset-0，无需再锁 body

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      dash.open.value = true
    } else {
      dash.open.value = false
      diffTarget.value = ''
      diffContent.value = ''
      confirmDialog.value = null
      showMoreMenu.value = false
      showCreateBranch.value = false
      showCreateTag.value = false
      showStashForm.value = false
    }
  },
)

onUnmounted(() => {
  dash.open.value = false
})

function close() {
  emit('update:open', false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
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
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @keydown="onKeydown"
        @click="onBackdropClick"
      >
        <div class="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" @click="close" />

        <Transition
          appear
          enter-active-class="transition-all duration-300 ease-out"
          leave-active-class="transition-all duration-200 ease-in"
          enter-from-class="opacity-0 translate-y-3 scale-[0.97]"
          leave-to-class="opacity-0 translate-y-2 scale-[0.98]"
        >
          <div
            class="gd-card relative z-10 w-[94vw] max-w-[960px] max-h-[90vh] flex flex-col overflow-hidden"
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
                    <h2 class="text-[15px] font-semibold text-white/90">wbscf-web</h2>
                    <span class="gd-badge">Git</span>
                  </div>
                  <div class="flex items-center gap-3 mt-1 text-[12px] text-white/45">
                    <span class="flex items-center gap-1">
                      <IconBranch class="w-3 h-3" />
                      <span class="gd-mono text-teal-300">{{ dash.branch.value || '—' }}</span>
                    </span>
                    <template v-if="dash.sync.value.hasUpstream">
                      <span v-if="dash.sync.value.ahead" class="text-amber-300">
                        ↑{{ dash.sync.value.ahead }}
                      </span>
                      <span v-if="dash.sync.value.behind" class="text-sky-300">
                        ↓{{ dash.sync.value.behind }}
                      </span>
                      <span v-if="!dash.sync.value.ahead && !dash.sync.value.behind" class="text-emerald-400/70">
                        <IconCheck class="w-3 h-3" />
                      </span>
                    </template>
                    <span v-else class="text-white/30">无 upstream</span>
                    <span v-if="dash.remotes.value.length">
                      {{ dash.remotes.value[0].url }}
                    </span>
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    class="gd-action"
                    :class="{ 'is-loading': dash.actionLoading.value === 'fetch' }"
                    title="拉取远端引用（不合并）— git fetch --all --prune"
                    :disabled="!!dash.actionLoading.value"
                    @click="handleFetch"
                  >
                    <IconDownload class="w-3.5 h-3.5" />
                    <span>Fetch</span>
                  </button>
                  <button
                    class="gd-action"
                    :class="{ 'is-loading': dash.actionLoading.value === 'pull' }"
                    title="拉取并合并远端更新 — git pull"
                    :disabled="!!dash.actionLoading.value"
                    @click="handlePull"
                  >
                    <IconSwitch class="w-3.5 h-3.5" />
                    <span>Pull</span>
                  </button>
                  <button
                    class="gd-action"
                    :class="{ 'is-loading': dash.actionLoading.value === 'push' }"
                    title="推送本地提交到远端 — git push"
                    :disabled="!!dash.actionLoading.value"
                    @click="handlePush"
                  >
                    <IconUpload class="w-3.5 h-3.5" />
                    <span>Push</span>
                  </button>

                  <!-- More 下拉 -->
                  <div class="relative">
                    <button
                      class="gd-action"
                      title="更多操作"
                      :disabled="!!dash.actionLoading.value"
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
                        <button class="gd-dropdown-item" @click="handleFetch">
                          <IconDownload class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">拉取远端引用</span>
                          <span class="gd-dropdown-hint">git fetch --all</span>
                        </button>
                        <button class="gd-dropdown-item" @click="handlePull">
                          <IconSwitch class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">拉取并合并</span>
                          <span class="gd-dropdown-hint">git pull</span>
                        </button>
                        <button class="gd-dropdown-item" @click="handlePush">
                          <IconUpload class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">推送到远端</span>
                          <span class="gd-dropdown-hint">git push</span>
                        </button>
                        <div class="gd-dropdown-divider" />
                        <button class="gd-dropdown-item" @click="handlePushTags">
                          <IconTag class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">推送所有标签</span>
                          <span class="gd-dropdown-hint">git push --tags</span>
                        </button>
                        <button class="gd-dropdown-item" @click="handleStashPush">
                          <IconStash class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">暂存所有变更</span>
                          <span class="gd-dropdown-hint">git stash</span>
                        </button>
                        <button class="gd-dropdown-item" @click="handleStashPop">
                          <IconPop class="w-3.5 h-3.5" />
                          <span class="flex-1 text-left">恢复最近暂存</span>
                          <span class="gd-dropdown-hint">git stash pop</span>
                        </button>
                      </div>
                    </Transition>
                  </div>

                  <div class="w-px h-4 bg-white/10 mx-1" />
                  <button
                    class="gd-action"
                    title="刷新"
                    :disabled="dash.loading.value"
                    @click="handleRefresh"
                  >
                    <IconRefresh class="w-3.5 h-3.5" :class="{ 'animate-spin': dash.loading.value }" />
                  </button>
                  <button
                    class="text-white/40 hover:text-white/80 hover:bg-white/10 rounded-lg p-1.5 transition-colors"
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
                  :class="
                    dash.actionMessage.value.includes('失败') || dash.actionMessage.value.includes('error')
                      ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                      : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                  "
                >
                  <IconLoading v-if="dash.actionLoading.value" class="w-3 h-3 animate-spin" />
                  {{ dash.actionMessage.value }}
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
                <IconLoading class="w-7 h-7 animate-spin text-teal-300/70" />
                <span class="text-sm">加载仓库信息…</span>
              </div>

              <!-- 错误 -->
              <div v-else-if="dash.error.value && !dash.overview.value" class="flex flex-col items-center gap-3 py-20 text-center text-white/55">
                <IconAlert class="w-8 h-8 text-rose-300/70" />
                <p class="text-sm px-6">{{ dash.error.value }}</p>
              </div>

              <!-- ─── 概览 ─── -->
              <div v-else-if="activeTab === 'overview'" class="space-y-5 p-5">
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
                      class="gd-list-row cursor-pointer"
                      @click="viewDiff(`commit-${c.fullHash}`, () => dash.getCommitDetail(c.fullHash))"
                    >
                      <span class="gd-hash">{{ c.hash }}</span>
                      <span class="flex-1 truncate text-white/75">{{ shortMsg(c.message, 55) }}</span>
                      <span class="text-white/35 text-[11px] flex-shrink-0">{{ c.author }}</span>
                      <span class="text-white/30 text-[11px] flex-shrink-0 w-16 text-right">{{ fmtDate(c.date) }}</span>
                      <IconChevronRight
                        class="w-3.5 h-3.5 text-white/20 flex-shrink-0 transition-transform"
                        :class="{ 'rotate-90 text-teal-400/60': diffTarget === `commit-${c.fullHash}` }"
                      />
                    </div>
                    <!-- 展开的 commit diff -->
                    <div v-if="diffTarget.startsWith('commit-')" class="gd-diff-box">
                      <div v-if="diffLoading" class="py-3 text-center text-white/40 text-[12px]">
                        <IconLoading class="w-4 h-4 animate-spin inline" /> 加载中…
                      </div>
                      <pre v-else class="gd-diff">{{ diffContent || '(无 diff 输出)' }}</pre>
                    </div>
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
              </div>

              <!-- ─── 分支 ─── -->
              <div v-else-if="activeTab === 'branches'" class="space-y-4 p-5">
                <!-- 搜索 + 新建 -->
                <div class="flex gap-2">
                  <div class="relative flex-1">
                    <IconSearch class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input
                      v-model="branchSearch"
                      type="text"
                      placeholder="搜索分支…"
                      class="gd-input pl-9"
                    />
                  </div>
                  <button class="gd-action" @click="toggleCreateBranch">
                    <IconPlus class="w-3.5 h-3.5" />
                    <span>新建分支</span>
                  </button>
                </div>

                <!-- 创建分支表单 -->
                <Transition
                  enter-active-class="transition-all duration-200"
                  leave-active-class="transition-all duration-150"
                  enter-from-class="opacity-0 -translate-y-2"
                  leave-to-class="opacity-0 -translate-y-2"
                >
                  <div v-if="showCreateBranch" class="gd-inline-form">
                    <div class="gd-form-row">
                      <input
                        v-model="newBranchName"
                        type="text"
                        placeholder="分支名称 *"
                        class="gd-input flex-1"
                        @keydown.enter="submitCreateBranch"
                      />
                      <input
                        v-model="newBranchBase"
                        type="text"
                        placeholder="基于分支（可选，默认 HEAD）"
                        class="gd-input flex-1"
                        @keydown.enter="submitCreateBranch"
                      />
                      <button
                        class="gd-confirm-btn ok"
                        :disabled="!newBranchName.trim()"
                        @click="submitCreateBranch"
                      >
                        创建
                      </button>
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
                      <span class="gd-mono flex-1 truncate" :class="b.current ? 'text-teal-300' : 'text-white/70'">
                        {{ b.name }}
                      </span>
                      <span class="gd-hash flex-shrink-0">{{ b.hash }}</span>
                      <span v-if="b.ahead" class="text-amber-400/80 text-[11px]">↑{{ b.ahead }}</span>
                      <span v-if="b.behind" class="text-sky-400/80 text-[11px]">↓{{ b.behind }}</span>
                      <span class="text-white/35 text-[11px] truncate max-w-[180px]">{{ shortMsg(b.message, 35) }}</span>
                      <button
                        v-if="!b.current"
                        class="gd-mini-btn"
                        title="切换到此分支"
                        @click.stop="confirmSwitchBranch(b.name)"
                      >
                        <IconSwitch class="w-3 h-3" />
                      </button>
                      <button
                        v-if="!b.current"
                        class="gd-mini-btn danger"
                        title="删除此分支"
                        @click.stop="confirmDeleteBranch(b.name)"
                      >
                        <IconTrash class="w-3 h-3" />
                      </button>
                    </div>
                    <div v-if="filteredBranches.length === 0" class="py-6 text-center text-white/30 text-[12px]">
                      无匹配分支
                    </div>
                  </div>
                </div>

                <!-- 远端分支 -->
                <div>
                  <button
                    class="gd-section-title cursor-pointer hover:text-white/60 transition-colors"
                    @click="showRemoteBranches = !showRemoteBranches"
                  >
                    <IconChevronRight
                      class="w-3.5 h-3.5 transition-transform"
                      :class="{ 'rotate-90': showRemoteBranches }"
                    />
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
                        @click.stop="confirmCheckoutRemote(b.name)"
                      >
                        <IconDownload class="w-3 h-3" />
                      </button>
                      <span
                        v-else
                        class="text-white/20 text-[10px] flex-shrink-0"
                        title="已有同名本地分支"
                      >已有</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- ─── 提交 ─── -->
              <div v-else-if="activeTab === 'commits'" class="space-y-1 p-5">
                <div class="gd-list">
                  <template v-for="c in dash.commits.value" :key="c.fullHash">
                    <div
                      class="gd-list-row cursor-pointer"
                      @click="viewDiff(`c-${c.fullHash}`, () => dash.getCommitDetail(c.fullHash))"
                    >
                      <IconCommit class="w-3.5 h-3.5 flex-shrink-0 text-white/25" />
                      <span class="gd-hash flex-shrink-0">{{ c.hash }}</span>
                      <span class="flex-1 truncate text-white/75">{{ c.message }}</span>
                      <span class="text-white/35 text-[11px] flex-shrink-0">{{ c.author }}</span>
                      <span class="text-white/30 text-[11px] flex-shrink-0 w-16 text-right">{{ fmtDate(c.date) }}</span>
                      <IconChevronRight
                        class="w-3.5 h-3.5 text-white/20 flex-shrink-0 transition-transform"
                        :class="{ 'rotate-90 text-teal-400/60': diffTarget === `c-${c.fullHash}` }"
                      />
                    </div>
                    <div v-if="diffTarget === `c-${c.fullHash}`" class="gd-diff-box">
                      <div v-if="diffLoading" class="py-3 text-center text-white/40 text-[12px]">
                        <IconLoading class="w-4 h-4 animate-spin inline" /> 加载中…
                      </div>
                      <pre v-else class="gd-diff">{{ diffContent || '(无 diff 输出)' }}</pre>
                    </div>
                  </template>
                  <div v-if="dash.commits.value.length === 0" class="py-10 text-center text-white/30 text-[12px]">
                    暂无提交记录
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
                      <span class="text-[11px] text-white/35">
                        已选 {{ selectedModifiedCount + selectedStagedCount }} 个文件
                      </span>
                      <button
                        v-if="selectedModifiedCount > 0"
                        class="gd-confirm-btn ok text-[11px]"
                        @click="stageSelected"
                      >
                        暂存选中 ({{ selectedModifiedCount }})
                      </button>
                      <button
                        v-if="selectedStagedCount > 0"
                        class="gd-confirm-btn cancel text-[11px]"
                        @click="unstageSelected"
                      >
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
                              <input
                                type="checkbox"
                                :checked="selectedFiles.has('staged:' + f.path)"
                                @change="toggleFileSelection('staged:' + f.path)"
                              />
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
                          <div v-if="diffTarget === 'staged-' + f.path" class="gd-diff-box">
                            <div v-if="diffLoading" class="py-3 text-center text-white/40 text-[12px]">
                              <IconLoading class="w-4 h-4 animate-spin inline" /> 加载中…
                            </div>
                            <pre v-else class="gd-diff">{{ diffContent || '(无 diff 输出)' }}</pre>
                          </div>
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
                              <input
                                type="checkbox"
                                :checked="selectedFiles.has('mod:' + f.path)"
                                @change="toggleFileSelection('mod:' + f.path)"
                              />
                              <span class="gd-check-mark" />
                            </label>
                            <IconFile class="w-3.5 h-3.5 flex-shrink-0 text-amber-400/60" />
                            <span class="text-white/40 text-[11px]">{{ fileDir(f.path) }}</span>
                            <span class="gd-mono text-amber-300/80 flex-1 truncate">{{ fileName(f.path) }}</span>
                            <span class="gd-status-badge bg-amber-500/15 text-amber-400">{{ f.worktree || f.index }}</span>
                            <IconChevronRight
                              class="w-3.5 h-3.5 text-white/20 flex-shrink-0 transition-transform"
                              :class="{ 'rotate-90 text-teal-400/60': diffTarget === 'mod-' + f.path }"
                            />
                          </div>
                          <div v-if="diffTarget === 'mod-' + f.path" class="gd-diff-box">
                            <div v-if="diffLoading" class="py-3 text-center text-white/40 text-[12px]">
                              <IconLoading class="w-4 h-4 animate-spin inline" /> 加载中…
                            </div>
                            <pre v-else class="gd-diff">{{ diffContent || '(无 diff 输出)' }}</pre>
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
                        <div
                          v-for="f in dash.status.value.untracked"
                          :key="'u-' + f.path"
                          class="gd-list-row border-l-2 border-l-sky-500/30"
                        >
                          <label class="gd-checkbox" @click.stop>
                            <input
                              type="checkbox"
                              :checked="selectedFiles.has('untracked:' + f.path)"
                              @change="toggleFileSelection('untracked:' + f.path)"
                            />
                            <span class="gd-check-mark" />
                          </label>
                          <IconFile class="w-3.5 h-3.5 flex-shrink-0 text-sky-400/50" />
                          <span class="text-white/40 text-[11px]">{{ fileDir(f.path) }}</span>
                          <span class="gd-mono text-sky-300/70 flex-1 truncate">{{ fileName(f.path) }}</span>
                          <span class="gd-status-badge bg-sky-500/15 text-sky-400">?</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Commit 栏 -->
                  <div class="gd-commit-bar flex-shrink-0 px-5 py-3 border-t border-white/8">
                    <div class="flex items-center gap-2">
                      <input
                        v-model="commitMessage"
                        type="text"
                        placeholder="输入提交信息…"
                        class="gd-input flex-1"
                        @keydown.enter="doCommit"
                      />
                      <button
                        class="gd-confirm-btn ok"
                        :disabled="!!dash.actionLoading.value || !canCommit"
                        title="提交已暂存的文件"
                        @click="doCommit"
                      >
                        提交
                      </button>
                      <button
                        class="gd-confirm-btn ok"
                        :disabled="!!dash.actionLoading.value || !canCommitAll"
                        title="暂存所有变更并提交（git commit -a）"
                        @click="doCommitAll"
                      >
                        全部暂存并提交
                      </button>
                    </div>
                    <div class="flex items-center gap-3 mt-1.5 text-[11px] text-white/35">
                      <span>已暂存 {{ dash.status.value.staged.length }} 个文件</span>
                      <span v-if="dash.status.value.modified.length">· {{ dash.status.value.modified.length }} 个未暂存</span>
                      <span v-if="dash.status.value.untracked.length">· {{ dash.status.value.untracked.length }} 个未跟踪</span>
                    </div>
                  </div>
                </template>
              </div>

              <!-- ─── 标签 ─── -->
              <div v-else-if="activeTab === 'tags'" class="space-y-5 p-5">
                <!-- Tags -->
                <div>
                  <div class="gd-section-title justify-between">
                    <div class="flex items-center gap-1.5">
                      <IconTag class="w-3.5 h-3.5" />
                      Tags ({{ dash.tags.value.length }})
                    </div>
                    <div class="flex items-center gap-1.5">
                      <button class="gd-action text-[11px]" @click="handlePushTags">
                        <IconUpload class="w-3 h-3" />
                        <span>Push Tags</span>
                      </button>
                      <button class="gd-action text-[11px]" @click="toggleCreateTag">
                        <IconPlus class="w-3 h-3" />
                        <span>新建标签</span>
                      </button>
                    </div>
                  </div>

                  <!-- 创建标签表单 -->
                  <Transition
                    enter-active-class="transition-all duration-200"
                    leave-active-class="transition-all duration-150"
                    enter-from-class="opacity-0 -translate-y-2"
                    leave-to-class="opacity-0 -translate-y-2"
                  >
                    <div v-if="showCreateTag" class="gd-inline-form mb-2">
                      <div class="gd-form-row">
                        <input
                          v-model="newTagName"
                          type="text"
                          placeholder="标签名称 *"
                          class="gd-input flex-1"
                          @keydown.enter="submitCreateTag"
                        />
                        <input
                          v-model="newTagMessage"
                          type="text"
                          placeholder="备注消息（可选）"
                          class="gd-input flex-1"
                          @keydown.enter="submitCreateTag"
                        />
                        <input
                          v-model="newTagRef"
                          type="text"
                          placeholder="Ref（可选，默认 HEAD）"
                          class="gd-input w-32"
                          @keydown.enter="submitCreateTag"
                        />
                        <button
                          class="gd-confirm-btn ok"
                          :disabled="!newTagName.trim()"
                          @click="submitCreateTag"
                        >
                          创建
                        </button>
                        <button class="gd-confirm-btn cancel" @click="toggleCreateTag">取消</button>
                      </div>
                    </div>
                  </Transition>

                  <div v-if="dash.tags.value.length" class="gd-list">
                    <div v-for="t in dash.tags.value" :key="t.name" class="gd-list-row">
                      <IconTag class="w-3.5 h-3.5 flex-shrink-0 text-violet-400/60" />
                      <span class="gd-mono text-violet-300/80 flex-shrink-0">{{ t.name }}</span>
                      <span class="gd-hash flex-shrink-0">{{ t.hash }}</span>
                      <span class="flex-1 truncate text-white/50 text-[12px]">{{ t.message }}</span>
                      <span class="text-white/30 text-[11px] flex-shrink-0">{{ fmtDate(t.date) }}</span>
                      <button
                        class="gd-mini-btn danger"
                        title="删除此标签"
                        @click.stop="confirmDeleteTag(t.name)"
                      >
                        <IconTrash class="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div v-else class="py-6 text-center text-white/30 text-[12px]">暂无标签</div>
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
                      <span>暂存变更</span>
                    </button>
                  </div>

                  <!-- Stash push 表单 -->
                  <Transition
                    enter-active-class="transition-all duration-200"
                    leave-active-class="transition-all duration-150"
                    enter-from-class="opacity-0 -translate-y-2"
                    leave-to-class="opacity-0 -translate-y-2"
                  >
                    <div v-if="showStashForm" class="gd-inline-form mb-2">
                      <div class="gd-form-row">
                        <input
                          v-model="stashMessage"
                          type="text"
                          placeholder="暂存说明（可选）"
                          class="gd-input flex-1"
                          @keydown.enter="submitStashPush"
                        />
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
                      <button
                        class="gd-mini-btn"
                        title="应用此暂存（保留 stash）"
                        @click.stop="dash.doStashApply(s.index)"
                      >
                        <IconPlay class="w-3 h-3" />
                      </button>
                      <button
                        v-if="s.index === 'stash@{0}'"
                        class="gd-mini-btn"
                        title="弹出此暂存（应用并删除）"
                        @click.stop="dash.doStashPop()"
                      >
                        <IconPop class="w-3 h-3" />
                      </button>
                      <button
                        class="gd-mini-btn danger"
                        title="丢弃此暂存"
                        @click.stop="confirmDropStash(s.index)"
                      >
                        <IconTrash class="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div v-else class="py-4 text-center text-white/25 text-[12px]">暂无 stash</div>
                </div>

                <!-- 远端信息 -->
                <div>
                  <div class="gd-section-title">
                    <IconSync class="w-3.5 h-3.5" />
                    远端
                  </div>
                  <div class="gd-list">
                    <div v-for="r in dash.remotes.value" :key="r.name" class="gd-list-row">
                      <span class="gd-mono text-teal-300/70 flex-shrink-0">{{ r.name }}</span>
                      <span class="flex-1 truncate text-white/45 text-[12px] gd-mono">{{ r.url }}</span>
                    </div>
                  </div>
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
                <span class="text-[13px] text-white/70" v-html="confirmDialog.message" />
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

/* 入场微光 */
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
.gd-action.is-loading :first-child { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

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
.gd-dropdown-item:hover {
  background: rgba(45, 212, 191, 0.1); color: rgb(94, 234, 212);
}
.gd-dropdown-hint {
  font-family: ui-monospace, monospace;
  font-size: 10px; color: rgba(255, 255, 255, 0.25);
}
.gd-dropdown-divider {
  height: 1px; margin: 3px 8px;
  background: rgba(255, 255, 255, 0.06);
}

/* ═══ 标签页 ═══ */
.gd-tab {
  position: relative; padding: 6px 14px; font-size: 13px; font-weight: 500;
  color: rgba(255, 255, 255, 0.4); cursor: pointer;
  border-radius: 8px 8px 0 0; transition: all 0.15s;
  display: flex; align-items: center; gap: 4px;
}
.gd-tab:hover { color: rgba(255, 255, 255, 0.65); }
.gd-tab.active {
  color: rgb(94, 234, 212);
  background: rgba(45, 212, 191, 0.06);
}
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

/* ═══ 统计卡片 ═══ */
.gd-stat {
  padding: 12px 14px; border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.gd-stat-label { font-size: 11px; color: rgba(255, 255, 255, 0.35); margin-bottom: 4px; }
.gd-stat-value { font-size: 20px; font-weight: 600; }

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

.gd-mini-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 6px;
  background: rgba(255, 255, 255, 0.04); color: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer; transition: all 0.15s; flex-shrink: 0;
}
.gd-mini-btn:hover {
  background: rgba(45, 212, 191, 0.12); color: rgb(94, 234, 212);
  border-color: rgba(45, 212, 191, 0.25);
}
.gd-mini-btn.danger:hover {
  background: rgba(244, 63, 94, 0.12); color: rgb(251, 113, 133);
  border-color: rgba(244, 63, 94, 0.25);
}

/* ═══ Diff ═══ */
.gd-diff-box {
  background: rgba(0, 0, 0, 0.25);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.gd-diff {
  margin: 0; padding: 12px 16px;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 12px; line-height: 1.65;
  color: rgba(255, 255, 255, 0.6);
  white-space: pre-wrap; word-break: break-all;
  overflow-x: auto; max-height: 300px; overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

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

/* ═══ 内联表单 ═══ */
.gd-inline-form {
  padding: 10px 12px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.gd-form-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}

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
.gd-checkbox input {
  position: absolute; opacity: 0; width: 100%; height: 100%; cursor: pointer;
}
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
  content: '✓';
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px; font-weight: 700;
  color: rgb(94, 234, 212);
}

/* ═══ 批量操作工具栏 ═══ */
.gd-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

/* ═══ Commit 栏 ═══ */
.gd-commit-bar {
  background: rgba(0, 0, 0, 0.15);
}

/* ═══ 降低动效 ═══ */
@media (prefers-reduced-motion: reduce) {
  .gd-accent { animation: none; }
  .gd-card::after { animation: none; background: none; }
}
</style>
