<script setup lang="ts">
/**
 * 任务详情弹窗 —— 复用项目级公共 <DetailModal> 壳层，只填充任务专属内容：
 * 概览徽标 / 工时 / 基本信息 / 时间线 / 子任务 / 任务描述（或回退需求规格）/ 验收标准。
 *
 * 字段经 cleanText 过滤伪值（如已关闭任务的 assignedTo='closed'），
 * 富文本（描述/规格/验收）经 sanitizeHtml 安全渲染，图片预览由 DetailModal 内置处理。
 */
import { computed, ref, watch } from 'vue'
import DetailModal from '@/components/common/DetailModal.vue'
import { useTaskStore } from '../store'
import { taskStatusBadge, taskClosedReasonLabel, taskTypeLabel } from '../ui'
import { priorityBadge, sanitizeHtml, hasRichContent, cleanText } from '../../shared/ui'
import { toArray } from '../../shared/http'
import { ModaoDeepReadPanel, extractModaoUrls, MODAO_PROJECT_URL } from '@/features/modao'
import IconCheckboxOutline from '~icons/mdi/checkbox-marked-circle-outline'
import IconOpenInNew from '~icons/mdi/open-in-new'
import IconBookOpen from '~icons/mdi/book-open-page-variant'

const store = useTaskStore()
const task = computed(() => store.detail)
const hasData = computed(() => !!task.value)

/**
 * 任务正文（富文本）：优先用任务自身描述 desc；许多任务 desc 为空，
 * 此时回退到关联需求的规格说明 storySpec。返回清洗后的安全 HTML（保留图片/段落）。
 * 判空用 hasRichContent —— 含图片也算有内容（很多需求只有一张图、无文字）。
 */
const descHtml = computed(() => {
  if (hasRichContent(task.value?.desc)) return { html: sanitizeHtml(task.value?.desc), fromStory: false }
  if (hasRichContent(task.value?.storySpec)) return { html: sanitizeHtml(task.value?.storySpec), fromStory: true }
  return null
})

/** 需求验收标准（富文本，存在则单独成块） */
const verifyHtml = computed(() => {
  if (!hasRichContent(task.value?.storyVerify)) return ''
  return sanitizeHtml(task.value?.storyVerify)
})

/**
 * 原型深读：从任务描述/需求规格/验收标准 HTML 里提取墨刀原型外链（modao.cc/proto），
 * 提取不到回退 .env 的 VITE_MODAO_PROJECT_URL。墨刀读取后端（/modao/read）仅 dev 生效，
 * 故按钮可见性门控在 dev 且有可读链接；生产或无链接不渲染入口。
 */
const modaoUrls = computed<string[]>(() => {
  const t = task.value
  if (!t) return []
  return extractModaoUrls([t.desc, t.storySpec, t.storyVerify].filter(Boolean).join('\n'))
})
const deepReadUrl = computed(() => modaoUrls.value[0] || MODAO_PROJECT_URL || '')
const canDeepRead = computed(() => import.meta.env.DEV && !!deepReadUrl.value)
const showDeepRead = ref(false)
// TaskDetailModal 常驻挂载（TaskPanel 里无条件渲染），showDeepRead 不会随任务切换自动复位；
// 切到另一个任务时收起面板，避免上一任务展开的深读为新任务意外留着
watch(
  () => task.value?.id,
  () => {
    showDeepRead.value = false
  },
)

/** 子任务列表（父任务才有；归一化对象/数组为数组，复用 toArray） */
const subTasks = computed(() => {
  return toArray(task.value?.children).filter((t) => t && t.id)
})

/** 在禅道中打开完整页面 */
const externalUrl = computed(() => {
  const base = (import.meta.env.VITE_ZENTAO_BASE || '').replace(/\/$/, '')
  if (!base || !task.value) return ''
  return `${base}/task-view-${task.value.id}.html`
})

/** 任务工时三连 */
const taskHours = computed(() => {
  const t = task.value
  if (!t) return null
  return {
    estimate: Number(t.estimate) || 0,
    consumed: Number(t.consumed) || 0,
    left: Number(t.left) || 0,
  }
})

