<script setup lang="ts">
/**
 * 首页统一收件箱：把「指派给我的禅道任务 / Bug」与「本地待办」整合进**一个清单**。
 *
 * 取代原来分开的 ZentaoInbox + LocalTaskPanel：不再两块面板并排，而是一条按
 * 「紧急 → 优先级 → 截止日期」排序的统一待办流，用类型徽标（任务 / Bug / 本地）区分来源。
 *   - 禅道项：只读，点击行 → 各自详情弹窗（TaskDetailModal / BugDetailModal）。
 *   - 本地项：可交互——圆点勾选完成、点标题编辑、悬停出删除（二次确认），支持图片/文件附件。
 *   - 新建按钮：创建本地待办（禅道任务无法在此新建，禅道是只读来源）。
 *
 * 数据来源：禅道（task/bug store 的 assigned 维度，配置后才加载）+ 本地（localStorage，始终可用）。
 * 未配置禅道时，本地待办即清单主角；两者都空时给清闲空态 + 创建入口。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useTaskStore, useBugStore, TaskDetailModal, BugDetailModal } from '@/features/zentao'
import {
  priorityBadge as ztPri,
  hasDeadline as ztHasDeadline,
  isOverdue as ztIsOverdue,
  isUrgentTask,
  isUrgentBug,
  taskStatusBadge,
  bugStatusBadge,
  severityBadge,
} from '@/features/zentao'
import type { ZentaoTask, ZentaoBug } from '@/features/zentao'
import { useLocalTaskStore, priBadge, deadlineLabel, isUrgentLocalTask } from '@/features/local-tasks'
import type { LocalTask, LocalTaskFormPayload } from '@/features/local-tasks'
import LocalTaskFormModal from '@/features/local-tasks/components/LocalTaskFormModal.vue'
import IconCheckboxOutline from '~icons/mdi/checkbox-marked-circle-outline'
import IconBug from '~icons/mdi/bug-outline'
import IconCircle from '~icons/mdi/circle-outline'
import IconCheck from '~icons/mdi/check'
import IconClipboardCheck from '~icons/mdi/clipboard-check-outline'
import IconPlus from '~icons/mdi/plus'
import IconPencil from '~icons/mdi/pencil-outline'
import IconTrash from '~icons/mdi/trash-can-outline'
import IconClip from '~icons/mdi/paperclip'
import IconAlert from '~icons/mdi/alert-circle-outline'

const taskStore = useTaskStore()
const bugStore = useBugStore()
const localStore = useLocalTaskStore()

// ============ 统一清单（禅道任务 + 禅道 Bug + 本地待办，合并排序）============
type InboxKind = 'task' | 'bug' | 'local'
interface InboxItem {
  key: string
  kind: InboxKind
  ref: ZentaoTask | ZentaoBug | LocalTask
}

function mkItem(kind: InboxKind, ref: InboxItem['ref']): InboxItem {
  const id = (ref as { id: string | number }).id
  return { key: `${kind}-${id}`, kind, ref }
}

/** 排序键：[紧急(0在前) , 优先级(小在前) , 截止日期(早在前, 无则排末)]；稳定排序保留插入顺序 */
function sortKey(it: InboxItem): [number, number, string] {
  const urgent =
    it.kind === 'task'
      ? isUrgentTask(it.ref as ZentaoTask)
      : it.kind === 'bug'
        ? isUrgentBug(it.ref as ZentaoBug)
        : isUrgentLocalTask(it.ref as LocalTask)
  const pri = it.kind === 'local' ? (it.ref as LocalTask).pri : Number((it.ref as { pri?: string | number }).pri) || 4
  const dl = (it.ref as { deadline?: string }).deadline
  const dlSort = !dl || /^0000/.test(dl) ? '9999-99-99' : String(dl).slice(0, 10)
  return [urgent ? 0 : 1, pri, dlSort]
}

const items = computed<InboxItem[]>(() => {
  const list: InboxItem[] = [
    ...taskStore.assigned.map((t) => mkItem('task', t)),
    ...bugStore.assigned.map((b) => mkItem('bug', b)),
    ...localStore.open.map((t) => mkItem('local', t)),
  ]
  return list.sort((a, b) => {
    const ka = sortKey(a)
    const kb = sortKey(b)
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2])
  })
})

