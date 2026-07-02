<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useChatStore } from '@/features/chat'
import { useModaoDashboard, type ModaoOutlineGroup } from '@/features/modao'
import IconClose from '~icons/mdi/close'
import IconLoading from '~icons/mdi/loading'
import IconRefresh from '~icons/mdi/refresh'
import IconRobot from '~icons/mdi/robot-outline'
import IconOpen from '~icons/mdi/open-in-new'
import IconFileTree from '~icons/mdi/file-tree-outline'
import IconText from '~icons/mdi/text-box-outline'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconSearch from '~icons/mdi/magnify'
import IconChevronRight from '~icons/mdi/chevron-right'
import IconChevronDown from '~icons/mdi/chevron-down'
import IconInfo from '~icons/mdi/information-outline'
import IconImage from '~icons/mdi/image-outline'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const dash = useModaoDashboard()
const chat = useChatStore()

const query = ref('')
const collapsedGroups = ref<Set<string>>(new Set())

const data = computed(() => dash.result.value)
const hasResult = computed(() => !!data.value?.ok)
const projectName = computed(() => data.value?.title || data.value?.project?.name || dash.projectLabel)
const groups = computed(() => data.value?.outline || [])
const currentScreen = computed(() => data.value?.targetScreen)
const activeScreenId = computed(() => dash.selectedScreenId.value || currentScreen.value?.id || '')
const rendered = computed(() => data.value?.rendered)
const screenshot = computed(() => rendered.value?.screenshotDataUrl || '')
const renderUrl = computed(() => rendered.value?.finalUrl || data.value?.finalUrl || data.value?.url || dash.projectUrl)
const visibleText = computed(() =>
  rendered.value?.currentCanvasText ||
  rendered.value?.visibleText ||
  '',
)
const buttonTexts = computed(() => rendered.value?.buttonTexts?.filter(Boolean) || [])
const currentPath = computed(() => currentScreen.value?.path?.join(' / ') || '')
const canvasMeta = computed(() => currentScreen.value?.canvas)
const aiReady = computed(() => !!chat.configured)

const totalScreens = computed(() =>
  groups.value.reduce((sum, group) => sum + (group.childCount ?? group.children.length), 0),
)
const totalVisibleScreens = computed(() =>
  filteredGroups.value.reduce((sum, group) => sum + group.children.length, 0),
)

const filteredGroups = computed<ModaoOutlineGroup[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return groups.value
  return groups.value
    .map((group) => {
      const groupMatched = group.name.toLowerCase().includes(q)
      const children = groupMatched
        ? group.children
        : group.children.filter((screen) =>
            [screen.name, ...(screen.path || [])].join(' ').toLowerCase().includes(q),
          )
      return { ...group, children }
    })
    .filter((group) => group.children.length > 0)
})

watch(
  () => props.open,
  async (isOpen) => {
    dash.open.value = isOpen
    if (isOpen) await dash.boot()
  },
)

function close(): void {
  emit('update:open', false)
}

function groupCollapsed(id: string): boolean {
  return collapsedGroups.value.has(id)
}

