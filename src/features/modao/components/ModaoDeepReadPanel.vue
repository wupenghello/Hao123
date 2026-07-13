<script setup lang="ts">
/**
 * 原型深读面板 -- 在任务详情弹窗内 inline 渲染「墨刀原型内容 + 任务描述」的清晰合并视图。
 *
 * 给定一个公开 modao.cc/proto 链接，调 fetchModaoPrototype 拉取原型 metadata + 渲染文案，
 * 结构化展示项目/页面/可见文案/按钮/页面树，并对照任务描述；LLM 已配置时可选「让小吴解读」
 * 把原型内容 + 任务描述一起交给小吴合成一版清晰开发说明。
 * 自包含 mdr-* 样式，匹配任务详情弹窗的 navy/teal HUD 主题。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { useChatStore } from '@/features/chat'
import { fetchModaoPrototype } from '../api'
import type { ModaoOutlineGroup, ModaoPrototypeReadResponse } from '../types'
import IconLoading from '~icons/mdi/loading'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconRefresh from '~icons/mdi/refresh'
import IconOpen from '~icons/mdi/open-in-new'
import IconRobot from '~icons/mdi/robot-outline'
import IconTextBox from '~icons/mdi/text-box-outline'
import IconFileTree from '~icons/mdi/file-tree-outline'
import IconImage from '~icons/mdi/image-outline'
import IconVectorSquare from '~icons/mdi/vector-square'

const props = defineProps<{
  url: string
  taskTitle?: string
  /** 已 sanitize 的任务描述 HTML（用于对照展示 + 剥离为纯文本喂给 LLM） */
  taskDescHtml?: string
}>()

const chat = useChatStore()

const result = ref<ModaoPrototypeReadResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let abortCtrl: AbortController | null = null
let reqId = 0

const hasResult = computed(() => !!result.value?.ok)
const rendered = computed(() => result.value?.rendered)
const screen = computed(() => result.value?.targetScreen)
const projectName = computed(() => result.value?.title || result.value?.project?.name || '墨刀原型')
const screenPath = computed(() => screen.value?.path?.join(' / ') || '')
const visibleText = computed(() => rendered.value?.currentCanvasText || rendered.value?.visibleText || '')
const buttonTexts = computed(() => rendered.value?.buttonTexts?.filter(Boolean) || [])
const screenshot = computed(() => rendered.value?.screenshotDataUrl || '')
const outline = computed<ModaoOutlineGroup[]>(() => result.value?.outline || [])
const renderUrl = computed(() => rendered.value?.finalUrl || result.value?.finalUrl || result.value?.url || props.url)
const targetScreenId = computed(() => screen.value?.id || '')
const aiReady = computed(() => !!chat.configured)
const renderLimited = computed(() => !!rendered.value?.error)
const totalScreens = computed(() =>
  result.value?.pageCount || outline.value.reduce((sum, g) => sum + (g.childCount ?? g.children.length), 0),
)
const taskDescText = computed(() => htmlToText(props.taskDescHtml))

function htmlToText(html?: string): string {
  if (!html) return ''
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return (doc.body.textContent || '').trim()
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
}

async function load() {
  if (!props.url) return
  abortCtrl?.abort()
  abortCtrl = new AbortController()
  const myId = ++reqId
  loading.value = true
  error.value = null
  try {
    const data = await fetchModaoPrototype(props.url, abortCtrl.signal)
    if (myId !== reqId) return
    result.value = data
    if (!data.ok) error.value = data.error || '墨刀读取失败'
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return
    if (myId !== reqId) return
    error.value = (e as Error)?.message || '墨刀读取失败'
  } finally {
    if (myId === reqId) loading.value = false
  }
}

function retry(): void {
  void load()
}