const zentaoConfigured = computed(() => taskStore.configured || bugStore.configured)
const loading = computed(
  () =>
    zentaoConfigured.value &&
    (taskStore.assignedLoading || bugStore.assignedLoading) &&
    items.value.length === 0,
)
/** 禅道正在登录中（加载态文案区分，复刻自旧 ZentaoInbox 的登录提示） */
const zentaoLoggingIn = computed(() => taskStore.loggingIn || bugStore.loggingIn)
/** 禅道加载出错（任一模块失败即视为出错，本地待办不受影响） */
const hasError = computed(() => !!(taskStore.assignedError || bugStore.assignedError))
/** 统一错误文案（任务优先于 Bug） */
const errorMessage = computed(() => taskStore.assignedError || bugStore.assignedError)
/** 重试：重新拉取已配置模块的指派项 */
function retryZentao() {
  if (taskStore.configured) taskStore.loadAssigned()
  if (bugStore.configured) bugStore.loadAssigned()
}
const urgentCount = computed(
  () =>
    taskStore.assigned.filter((t) => isUrgentTask(t)).length +
    bugStore.assigned.filter((b) => isUrgentBug(b)).length +
    localStore.open.filter((t) => isUrgentLocalTask(t)).length,
)
const total = computed(() => items.value.length)
const isEmpty = computed(() => !loading.value && total.value === 0 && localStore.doneCount === 0)

/** 行点击：禅道项打开详情；本地项不在整行绑定点击（标题/圆点各有自己的交互） */
function onRowClick(it: InboxItem) {
  if (it.kind === 'task') taskStore.openDetail((it.ref as ZentaoTask).id)
  else if (it.kind === 'bug') bugStore.openDetail((it.ref as ZentaoBug).id)
}

function isUrgent(it: InboxItem): boolean {
  return it.kind === 'task'
    ? isUrgentTask(it.ref as ZentaoTask)
    : it.kind === 'bug'
      ? isUrgentBug(it.ref as ZentaoBug)
      : isUrgentLocalTask(it.ref as LocalTask)
}

// ============ 本地待办：新建 / 编辑（含附件）============
const formOpen = ref(false)
const editing = ref<LocalTask | null>(null)
function openCreate() {
  editing.value = null
  formOpen.value = true
}
function openEdit(task: LocalTask) {
  editing.value = task
  formOpen.value = true
}
async function onSubmit(payload: LocalTaskFormPayload) {
  const baseInput = { title: payload.title, note: payload.note, pri: payload.pri, deadline: payload.deadline }
  const targetId = editing.value?.id
  if (targetId) {
    for (const attId of payload.removeAttachmentIds) await localStore.removeAttachment(targetId, attId)
    localStore.update(targetId, baseInput)
  } else {
    const created = localStore.add(baseInput)
    if (!created) return
    for (const file of payload.newFiles) await localStore.addAttachment(created.id, file)
    return
  }
  for (const file of payload.newFiles) await localStore.addAttachment(targetId, file)
}

// ============ 本地待办：删除（轻量二次确认）============
const pendingDelete = ref<string | null>(null)
let deleteTimer: ReturnType<typeof setTimeout> | null = null
function onDelete(id: string) {
  if (pendingDelete.value === id) {
    localStore.remove(id)
    pendingDelete.value = null
    if (deleteTimer) clearTimeout(deleteTimer)
    deleteTimer = null
    return
  }
  pendingDelete.value = id
  if (deleteTimer) clearTimeout(deleteTimer)
  deleteTimer = setTimeout(() => {
    pendingDelete.value = null
    deleteTimer = null
  }, 2500)
}

// ============ 已完成折叠 ============
const showDone = ref(false)

// ============ 生命周期：按需加载禅道指派项 ============
onMounted(() => {
  if (taskStore.configured) taskStore.loadAssigned()
  if (bugStore.configured) bugStore.loadAssigned()
})
onUnmounted(() => {
  taskStore.stop()
  bugStore.stop()
})
</script>

