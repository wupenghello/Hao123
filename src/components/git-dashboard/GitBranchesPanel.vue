<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGitDashboard, type GitBranch } from '@/features/git'
import IconBranch from '~icons/mdi/source-branch'
import IconChevronRight from '~icons/mdi/chevron-right'
import IconDownload from '~icons/mdi/download'
import IconMerge from '~icons/mdi/source-merge'
import IconPlus from '~icons/mdi/plus'
import IconSearch from '~icons/mdi/magnify'
import IconSwitch from '~icons/mdi/source-branch-sync'
import IconTrash from '~icons/mdi/delete-outline'

const props = defineProps<{ ready: boolean }>()
const emit = defineEmits<{
  checkout: [name: string]
  checkoutRemote: [name: string]
  delete: [name: string]
  merge: [source: string, options: { noCommit: boolean }]
}>()

const dash = useGitDashboard()

const branchSearch = ref('')
const showRemoteBranches = ref(false)
const showCreateBranch = ref(false)
const newBranchName = ref('')
const newBranchBase = ref('')
const showMergeForm = ref(false)
const mergeSource = ref('')
const mergeNoCommit = ref(false)

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

function hasLocalCounterpart(remoteBranch: GitBranch): boolean {
  const shortName = shortRemoteName(remoteBranch.name)
  return dash.branches.value.some((b) => b.name === shortName)
}

function shortRemoteName(name: string): string {
  return name.replace(/^[^/]+\//, '')
}

function shortMsg(msg: string, max = 60): string {
  return msg.length > max ? msg.slice(0, max) + '…' : msg
}

function toggleCreateBranch() {
  showCreateBranch.value = !showCreateBranch.value
  if (!showCreateBranch.value) {
    newBranchName.value = ''
    newBranchBase.value = ''
  }
}

async function submitCreateBranch() {
  const name = newBranchName.value.trim()
  if (!props.ready || !name) return
  await dash.doCreateBranch(name, newBranchBase.value.trim() || undefined)
  showCreateBranch.value = false
  newBranchName.value = ''
  newBranchBase.value = ''
}

function toggleMergeForm() {
  showMergeForm.value = !showMergeForm.value
  if (!showMergeForm.value) {
    mergeSource.value = ''
    mergeNoCommit.value = false
  }
}

function openMergeForm() {
  showMergeForm.value = true
}

function submitMerge() {
  const source = mergeSource.value.trim()
  if (!props.ready || !source) return
  emit('merge', source, { noCommit: mergeNoCommit.value })
}

defineExpose({ openMergeForm })
</script>

<template>
  <div class="space-y-4 p-5">
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
            @click.stop="emit('checkout', b.name)"
          >
            <IconSwitch class="w-3 h-3" />
          </button>
          <button
            v-if="!b.current"
            class="gd-mini-btn danger"
            title="删除此分支"
            :aria-label="`删除分支 ${b.name}`"
            @click.stop="emit('delete', b.name)"
          >
            <IconTrash class="w-3 h-3" />
          </button>
        </div>
        <div v-if="filteredBranches.length === 0" class="py-6 text-center text-white/30 text-[12px]">无匹配分支</div>
      </div>
    </div>

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
            @click.stop="emit('checkoutRemote', b.name)"
          >
            <IconDownload class="w-3 h-3" />
          </button>
          <span v-else class="text-white/20 text-[10px] flex-shrink-0" title="已有同名本地分支">已有</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gd-input {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.86);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  outline: none;
}
.gd-input:focus {
  border-color: rgba(45, 212, 191, 0.45);
  box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.08);
}
.gd-action,
.gd-confirm-btn,
.gd-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s;
}
.gd-action {
  height: 32px;
  padding: 0 11px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.76);
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.gd-action:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.11);
}
.gd-inline-form {
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.09);
}
.gd-form-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.gd-check-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.58);
}
.gd-confirm-btn {
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 650;
}
.gd-confirm-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.gd-confirm-btn.ok {
  color: #dffdf8;
  background: rgba(20, 184, 166, 0.36);
  border: 1px solid rgba(45, 212, 191, 0.3);
}
.gd-confirm-btn.cancel {
  color: rgba(255, 255, 255, 0.62);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.gd-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 650;
  color: rgba(255, 255, 255, 0.58);
}
.gd-list {
  display: grid;
  gap: 6px;
}
.gd-list-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.075);
}
.gd-list-row.is-current {
  background: rgba(45, 212, 191, 0.08);
  border-color: rgba(45, 212, 191, 0.22);
}
.gd-mono,
.gd-hash {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.gd-hash {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}
.gd-mini-btn {
  width: 25px;
  height: 25px;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.46);
  background: rgba(255, 255, 255, 0.06);
}
.gd-mini-btn:hover {
  color: rgba(255, 255, 255, 0.88);
  background: rgba(255, 255, 255, 0.1);
}
.gd-mini-btn.danger:hover {
  color: rgb(253, 164, 175);
  background: rgba(244, 63, 94, 0.12);
}
</style>