function toggleGroup(id: string): void {
  const next = new Set(collapsedGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedGroups.value = next
}

async function refresh(): Promise<void> {
  dash.clear()
  await dash.read()
}

async function selectScreen(id: string): Promise<void> {
  await dash.readScreen(id)
}

function openOriginal(): void {
  const target = data.value?.finalUrl || data.value?.url || dash.projectUrl
  if (target) window.open(target, '_blank', 'noopener,noreferrer')
}

function askXiaoWu(kind: 'summary' | 'acceptance'): void {
  if (!hasResult.value || !aiReady.value) return
  const lines = [
    kind === 'summary'
      ? '帮我基于这个墨刀原型整理页面理解、关键交互和开发注意点。'
      : '帮我基于这个墨刀原型写一版前端开发 checklist 和验收点。',
    `原型：${data.value?.url || dash.projectUrl}`,
    `项目：${projectName.value}`,
    currentScreen.value ? `当前页面：${currentScreen.value.name || currentScreen.value.id}` : '当前页面：项目概览',
    currentPath.value ? `页面路径：${currentPath.value}` : '',
    visibleText.value ? `可见文案：\n${visibleText.value.slice(0, 2200)}` : '',
    buttonTexts.value.length ? `按钮文案：${buttonTexts.value.join('、')}` : '',
  ].filter(Boolean).join('\n\n')
  chat.show()
  void chat.send(lines)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modao-overlay" @mousedown.self="close">
      <section
        class="modao-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modao-title"
        @keydown.esc="close"
      >
        <header class="modao-topbar">
          <div class="modao-title-block">
            <p class="modao-kicker">Modao Prototype</p>
            <h2 id="modao-title">{{ projectName }}</h2>
          </div>

          <div class="modao-top-actions">
            <span
              class="modao-chip"
              :class="{ 'is-ok': dash.status.value?.enabled, 'is-warn': !dash.renderReady.value }"
              :title="dash.status.value?.note"
            >
              {{ dash.renderReady.value ? '动态渲染' : '元数据' }}
            </span>
            <button class="modao-tool-btn" type="button" :disabled="dash.loading.value" title="刷新原型" @click="refresh">
              <IconLoading v-if="dash.loading.value" class="modao-spin" />
              <IconRefresh v-else />
            </button>
            <button class="modao-tool-btn" type="button" title="打开墨刀" @click="openOriginal">
              <IconOpen />
            </button>
            <button class="modao-tool-btn" type="button" title="关闭" @click="close">
              <IconClose />
            </button>
          </div>
        </header>

        <div v-if="dash.error.value" class="modao-error">
          <IconAlert />
          <span>{{ dash.error.value }}</span>
        </div>

        <main class="modao-main">
          <aside class="modao-nav">
            <div class="modao-nav-summary">
              <div>
                <span>页面</span>
                <strong>{{ totalScreens }}</strong>
              </div>
              <div>
                <span>分组</span>
                <strong>{{ data?.folderCount || groups.length }}</strong>
              </div>
            </div>

            <label class="modao-search">
              <IconSearch />
              <input v-model="query" type="search" placeholder="搜索页面或分组" autocomplete="off">
            </label>

            <div v-if="dash.loading.value && !hasResult" class="modao-nav-loading">
              <IconLoading class="modao-spin" />
              <span>读取迭代原型…</span>
            </div>

            <div v-else-if="!hasResult" class="modao-nav-empty">
              <IconFileTree />
              <span>暂无页面数据</span>
            </div>

            <div v-else class="modao-groups">
              <div class="modao-filter-count">
                {{ query ? `匹配 ${totalVisibleScreens} / ${totalScreens}` : `共 ${totalScreens} 个页面` }}
              </div>
              <section v-for="group in filteredGroups" :key="group.id" class="modao-group">
                <button class="modao-group-head" type="button" @click="toggleGroup(group.id)">
                  <IconChevronRight v-if="groupCollapsed(group.id)" />
                  <IconChevronDown v-else />
                  <span>{{ group.name }}</span>
                  <strong>{{ group.childCount ?? group.children.length }}</strong>
                </button>
                <div v-if="!groupCollapsed(group.id)" class="modao-screen-list">
                  <button
                    v-for="screen in group.children"
                    :key="screen.id"
                    type="button"
                    class="modao-screen"
                    :class="{ 'is-active': activeScreenId === screen.id }"
                    @click="selectScreen(screen.id)"
                  >
                    <IconLoading
                      v-if="dash.loadingScreenId.value === screen.id"
                      class="modao-screen-state modao-spin"
                    />
                    <span v-else class="modao-screen-dot" />
                    <span class="modao-screen-name">{{ screen.name }}</span>
                  </button>
                </div>
              </section>
            </div>
          </aside>

          <section class="modao-detail">
            <div v-if="dash.detailLoading.value && hasResult" class="modao-detail-loading">
              <IconLoading class="modao-spin" />
              <span>正在读取页面详情…</span>
            </div>

            <div v-if="dash.loading.value && !hasResult" class="modao-empty-state">
              <IconLoading class="modao-spin" />
              <p>正在读取 {{ dash.projectLabel }}…</p>
            </div>

            <template v-else-if="hasResult">
              <div class="modao-detail-head">
                <div>
                  <p class="modao-kicker">{{ currentScreen ? 'Screen' : 'Project Overview' }}</p>
                  <h3>{{ currentScreen?.name || projectName }}</h3>
                  <p class="modao-muted">
                    <template v-if="currentPath">{{ currentPath }}</template>
                    <template v-else>{{ data?.pageCount || 0 }} 个页面 · {{ data?.folderCount || 0 }} 个分组</template>
                  </p>
                </div>
                <div class="modao-ai-actions">
                  <button v-if="aiReady" class="modao-secondary" type="button" @click="askXiaoWu('summary')">
                    <IconRobot />
                    解读
                  </button>
                  <button v-if="aiReady" class="modao-secondary" type="button" @click="askXiaoWu('acceptance')">
                    <IconRobot />
                    验收点
                  </button>
                </div>
              </div>

              <div class="modao-stat-grid">
                <div>
                  <span>画布</span>
                  <strong>
                    <template v-if="canvasMeta">
                      {{ canvasMeta.width || '-' }} x {{ canvasMeta.height || '-' }}
                    </template>
                    <template v-else>-</template>
                  </strong>
                </div>
                <div>
                  <span>Canvas</span>
                  <strong>{{ rendered?.canvasCount || 0 }}</strong>
                </div>
                <div>
                  <span>图片</span>
                  <strong>{{ rendered?.imageCount || 0 }}</strong>
                </div>
                <div>
                  <span>按钮</span>
                  <strong>{{ buttonTexts.length }}</strong>
                </div>
              </div>

              <div class="modao-content-grid">
                <section class="modao-card modao-preview-card">
                  <h4><IconImage /> 页面预览</h4>
                  <div v-if="screenshot" class="modao-preview-frame">
                    <img :src="screenshot" :alt="`${currentScreen?.name || projectName} 截图预览`">
                  </div>
                  <div v-else class="modao-card-empty">
                    <IconInfo />
                    <span>当前页面没有生成截图预览。</span>
                  </div>
                </section>

                <section class="modao-card modao-text-card">
                  <h4><IconText /> 可见文案</h4>
                  <p v-if="visibleText" class="modao-readable-text">{{ visibleText }}</p>
                  <div v-else class="modao-card-empty">
                    <IconInfo />
                    <span>没有读取到当前页面可见文案。</span>
                  </div>
                </section>

                <section class="modao-card">
                  <h4><IconFileTree /> 页面资料</h4>
                  <dl class="modao-meta-list">
                    <div>
                      <dt>页面 ID</dt>
                      <dd>{{ currentScreen?.id || '-' }}</dd>
                    </div>
                    <div>
                      <dt>设备</dt>
                      <dd>{{ canvasMeta?.device || data?.project?.device || '-' }}</dd>
                    </div>
                    <div>
                      <dt>项目 owner</dt>
                      <dd>{{ data?.project?.owner || '-' }}</dd>
                    </div>
                    <div>
                      <dt>渲染 URL</dt>
                      <dd>
                        <a
                          v-if="renderUrl"
                          :href="renderUrl"
                          target="_blank"
                          rel="noopener noreferrer"
                        >{{ renderUrl }}</a>
                        <span v-else>-</span>
                      </dd>
                    </div>
                  </dl>

                  <div v-if="buttonTexts.length" class="modao-button-tags">
                    <span v-for="text in buttonTexts" :key="text">{{ text }}</span>
                  </div>

                  <p v-if="rendered?.error" class="modao-render-warning">{{ rendered.error }}</p>
                </section>
              </div>
            </template>

            <div v-else class="modao-empty-state">
              <IconAlert />
              <p>未能读取墨刀内容，请检查 VITE_MODAO_PROJECT_URL。</p>
            </div>
          </section>
        </main>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.modao-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(2, 6, 23, 0.62);
  backdrop-filter: blur(14px);
}
.modao-shell {
  width: min(1560px, 98vw);
  height: min(920px, 94vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(125, 211, 252, 0.16);
  border-radius: 16px;
  background: rgba(5, 13, 28, 0.95);
  color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.52);
}
.modao-topbar,
.modao-top-actions,
.modao-main,
.modao-detail-head,
.modao-ai-actions,
.modao-tool-btn,
.modao-secondary,
.modao-group-head,
.modao-screen,
.modao-search,
.modao-error {
  display: flex;
  align-items: center;
}
.modao-topbar {
  justify-content: space-between;
  gap: 16px;
  min-height: 68px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.modao-title-block {
  min-width: 0;
}
.modao-kicker {
  margin: 0 0 5px;
  color: rgba(125, 211, 252, 0.78);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}
.modao-title-block h2,
.modao-detail-head h3 {
  margin: 0;
  overflow: hidden;
  color: #fff;
  font-size: 18px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modao-top-actions,
.modao-ai-actions {
  gap: 8px;
  flex: 0 0 auto;
}
.modao-chip {
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.12);
  color: #fcd34d;
  font-size: 12px;
  white-space: nowrap;
}
.modao-chip.is-ok {
  background: rgba(52, 211, 153, 0.12);
  color: #34d399;
}
.modao-tool-btn,
.modao-secondary {
  justify-content: center;
  border: 0;
  font: inherit;
  cursor: pointer;
}
.modao-tool-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.78);
}
.modao-tool-btn:hover,
.modao-secondary:hover {
  background: rgba(125, 211, 252, 0.14);
  color: #fff;
}
.modao-tool-btn:disabled {
  cursor: wait;
  opacity: 0.7;
}
.modao-secondary {
  gap: 6px;
  height: 34px;
  padding: 0 11px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.07);
  color: #e0f2fe;
}
.modao-error {
  gap: 8px;
  margin: 12px 18px 0;
  padding: 10px 12px;
  border: 1px solid rgba(251, 113, 133, 0.24);
  border-radius: 10px;
  background: rgba(244, 63, 94, 0.1);
  color: #fecdd3;
  font-size: 13px;
}
.modao-main {
  min-height: 0;
  flex: 1;
  align-items: stretch;
}
.modao-nav {
  width: 330px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.025);
}
.modao-nav-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 12px;
}
.modao-nav-summary div {
  display: grid;
  gap: 3px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.055);
}
.modao-nav-summary span,
.modao-stat-grid span,
.modao-meta-list dt {
  color: rgba(255, 255, 255, 0.48);
  font-size: 11px;
}
.modao-nav-summary strong,
.modao-stat-grid strong {
  color: #e0f2fe;
  font-size: 17px;
  line-height: 1.2;
}
.modao-search {
  gap: 8px;
  margin: 0 12px 10px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid rgba(125, 211, 252, 0.14);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.055);
  color: rgba(255, 255, 255, 0.58);
}
.modao-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 13px;
  outline: none;
}
.modao-search input::placeholder {
  color: rgba(255, 255, 255, 0.38);
}
.modao-groups {
  min-height: 0;
  overflow: auto;
  padding: 0 10px 14px;
}
.modao-filter-count {
  padding: 4px 4px 8px;
  color: rgba(255, 255, 255, 0.46);
  font-size: 12px;
}
.modao-group {
  margin-bottom: 10px;
}
.modao-group-head {
  width: 100%;
  gap: 7px;
  padding: 7px 6px;
  border: 0;
  background: transparent;
  color: rgba(186, 230, 253, 0.9);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}