/** 任务信息字段（已过滤伪值，空字段不进列表） */
const taskMeta = computed(() => {
  const t = task.value
  if (!t) return []
  const rows: Array<{ k: string; v: string }> = []
  const project = cleanText(t.projectName) || cleanText(t.project)
  if (project) rows.push({ k: '所属项目', v: project })
  if (taskTypeLabel(t.type)) rows.push({ k: '任务类型', v: taskTypeLabel(t.type) })
  if (cleanText(t.storyTitle)) {
    const ver = cleanText(t.storyVersion)
    rows.push({ k: '关联需求', v: cleanText(t.storyTitle) + (ver ? `（v${ver}）` : '') })
  }
  const assignee = cleanText(t.assignedToRealName) || cleanText(t.assignedTo)
  if (assignee) rows.push({ k: '当前指派', v: assignee })
  // 进度：0 是合法值，不能用 cleanText（会把 '0' 当伪值过滤），只要是有效数字就展示
  const progress = Number(t.progress)
  if (t.progress != null && t.progress !== '' && !Number.isNaN(progress)) {
    rows.push({ k: '进度', v: `${progress}%` })
  }
  // 关闭原因：closedReason 取值为 done/cancel 等，需用专门的关闭原因映射，
  // 不能用 cleanText（会把 done/cancel 当伪值过滤）或 taskStatusBadge（语义不同）
  const closedReason = taskClosedReasonLabel(t.closedReason)
  if (closedReason) rows.push({ k: '关闭原因', v: closedReason })
  return rows
})

/** 任务时间线（创建 → 开始 → 完成 → 关闭 → 最后修改） */
const taskTimeline = computed(() => {
  const t = task.value
  if (!t) return []
  const rows: Array<{ k: string; who: string; when: string }> = []
  if (cleanText(t.openedDate)) rows.push({ k: '创建', who: cleanText(t.openedBy), when: cleanText(t.openedDate) })
  if (cleanText(t.realStarted)) rows.push({ k: '开始', who: '', when: cleanText(t.realStarted) })
  if (cleanText(t.finishedDate)) rows.push({ k: '完成', who: cleanText(t.finishedBy), when: cleanText(t.finishedDate) })
  if (cleanText(t.closedDate)) rows.push({ k: '关闭', who: cleanText(t.closedBy), when: cleanText(t.closedDate) })
  if (cleanText(t.lastEditedDate)) rows.push({ k: '修改', who: cleanText(t.lastEditedBy), when: cleanText(t.lastEditedDate) })
  return rows
})
</script>