<template>
  <section class="w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 backdrop-blur-sm overflow-hidden">
    <!-- 头部 -->
    <header class="flex items-center gap-2 px-4 h-11 border-b border-white/10">
      <span class="zt-pulse" :class="{ 'is-active': total > 0, 'is-urgent': urgentCount > 0 }" />
      <h2 class="text-white/90 text-sm font-medium">待办</h2>
      <span
        v-if="total"
        class="tabular-nums text-[11px] font-medium px-1.5 py-0.5 rounded-full text-teal-200 bg-teal-400/15 ring-1 ring-teal-400/25"
      >{{ total }}</span>
      <span
        v-if="urgentCount > 0"
        class="tabular-nums text-[11px] font-medium px-1.5 py-0.5 rounded-full text-rose-200 bg-rose-400/15 ring-1 ring-rose-400/25"
      >{{ urgentCount }} 紧急</span>

      <div class="ml-auto flex items-center gap-3">
        <button
          v-if="localStore.doneCount"
          class="text-[11px] text-white/40 hover:text-rose-300/90 transition-colors"
          title="清除所有已完成"
          @click="localStore.clearDone()"
        >
          清除已完成 ({{ localStore.doneCount }})
        </button>
        <button
          class="flex items-center gap-1 px-2.5 h-7 rounded-md text-[12px] font-medium text-teal-100 bg-teal-400/15 ring-1 ring-teal-400/30 hover:bg-teal-400/25 transition-colors"
          title="新建本地待办"
          @click="openCreate"
        >
          <IconPlus class="w-3.5 h-3.5" />
          新建
        </button>
      </div>
    </header>

    <!-- 加载中 -->
    <div v-if="loading" class="px-4 py-8 text-center text-sm text-white/45">
      {{ zentaoLoggingIn ? '正在登录禅道…' : '加载中…' }}
    </div>

    <!-- 禅道加载出错且清单无内容可兜底：占满提示 + 重试（本地待办存在时走下面的清单，不被遮蔽） -->
    <div
      v-else-if="hasError && total === 0"
      class="flex flex-col items-center gap-2 py-8 text-center"
    >
      <IconAlert class="w-7 h-7 text-rose-300/70" />
      <p class="text-sm text-white/55">{{ errorMessage }}</p>
      <button
        class="mt-1 px-3 h-7 rounded-md text-xs bg-white/10 text-white/80 hover:bg-white/15 transition-colors"
        @click="retryZentao"
      >
        重试
      </button>
    </div>

    <!-- 空态 -->
    <div v-else-if="isEmpty" class="zt-empty">
      <span class="zt-empty-icon">
        <IconClipboardCheck class="w-6 h-6" />
      </span>
      <p class="zt-empty-title">没有待办</p>
      <p class="zt-empty-sub">禅道指派与本地的待办都会聚到这里</p>
      <button class="zt-empty-create" @click="openCreate">新建一个待办</button>
    </div>

    <!-- 统一清单 -->
    <ul v-else class="max-h-[46vh] overflow-y-auto">
      <li
        v-for="it in items"
        :key="it.key"
        class="zt-row"
        :class="{ 'is-urgent': isUrgent(it), 'is-clickable': it.kind !== 'local' }"
        @click="onRowClick(it)"
      >
        <!-- 禅道任务 -->
        <template v-if="it.kind === 'task'">
          <IconCheckboxOutline class="w-4 h-4 text-sky-300/80 shrink-0" />
          <span class="zt-kind text-sky-200/90 bg-sky-400/10">任务</span>
          <span class="flex-1 min-w-0 truncate text-sm text-white/85">{{ (it.ref as ZentaoTask).name }}</span>
          <span
            v-if="ztIsOverdue((it.ref as ZentaoTask).deadline)"
            class="zt-badge ring-1 ring-inset text-rose-300 bg-rose-400/10 ring-rose-400/30"
          >逾期</span>
          <span
            v-if="ztPri((it.ref as ZentaoTask).pri)"
            class="zt-badge ring-1 ring-inset"
            :class="ztPri((it.ref as ZentaoTask).pri)!.class"
          >{{ ztPri((it.ref as ZentaoTask).pri)!.label }}</span>
          <span class="zt-badge ring-1 ring-inset" :class="taskStatusBadge((it.ref as ZentaoTask).status).class">
            {{ taskStatusBadge((it.ref as ZentaoTask).status).label }}
          </span>
          <span
            v-if="ztHasDeadline((it.ref as ZentaoTask).deadline)"
            class="hidden sm:inline shrink-0 text-[11px] text-white/40 tabular-nums w-[4.5rem] text-right"
            :class="{ '!text-rose-300/80': ztIsOverdue((it.ref as ZentaoTask).deadline) }"
          >{{ (it.ref as ZentaoTask).deadline }}</span>
        </template>

        <!-- 禅道 Bug -->
        <template v-else-if="it.kind === 'bug'">
          <IconBug class="w-4 h-4 text-rose-300/80 shrink-0" />
          <span class="zt-kind text-rose-200/90 bg-rose-400/10">Bug</span>
          <span class="flex-1 min-w-0 truncate text-sm text-white/85">{{ (it.ref as ZentaoBug).title }}</span>
          <span
            v-if="severityBadge((it.ref as ZentaoBug).severity)"
            class="zt-badge ring-1 ring-inset"
            :class="severityBadge((it.ref as ZentaoBug).severity)!.class"
          >{{ severityBadge((it.ref as ZentaoBug).severity)!.label }}</span>
          <span class="zt-badge ring-1 ring-inset" :class="bugStatusBadge((it.ref as ZentaoBug).status).class">
            {{ bugStatusBadge((it.ref as ZentaoBug).status).label }}
          </span>
        </template>

        <!-- 本地待办 -->
        <template v-else>
          <button
            class="zt-check"
            title="标记完成"
            @click.stop="localStore.toggle((it.ref as LocalTask).id)"
          >
            <IconCircle class="w-[18px] h-[18px]" />
          </button>
          <span class="zt-kind text-teal-200/90 bg-teal-400/10">本地</span>
          <div class="flex-1 min-w-0">
            <span
              class="zt-title truncate text-sm text-white/90 cursor-text block"
              :title="(it.ref as LocalTask).title"
              @click.stop="openEdit(it.ref as LocalTask)"
            >{{ (it.ref as LocalTask).title }}</span>
            <p v-if="(it.ref as LocalTask).note" class="zt-note truncate">{{ (it.ref as LocalTask).note }}</p>
          </div>
          <span
            v-if="deadlineLabel((it.ref as LocalTask).deadline)"
            class="zt-dl"
            :class="{ 'is-overdue': ztIsOverdue((it.ref as LocalTask).deadline) }"
          >{{ deadlineLabel((it.ref as LocalTask).deadline) }}</span>
          <span class="zt-badge ring-1 ring-inset" :class="priBadge((it.ref as LocalTask).pri).class">
            {{ priBadge((it.ref as LocalTask).pri).label }}
          </span>
          <span
            v-if="(it.ref as LocalTask).attachments?.length"
            class="zt-att flex items-center gap-0.5 text-white/35"
            :title="`${(it.ref as LocalTask).attachments!.length} 个附件`"
          >
            <IconClip class="w-3.5 h-3.5" />
            <span class="text-[11px] tabular-nums">{{ (it.ref as LocalTask).attachments!.length }}</span>
          </span>
          <button
            class="zt-act"
            :class="{ 'is-confirm': pendingDelete === (it.ref as LocalTask).id }"
            :title="pendingDelete === (it.ref as LocalTask).id ? '再点一次确认删除' : '删除'"
            @click.stop="onDelete((it.ref as LocalTask).id)"
          >
            <IconTrash v-if="pendingDelete !== (it.ref as LocalTask).id" class="w-4 h-4" />
            <IconCheck v-else class="w-4 h-4" />
          </button>
          <button class="zt-act zt-act-edit" title="编辑" @click.stop="openEdit(it.ref as LocalTask)">
            <IconPencil class="w-3.5 h-3.5" />
          </button>
        </template>
      </li>

      <!-- 已完成（本地待办）折叠 -->
      <template v-if="localStore.doneCount">
        <li class="zt-done-head" @click="showDone = !showDone">
          <IconCheck class="w-3.5 h-3.5 text-teal-300/60" />
          <span class="text-[12px] text-white/45">已完成 {{ localStore.doneCount }}</span>
          <span class="zt-chevron text-white/30 transition-transform" :class="{ 'rotate-180': showDone }">▾</span>
        </li>
        <template v-if="showDone">
          <li
            v-for="t in localStore.done"
            :key="`done-${t.id}`"
            class="zt-row is-done"
          >
            <button class="zt-check" title="取消完成" @click.stop="localStore.toggle(t.id)">
              <IconCheck class="w-[18px] h-[18px] text-teal-300" />
            </button>
            <span class="flex-1 min-w-0 truncate text-sm text-white/40 line-through" :title="t.title">
              {{ t.title }}
            </span>
            <button
              class="zt-act"
              :class="{ 'is-confirm': pendingDelete === t.id }"
              :title="pendingDelete === t.id ? '再点一次确认删除' : '删除'"
              @click.stop="onDelete(t.id)"
            >
              <IconTrash v-if="pendingDelete !== t.id" class="w-4 h-4" />
              <IconCheck v-else class="w-4 h-4" />
            </button>
          </li>
        </template>
      </template>
    </ul>

    <!-- 详情 / 编辑弹窗 -->
    <TaskDetailModal />
    <BugDetailModal />
    <LocalTaskFormModal v-model:open="formOpen" :task="editing" @submit="onSubmit" />
  </section>