.modao-group-head span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modao-group-head strong {
  min-width: 24px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.64);
  font-size: 11px;
}
.modao-screen-list {
  display: grid;
  gap: 2px;
}
.modao-screen {
  width: 100%;
  min-height: 34px;
  gap: 8px;
  padding: 7px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.68);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: left;
}
.modao-screen:hover {
  background: rgba(125, 211, 252, 0.09);
  color: #fff;
}
.modao-screen.is-active {
  background: rgba(14, 165, 233, 0.18);
  color: #e0f2fe;
  box-shadow: inset 2px 0 0 #38bdf8;
}
.modao-screen-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
}
.modao-screen-state {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: #7dd3fc;
}
.modao-screen-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modao-nav-loading,
.modao-nav-empty,
.modao-empty-state,
.modao-card-empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.56);
  font-size: 13px;
  text-align: center;
}
.modao-nav-loading,
.modao-nav-empty {
  flex: 1;
}
.modao-detail {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  flex: 1;
  padding: 18px;
}
.modao-detail-loading {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  background: rgba(5, 13, 28, 0.68);
  color: #e0f2fe;
  font-size: 13px;
  backdrop-filter: blur(4px);
}
.modao-detail-head {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.modao-muted {
  margin: 6px 0 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
}
.modao-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.modao-stat-grid div {
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(125, 211, 252, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.045);
}
.modao-content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
  gap: 14px;
}
.modao-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid rgba(125, 211, 252, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.045);
}
.modao-card h4 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 12px;
  color: rgba(255, 255, 255, 0.88);
  font-size: 13px;
}
.modao-preview-card {
  grid-column: 1 / -1;
}
.modao-preview-frame {
  overflow: auto;
  max-height: clamp(300px, 46vh, 520px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.25);
}
.modao-preview-frame img {
  display: block;
  width: 100%;
  height: auto;
  min-height: 240px;
  object-fit: contain;
}
.modao-text-card {
  min-height: 320px;
}
.modao-readable-text {
  max-height: clamp(220px, 32vh, 380px);
  overflow: auto;
  margin: 0;
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
}
.modao-meta-list {
  display: grid;
  gap: 10px;
  margin: 0;
}
.modao-meta-list div {
  min-width: 0;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.modao-meta-list div:last-child {
  border-bottom: 0;
}
.modao-meta-list dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
  line-height: 1.45;
}
.modao-meta-list a {
  color: #7dd3fc;
  text-decoration: none;
}
.modao-meta-list a:hover {
  color: #bae6fd;
  text-decoration: underline;
}
.modao-button-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}
.modao-button-tags span {
  max-width: 100%;
  padding: 5px 7px;
  border-radius: 7px;
  background: rgba(14, 165, 233, 0.12);
  color: #bae6fd;
  font-size: 12px;
}
.modao-render-warning {
  margin: 14px 0 0;
  color: #fcd34d;
  font-size: 12px;
  line-height: 1.5;
}
.modao-spin {
  animation: modao-spin 0.9s linear infinite;
}
@keyframes modao-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 860px) {
  .modao-overlay {
    padding: 10px;
  }
  .modao-shell {
    height: 94vh;
  }
  .modao-main {
    flex-direction: column;
  }
  .modao-nav {
    width: 100%;
    min-width: 0;
    max-height: 280px;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .modao-detail-head,
  .modao-topbar {
    align-items: stretch;
    flex-direction: column;
  }
  .modao-stat-grid,
  .modao-content-grid {
    grid-template-columns: 1fr;
  }
}
@media (min-width: 1380px) {
  .modao-nav {
    width: 360px;
  }
  .modao-content-grid {
    grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.55fr);
  }
  .modao-preview-card {
    grid-column: 1 / 2;
    grid-row: span 2;
  }
  .modao-preview-frame {
    max-height: calc(94vh - 220px);
  }
  .modao-text-card {
    min-height: 260px;
  }
  .modao-readable-text {
    max-height: 300px;
  }
}
</style>