<template>
  <DetailModal
    :open="store.detailOpen"
    :loading="store.detailLoading"
    :error="store.detailError"
    :has-data="hasData"
    accent="zt-accent-task"
    @close="store.closeDetail()"
  >
    <!-- 头部图标 -->
    <template #icon>
      <div class="zt-icon zt-icon-task">
        <IconCheckboxOutline class="w-5 h-5" />
      </div>
    </template>

    <!-- 头部标题 -->
    <template #title>
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-semibold tracking-wider tabular-nums px-1.5 py-0.5 rounded text-sky-200 bg-sky-400/15">
          TASK #{{ task?.id }}
        </span>
      </div>
      <h2 class="text-white text-[15px] font-medium leading-snug mt-1.5 break-words">{{ task?.name }}</h2>
    </template>

    <!-- 主体 -->
    <template #body>
      <!-- 概览徽标 -->
      <div v-if="task" class="flex flex-wrap items-center gap-1.5">
        <span class="zt-badge ring-1 ring-inset" :class="taskStatusBadge(task.status).class">{{ taskStatusBadge(task.status).label }}</span>
        <span v-if="priorityBadge(task.pri)" class="zt-badge ring-1 ring-inset" :class="priorityBadge(task.pri)!.class">{{ priorityBadge(task.pri)!.label }}</span>
        <span v-if="taskTypeLabel(task.type)" class="zt-badge zt-badge-plain">{{ taskTypeLabel(task.type) }}</span>
      </div>

      <!-- 工时 -->
      <div v-if="taskHours" class="grid grid-cols-3 gap-2.5">
        <div class="zt-stat">
          <div class="zt-stat-num">{{ taskHours.estimate }}</div>
          <div class="zt-stat-label">预计 (h)</div>
        </div>
        <div class="zt-stat">
          <div class="zt-stat-num text-teal-200">{{ taskHours.consumed }}</div>
          <div class="zt-stat-label">已消耗 (h)</div>
        </div>
        <div class="zt-stat">
          <div class="zt-stat-num">{{ taskHours.left }}</div>
          <div class="zt-stat-label">剩余 (h)</div>
        </div>
      </div>

      <!-- 基本信息 -->
      <section v-if="taskMeta.length">
        <h3 class="zt-section-title">基本信息</h3>
        <dl class="zt-meta">
          <div v-for="row in taskMeta" :key="row.k" class="zt-meta-row">
            <dt>{{ row.k }}</dt>
            <dd>{{ row.v }}</dd>
          </div>
        </dl>
      </section>

      <!-- 时间线 -->
      <section v-if="taskTimeline.length">
        <h3 class="zt-section-title">时间线</h3>
        <ul class="zt-timeline">
          <li v-for="row in taskTimeline" :key="row.k">
            <span class="zt-dot" />
            <span class="zt-tl-label">{{ row.k }}</span>
            <span class="zt-tl-when tabular-nums">{{ row.when }}</span>
            <span v-if="row.who" class="zt-tl-who">{{ row.who }}</span>
          </li>
        </ul>
      </section>

      <!-- 子任务（父任务才有，可点击进入） -->
      <section v-if="subTasks.length">
        <h3 class="zt-section-title">子任务（{{ subTasks.length }}）</h3>
        <ul class="zt-subtasks">
          <li v-for="st in subTasks" :key="st.id" class="zt-subtask" @click="store.openDetail(st.id)">
            <span class="zt-sub-id tabular-nums">#{{ st.id }}</span>
            <span class="zt-sub-name">{{ st.name }}</span>
            <span class="zt-badge ring-1 ring-inset" :class="taskStatusBadge(st.status).class">
              {{ taskStatusBadge(st.status).label }}
            </span>
          </li>
        </ul>
      </section>

      <!-- 任务描述（desc 为空时回退需求规格，富文本含图片） -->
      <section>
        <h3 class="zt-section-title">
          {{ descHtml?.fromStory ? '需求规格' : '任务描述' }}
          <button
            v-if="canDeepRead"
            type="button"
            class="ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md text-teal-200/80 hover:text-teal-100 hover:bg-teal-400/10 transition-colors"
            :title="showDeepRead ? '收起原型深读' : '读取墨刀原型，结合任务描述生成清晰视图'"
            @click="showDeepRead = !showDeepRead"
          >
            <IconBookOpen class="w-3.5 h-3.5" />
            {{ showDeepRead ? '收起原型深读' : '原型深读' }}
          </button>
        </h3>
        <div v-if="descHtml" class="zt-richtext" v-html="descHtml.html" />
        <p v-else class="zt-empty">该任务暂无描述</p>
        <!-- 原型深读：拉取墨刀原型内容 + 任务描述合并展示（LLM 已配置时可交给小吴解读） -->
        <ModaoDeepReadPanel
          v-if="showDeepRead && canDeepRead"
          :url="deepReadUrl"
          :task-title="task?.name"
          :task-desc-html="descHtml?.html || ''"
        />
      </section>

      <!-- 需求验收标准（存在则展示） -->
      <section v-if="verifyHtml">
        <h3 class="zt-section-title">验收标准</h3>
        <div class="zt-richtext" v-html="verifyHtml" />
      </section>
    </template>

    <!-- 底部操作条 -->
    <template v-if="externalUrl" #footer>
      <a :href="externalUrl" target="_blank" rel="noopener noreferrer" class="zt-external-link">
        <IconOpenInNew class="w-3.5 h-3.5" />
        在禅道中打开
      </a>
    </template>
  </DetailModal>
</template>