</template>

<style scoped>
.zt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background-color 0.15s;
}
.zt-row:last-child {
  border-bottom: 0;
}
.zt-row.is-clickable {
  cursor: pointer;
}
.zt-row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.zt-row.is-urgent {
  background: rgba(244, 63, 94, 0.04);
  border-left: 2px solid rgba(244, 63, 94, 0.5);
  padding-left: 14px;
}
.zt-row.is-urgent:hover {
  background: rgba(244, 63, 94, 0.08);
}
.zt-row.is-done {
  opacity: 0.7;
}
.zt-row.is-done:hover {
  opacity: 1;
}

.zt-kind {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 5px;
}
.zt-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
}
.zt-dl {
  flex-shrink: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}
.zt-dl.is-overdue {
  color: #fda4af;
}
.zt-att {
  flex-shrink: 0;
  align-items: center;
}

/* 本地待办：完成勾选圆 */
.zt-check {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: rgba(255, 255, 255, 0.4);
  border-radius: 9999px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.zt-check:hover {
  color: #5eead4;
  background: rgba(45, 212, 191, 0.12);
}
.zt-title {
  line-height: 1.3;
}
.zt-title:hover {
  color: #fff;
}
.zt-note {
  margin-top: 2px;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.4);
}

/* 行内操作（编辑 / 删除）：默认极淡，hover 行或自身才显形 */
.zt-act {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.25);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
  cursor: pointer;
}
.zt-row:hover .zt-act {
  opacity: 1;
}
.zt-act:hover {
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.08);
}
.zt-act.is-confirm {
  opacity: 1;
  color: #fda4af;
  background: rgba(244, 63, 94, 0.14);
}
.zt-act-edit {
  width: 20px;
  height: 20px;
}

