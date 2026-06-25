<script setup lang="ts">
/**
 * Bug 详情弹窗 —— 复用项目级公共 <DetailModal> 壳层，只填充 Bug 专属内容：
 * 概览徽标 / 基本信息 / 时间线 / 重现步骤（富文本含图片）。
 *
 * 字段经 cleanText 过滤伪值，重现步骤经 sanitizeHtml 安全渲染，
 * 图片预览由 DetailModal 内置处理。
 */
import { computed } from 'vue'
import DetailModal from '@/components/common/DetailModal.vue'
import { useBugStore } from '../store'
import { bugStatusBadge, severityBadge, bugTypeLabel, resolutionLabel } from '../ui'
import { priorityBadge, sanitizeHtml, hasRichContent, cleanText } from '../../shared/ui'
import IconBug from '~icons/mdi/bug-outline'
import IconOpenInNew from '~icons/mdi/open-in-new'

const store = useBugStore()
const bug = computed(() => store.detail)
const hasData = computed(() => !!bug.value)

/** Bug 重现步骤（富文本，含图片） */
const stepsHtml = computed(() => {
  if (!hasRichContent(bug.value?.steps)) return ''
  return sanitizeHtml(bug.value?.steps)
})

/** 在禅道中打开完整页面 */
const externalUrl = computed(() => {
  const base = (import.meta.env.VITE_ZENTAO_BASE || '').replace(/\/$/, '')
  if (!base || !bug.value) return ''
  return `${base}/bug-view-${bug.value.id}.html`
})

/** Bug 信息字段（已过滤伪值，空字段不进列表） */
const bugMeta = computed(() => {
  const b = bug.value
  if (!b) return []
  const rows: Array<{ k: string; v: string }> = []
  const product = cleanText(b.productName) || cleanText(b.projectName) || cleanText(b.product)
  if (product) rows.push({ k: '所属产品', v: product })
  if (bugTypeLabel(b.type)) rows.push({ k: 'Bug 类型', v: bugTypeLabel(b.type) })
  if (resolutionLabel(b.resolution)) rows.push({ k: '解决方案', v: resolutionLabel(b.resolution) })
  if (cleanText(b.openedBuild)) rows.push({ k: '发现版本', v: cleanText(b.openedBuild).replace(/,$/, '') })
  if (cleanText(b.resolvedBuild)) rows.push({ k: '解决版本', v: cleanText(b.resolvedBuild) })
  if (String(b.confirmed) === '1') rows.push({ k: '确认状态', v: '已确认' })
  if (cleanText(b.os)) rows.push({ k: '操作系统', v: cleanText(b.os) })
  if (cleanText(b.browser)) rows.push({ k: '浏览器', v: cleanText(b.browser) })
  const assignee = cleanText(b.assignedTo)
  if (assignee) rows.push({ k: '当前指派', v: assignee })
  return rows
})

/** Bug 时间线（创建 → 解决 → 关闭 → 最后修改） */
const bugTimeline = computed(() => {
  const b = bug.value
  if (!b) return []
  const rows: Array<{ k: string; who: string; when: string }> = []
  if (cleanText(b.openedDate)) rows.push({ k: '创建', who: cleanText(b.openedBy), when: cleanText(b.openedDate) })
  if (cleanText(b.resolvedDate)) rows.push({ k: '解决', who: cleanText(b.resolvedBy), when: cleanText(b.resolvedDate) })
  if (cleanText(b.closedDate)) rows.push({ k: '关闭', who: cleanText(b.closedBy), when: cleanText(b.closedDate) })
  if (cleanText(b.lastEditedDate)) rows.push({ k: '修改', who: cleanText(b.lastEditedBy), when: cleanText(b.lastEditedDate) })
  return rows
})
</script>

<template>
  <DetailModal
    :open="store.detailOpen"
    :loading="store.detailLoading"
    :error="store.detailError"
    :has-data="hasData"
    accent="zt-accent-bug"
    @close="store.closeDetail()"
  >
    <!-- 头部图标 -->
    <template #icon>
      <div class="zt-icon zt-icon-bug">
        <IconBug class="w-5 h-5" />
      </div>
    </template>

    <!-- 头部标题 -->
    <template #title>
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-semibold tracking-wider tabular-nums px-1.5 py-0.5 rounded text-rose-200 bg-rose-400/15">
          BUG #{{ bug?.id }}
        </span>
      </div>
      <h2 class="text-white text-[15px] font-medium leading-snug mt-1.5 break-words">{{ bug?.title }}</h2>
    </template>

    <!-- 主体 -->
    <template #body>
      <!-- 概览徽标 -->
      <div v-if="bug" class="flex flex-wrap items-center gap-1.5">
        <span class="zt-badge ring-1 ring-inset" :class="bugStatusBadge(bug.status).class">{{ bugStatusBadge(bug.status).label }}</span>
        <span v-if="severityBadge(bug.severity)" class="zt-badge ring-1 ring-inset" :class="severityBadge(bug.severity)!.class">{{ severityBadge(bug.severity)!.label }}</span>
        <span v-if="priorityBadge(bug.pri)" class="zt-badge ring-1 ring-inset" :class="priorityBadge(bug.pri)!.class">{{ priorityBadge(bug.pri)!.label }}</span>
      </div>

      <!-- 基本信息 -->
      <section v-if="bugMeta.length">
        <h3 class="zt-section-title">基本信息</h3>
        <dl class="zt-meta">
          <div v-for="row in bugMeta" :key="row.k" class="zt-meta-row">
            <dt>{{ row.k }}</dt>
            <dd>{{ row.v }}</dd>
          </div>
        </dl>
      </section>

      <!-- 时间线 -->
      <section v-if="bugTimeline.length">
        <h3 class="zt-section-title">时间线</h3>
        <ul class="zt-timeline">
          <li v-for="row in bugTimeline" :key="row.k">
            <span class="zt-dot" />
            <span class="zt-tl-label">{{ row.k }}</span>
            <span class="zt-tl-when tabular-nums">{{ row.when }}</span>
            <span v-if="row.who" class="zt-tl-who">{{ row.who }}</span>
          </li>
        </ul>
      </section>

      <!-- 重现步骤（富文本含图片） -->
      <section>
        <h3 class="zt-section-title">重现步骤</h3>
        <div v-if="stepsHtml" class="zt-richtext" v-html="stepsHtml" />
        <p v-else class="zt-empty">该 Bug 暂无重现步骤</p>
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