function askXiaoWu(): void {
  if (!hasResult.value) return
  const lines = [
    '帮我基于墨刀原型 + 任务描述，整理一版清晰的开发说明：页面理解、关键交互、开发注意点、验收点。',
    props.taskTitle ? `任务：${props.taskTitle}` : '',
    taskDescText.value ? `任务描述：\n${taskDescText.value.slice(0, 2000)}` : '',
    `原型：${result.value?.url || props.url}`,
    `项目：${projectName.value}`,
    screen.value ? `当前页面：${screen.value.name || screen.value.id}` : '',
    screenPath.value ? `页面路径：${screenPath.value}` : '',
    visibleText.value ? `原型可见文案：\n${visibleText.value.slice(0, 2200)}` : '',
    buttonTexts.value.length ? `按钮文案：${buttonTexts.value.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  chat.show()
  void chat.send(lines)
}

watch(() => props.url, load, { immediate: true })
onUnmounted(() => abortCtrl?.abort())
</script>

<template>
  <div class="mdr-panel">
    <!-- 加载中 -->
    <div v-if="loading && !hasResult" class="mdr-state">
      <IconLoading class="mdr-spin" />
      <span>正在深读墨刀原型…</span>
    </div>

    <!-- 错误 -->
    <div v-else-if="error && !hasResult" class="mdr-state mdr-state-error">
      <IconAlert />
      <span>{{ error }}</span>
      <button class="mdr-retry" type="button" @click="retry">
        <IconRefresh /> 重试
      </button>
    </div>

    <!-- 结果 -->
    <template v-else-if="hasResult">
      <div class="mdr-head">
        <div class="mdr-head-main">
          <p class="mdr-kicker"><IconVectorSquare /> 原型深读</p>
          <h4>{{ projectName }}</h4>
          <p class="mdr-sub">
            <template v-if="screen">{{ screen.name || screen.id }}</template>
            <template v-else>{{ totalScreens }} 个页面 · {{ result?.folderCount || outline.length }} 个分组</template>
            <template v-if="screenPath"> · {{ screenPath }}</template>
          </p>
        </div>
        <div class="mdr-head-actions">
          <span class="mdr-chip" :class="{ 'is-warn': renderLimited }" :title="rendered?.error || ''">
            {{ renderLimited ? '仅元数据' : '动态渲染' }}
          </span>
          <a :href="renderUrl" target="_blank" rel="noopener noreferrer" class="mdr-open" title="在墨刀中打开">
            <IconOpen /> 打开墨刀
          </a>
          <button v-if="aiReady" class="mdr-ai" type="button" @click="askXiaoWu">
            <IconRobot /> 让小吴解读
          </button>
        </div>
      </div>

      <div v-if="rendered?.error" class="mdr-warn">{{ rendered.error }}</div>

      <div class="mdr-stats">
        <div><span>画布</span><strong>{{ rendered?.canvasCount || 0 }}</strong></div>
        <div><span>图片</span><strong>{{ rendered?.imageCount || 0 }}</strong></div>
        <div><span>按钮</span><strong>{{ buttonTexts.length }}</strong></div>
        <div><span>页面</span><strong>{{ totalScreens }}</strong></div>
      </div>

      <div class="mdr-grid">
        <section class="mdr-card mdr-text-card">
          <h5><IconTextBox /> 原型可见文案</h5>
          <p v-if="visibleText" class="mdr-text">{{ visibleText }}</p>
          <p v-else class="mdr-muted">没有读取到当前页面可见文案。</p>
        </section>

        <section class="mdr-card mdr-tree-card">
          <h5><IconFileTree /> 页面结构</h5>
          <div v-if="outline.length" class="mdr-outline">
            <div v-for="g in outline" :key="g.id" class="mdr-group">
              <div class="mdr-group-name">
                {{ g.name }}
                <span>{{ g.childCount ?? g.children.length }}</span>
              </div>
              <div class="mdr-screens">
                <div
                  v-for="s in g.children"
                  :key="s.id"
                  class="mdr-screen"
                  :class="{ 'is-target': s.id === targetScreenId }"
                  :title="s.path?.join(' / ')"
                >{{ s.name || s.id }}</div>
              </div>
            </div>
          </div>
          <p v-else class="mdr-muted">没有读取到页面结构。</p>
        </section>

        <section v-if="buttonTexts.length" class="mdr-card mdr-card-full">
          <h5><IconVectorSquare /> 按钮文案</h5>
          <div class="mdr-tags">
            <span v-for="t in buttonTexts" :key="t">{{ t }}</span>
          </div>
        </section>

        <section v-if="screenshot" class="mdr-card mdr-card-full mdr-shot-card">
          <h5><IconImage /> 页面截图</h5>
          <img :src="screenshot" :alt="`${projectName} 截图`" title="点击查看大图" class="mdr-shot">
        </section>

        <section v-if="taskDescHtml" class="mdr-card mdr-card-full mdr-task-card">
          <h5><IconTextBox /> 任务描述（对照）</h5>
          <div class="mdr-richtext" v-html="taskDescHtml" />
        </section>
      </div>
    </template>

    <!-- 无结果占位 -->
    <div v-else class="mdr-state">
      <IconAlert />
      <span>未能读取墨刀内容。</span>
    </div>
  </div>
</template>

<style scoped>
.mdr-panel {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mdr-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 22px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  border: 1px dashed rgba(255, 255, 255, 0.14);
  border-radius: 12px;
}
.mdr-state-error {
  flex-wrap: wrap;
  border-color: rgba(251, 113, 133, 0.3);
  color: #fecdd3;
}
.mdr-state svg {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.mdr-spin {
  animation: mdr-spin 0.9s linear infinite;
}
@keyframes mdr-spin {
  to {
    transform: rotate(360deg);
  }
}
.mdr-retry {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #e0f2fe;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.mdr-retry:hover {
  background: rgba(125, 211, 252, 0.16);
}
.mdr-retry svg {
  width: 13px;
  height: 13px;
}

.mdr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.mdr-head-main {
  min-width: 0;
}
.mdr-kicker {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 4px;
  color: rgba(125, 211, 252, 0.8);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.mdr-kicker svg {
  width: 13px;
  height: 13px;
}
.mdr-head h4 {
  margin: 0;
  color: #fff;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.35;
  word-break: break-word;
}
.mdr-sub {
  margin: 5px 0 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
}
.mdr-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mdr-chip {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(52, 211, 153, 0.14);
  color: #34d399;
  font-size: 11px;
  white-space: nowrap;
}
.mdr-chip.is-warn {
  background: rgba(245, 158, 11, 0.14);
  color: #fcd34d;
}
.mdr-open {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.07);
  color: #bae6fd;
  font-size: 12px;
  text-decoration: none;
}
.mdr-open:hover {
  background: rgba(125, 211, 252, 0.16);
  color: #fff;
}
.mdr-open svg {
  width: 13px;
  height: 13px;
}
.mdr-ai {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 0;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(45, 212, 191, 0.22), rgba(56, 189, 248, 0.22));
  color: #e0f2fe;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.mdr-ai:hover {
  filter: brightness(1.15);
}
.mdr-ai svg {
  width: 14px;
  height: 14px;
}

.mdr-warn {
  padding: 8px 11px;
  border-radius: 9px;
  background: rgba(245, 158, 11, 0.1);
  color: #fcd34d;
  font-size: 12px;
  line-height: 1.5;
}

.mdr-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.mdr-stats div {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(125, 211, 252, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.045);
}
.mdr-stats span {
  color: rgba(255, 255, 255, 0.48);
  font-size: 11px;
}
.mdr-stats strong {
  color: #e0f2fe;
  font-size: 16px;
}

.mdr-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}
.mdr-card {
  padding: 12px;
  border: 1px solid rgba(125, 211, 252, 0.12);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.04);
}
.mdr-card h5 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 9px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-weight: 650;
}
.mdr-card h5 svg {
  width: 14px;
  height: 14px;
  color: rgba(125, 211, 252, 0.85);
}
.mdr-muted {
  margin: 0;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
}

.mdr-text {
  max-height: 280px;
  overflow: auto;
  margin: 0;
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
}

.mdr-outline {
  max-height: 260px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mdr-group-name {
  color: rgba(186, 230, 253, 0.85);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 4px;
}
.mdr-group-name span {
  display: inline-block;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
  font-weight: 500;
  margin-left: 4px;
}
.mdr-screens {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.mdr-screen {
  padding: 4px 8px;
  border-radius: 7px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mdr-screen.is-target {
  background: rgba(14, 165, 233, 0.2);
  color: #e0f2fe;
  box-shadow: inset 2px 0 0 #38bdf8;
}

.mdr-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mdr-tags span {
  max-width: 100%;
  padding: 4px 7px;
  border-radius: 7px;
  background: rgba(14, 165, 233, 0.13);
  color: #bae6fd;
  font-size: 12px;
}

.mdr-shot {
  display: block;
  width: 100%;
  height: auto;
  max-height: 420px;
  object-fit: contain;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.25);
  cursor: zoom-in;
}

.mdr-richtext {
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
  line-height: 1.7;
  max-height: 320px;
  overflow: auto;
}
.mdr-richtext :deep(p) {
  margin: 0 0 8px;
}
.mdr-richtext :deep(p:last-child) {
  margin-bottom: 0;
}
.mdr-richtext :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  cursor: zoom-in;
}
.mdr-richtext :deep(a) {
  color: #7dd3fc;
}
.mdr-richtext :deep(ul),
.mdr-richtext :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}
.mdr-richtext :deep(li) {
  margin: 2px 0;
}
.mdr-richtext :deep(strong),
.mdr-richtext :deep(b) {
  color: #fff;
}

@media (min-width: 720px) {
  .mdr-grid {
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.7fr);
  }
  .mdr-card-full {
    grid-column: 1 / -1;
  }
}
@media (max-width: 560px) {
  .mdr-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  .mdr-spin {
    animation: none;
  }
}
</style>