/* 已完成折叠头 */
.zt-done-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.15s;
}
.zt-done-head:hover {
  background: rgba(255, 255, 255, 0.04);
}
.zt-chevron {
  margin-left: auto;
  font-size: 11px;
}

/* 空态 */
.zt-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 36px 16px;
  text-align: center;
}
.zt-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-bottom: 4px;
  border-radius: 9999px;
  color: #5eead4;
  background: rgba(45, 212, 191, 0.1);
  box-shadow: 0 0 22px rgba(45, 212, 191, 0.15);
}
.zt-empty-title {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.72);
}
.zt-empty-sub {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.4);
}
.zt-empty-create {
  margin-top: 4px;
  font-size: 12.5px;
  color: #5eead4;
}
.zt-empty-create:hover {
  color: #99f6e4;
}

/* 头部状态点 */
.zt-pulse {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: rgba(148, 163, 184, 0.5);
  flex-shrink: 0;
}
.zt-pulse.is-active {
  background: #2dd4bf;
  box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.6);
  animation: zt-ping 2s ease-out infinite;
}
.zt-pulse.is-urgent {
  background: #fb7185;
  box-shadow: 0 0 0 0 rgba(251, 113, 133, 0.6);
  animation: zt-ping-urgent 2s ease-out infinite;
}
@keyframes zt-ping {
  0% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.5); }
  70% { box-shadow: 0 0 0 7px rgba(45, 212, 191, 0); }
  100% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0); }
}
@keyframes zt-ping-urgent {
  0% { box-shadow: 0 0 0 0 rgba(251, 113, 133, 0.5); }
  70% { box-shadow: 0 0 0 7px rgba(251, 113, 133, 0); }
  100% { box-shadow: 0 0 0 0 rgba(251, 113, 133, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .zt-pulse.is-active,
  .zt-pulse.is-urgent { animation: none; }
}
</style>
