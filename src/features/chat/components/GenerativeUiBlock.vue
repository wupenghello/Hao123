<script setup lang="ts">
import { computed } from 'vue'
import type { ChatUiBlock } from '../types'
import IconSpark from '~icons/mdi/star-four-points'
import IconWeather from '~icons/mdi/weather-partly-cloudy'
import IconList from '~icons/mdi/format-list-checks'
import IconTable from '~icons/mdi/table'
import IconTimeline from '~icons/mdi/timeline-clock-outline'
import IconStatus from '~icons/mdi/server-network'
import IconSource from '~icons/mdi/book-open-page-variant-outline'
import IconMetric from '~icons/mdi/chart-box-outline'
import IconCheck from '~icons/mdi/check-circle-outline'
import IconOpenExternal from '~icons/mdi/open-in-new'

type Rec = Record<string, unknown>

const props = defineProps<{ block: ChatUiBlock }>()

const block = computed(() => props.block)
const data = computed<Rec>(() => props.block.props ?? {})

function isRecord(v: unknown): v is Rec {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function records(v: unknown): Rec[] {
  return Array.isArray(v) ? v.filter(isRecord) : []
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function str(v: unknown, fallback = ''): string {
  if (v == null || v === '') return fallback
  return String(v)
}

function toneClass(tone: unknown): string {
  const t = str(tone, 'info')
  if (t === 'ok') return 'tone-ok'
  if (t === 'warn') return 'tone-warn'
  if (t === 'danger') return 'tone-danger'
  if (t === 'muted') return 'tone-muted'
  return 'tone-info'
}

function stepClass(status: unknown): string {
  const s = str(status, 'todo')
  if (/done|完成|ok|success/i.test(s)) return 'step-done'
  if (/doing|进行|running|current/i.test(s)) return 'step-doing'
  if (/blocked|error|失败|阻塞/i.test(s)) return 'step-blocked'
  return 'step-todo'
}

function windLabel(wind: unknown): string {
  if (!isRecord(wind)) return ''
  const dir = str(wind.dir)
  const scale = str(wind.scale)
  const speed = str(wind.speed)
  return [dir, scale ? `${scale}级` : '', speed ? `${speed}km/h` : ''].filter(Boolean).join('，')
}

const icon = computed(() => {
  switch (block.value.kind) {
    case 'weather-current':
    case 'weather-forecast':
      return IconWeather
    case 'item-list':
      return IconList
    case 'data-table':
      return IconTable
    case 'timeline':
      return IconTimeline
    case 'status-grid':
      return IconStatus
    case 'source-list':
      return IconSource
    case 'metrics':
      return IconMetric
    default:
      return IconSpark
  }
})

const shellClass = computed(() => [`gui-kind-${block.value.kind}`, toneClass(data.value.tone)])

const metrics = computed(() => records(data.value.metrics).slice(0, 8))
const items = computed(() => records(data.value.items).slice(0, 12))
const steps = computed(() => records(data.value.steps).slice(0, 8))
const statusItems = computed(() => records(data.value.items).slice(0, 10))
const forecastRows = computed(() => records(data.value.rows).slice(0, 12))
const sources = computed(() => records(data.value.sources).slice(0, 8))
const sections = computed(() => records(data.value.sections).slice(0, 4))
const columns = computed(() =>
  records(data.value.columns)
    .slice(0, 6)
    .map((col) => ({ key: str(col.key), label: str(col.label || col.key) }))
    .filter((col) => col.key),
)
const rows = computed(() => records(data.value.rows).slice(0, 12))

function cell(row: Rec, key: string): string {
  const value = row[key]
  if (value == null) return ''
  if (Array.isArray(value)) return value.map((v) => str(v)).filter(Boolean).join(' / ')
  if (isRecord(value)) return JSON.stringify(value)
  return String(value)
}
</script>

<template>
  <article class="gui-card" :class="shellClass">
    <header class="gui-head">
      <span class="gui-icon">
        <component :is="icon" class="w-4 h-4" />
      </span>
      <span class="min-w-0">
        <strong>{{ block.title }}</strong>
        <em v-if="block.subtitle">{{ block.subtitle }}</em>
      </span>
    </header>

    <div v-if="block.kind === 'weather-current'" class="gui-weather-now">
      <div class="gui-temp">
        {{ str(data.temp, '-') }}<span>°</span>
      </div>
      <div class="min-w-0">
        <div class="gui-weather-text">{{ str(data.text, '天气') }}</div>
        <div class="gui-muted">
          {{ str(data.observedAt, '刚刚') }}
          <template v-if="windLabel(data.wind)"> / {{ windLabel(data.wind) }}</template>
        </div>
      </div>
      <div v-if="metrics.length" class="gui-metrics">
        <span v-for="m in metrics" :key="str(m.label)" class="gui-metric" :class="toneClass(m.tone)">
          <small>{{ str(m.label) }}</small>
          <b>{{ str(m.value) }}</b>
        </span>
      </div>
    </div>

    <div v-else-if="block.kind === 'weather-forecast'" class="gui-forecast">
      <div v-for="row in forecastRows" :key="str(row.label)" class="gui-forecast-row">
        <span>{{ str(row.label) }}</span>
        <strong>{{ str(row.primary) }}</strong>
        <em>{{ str(row.secondary) }}</em>
        <small v-if="row.detail">{{ str(row.detail) }}</small>
      </div>
    </div>

    <div v-else-if="block.kind === 'item-list'" class="gui-list">
      <div v-for="it in items" :key="str(it.title) + str(it.meta)" class="gui-item" :class="toneClass(it.tone)">
        <div class="min-w-0">
          <a
            v-if="it.url"
            :href="str(it.url)"
            target="_blank"
            rel="noopener noreferrer"
            class="gui-item-link"
          >
            <strong>{{ str(it.title, '未命名') }}</strong>
          </a>
          <strong v-else>{{ str(it.title, '未命名') }}</strong>
          <em v-if="it.meta">{{ str(it.meta) }}</em>
          <p v-if="it.description">{{ str(it.description) }}</p>
        </div>
        <div v-if="strings(it.badges).length" class="gui-badges">
          <span v-for="badge in strings(it.badges)" :key="badge">{{ badge }}</span>
        </div>
      </div>
      <p v-if="!items.length" class="gui-empty">{{ str(data.emptyText, '暂无数据') }}</p>
    </div>

    <div v-else-if="block.kind === 'status-grid'" class="gui-status-grid">
      <a
        v-for="it in statusItems"
        :key="str(it.label)"
        class="gui-status"
        :class="toneClass(it.tone)"
        :href="str(it.url) || undefined"
        target="_blank"
        rel="noopener noreferrer"
      >
        <strong>{{ str(it.label, '状态') }}</strong>
        <span>{{ str(it.status, '-') }}</span>
        <em v-if="it.detail">{{ str(it.detail) }}</em>
      </a>
    </div>

    <div v-else-if="block.kind === 'data-table'" class="gui-table-wrap">
      <table class="gui-table">
        <thead>
          <tr>
            <th v-for="col in columns" :key="col.key">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in rows" :key="ri">
            <td v-for="col in columns" :key="col.key">{{ cell(row, col.key) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="block.kind === 'timeline'" class="gui-timeline">
      <div v-for="step in steps" :key="str(step.title)" class="gui-step" :class="stepClass(step.status)">
        <span class="gui-step-dot">
          <IconCheck class="w-3.5 h-3.5" />
        </span>
        <div>
          <strong>{{ str(step.title, '步骤') }}</strong>
          <p v-if="step.detail">{{ str(step.detail) }}</p>
        </div>
      </div>
    </div>

    <div v-else-if="block.kind === 'source-list'" class="gui-sources">
      <a
        v-for="src in sources"
        :key="str(src.title) + str(src.subtitle)"
        class="gui-source"
        :href="str(src.url) || undefined"
        target="_blank"
        rel="noopener noreferrer"
      >
        <strong>{{ str(src.title, '来源') }}</strong>
        <em v-if="src.subtitle">{{ str(src.subtitle) }}</em>
        <p v-if="src.excerpt">{{ str(src.excerpt) }}</p>
        <small v-if="src.confidence || src.score">
          {{ str(src.confidence, 'score') }}<template v-if="src.score"> / {{ str(src.score) }}</template>
        </small>
      </a>
    </div>

    <div v-else class="gui-summary">
      <p v-if="data.body">{{ str(data.body) }}</p>
      <div v-if="metrics.length" class="gui-metrics">
        <span v-for="m in metrics" :key="str(m.label)" class="gui-metric" :class="toneClass(m.tone)">
          <small>{{ str(m.label) }}</small>
          <b>{{ str(m.value) }}</b>
        </span>
      </div>
      <section v-for="section in sections" :key="str(section.title)" class="gui-section">
        <strong>{{ str(section.title) }}</strong>
        <ul>
          <li v-for="line in strings(section.items)" :key="line">{{ line }}</li>
        </ul>
      </section>
      <a
        v-if="data.sourceUrl"
        :href="str(data.sourceUrl)"
        target="_blank"
        rel="noopener noreferrer"
        class="gui-source-link"
      >
        <IconOpenExternal class="w-3.5 h-3.5" aria-hidden="true" />
        {{ str(data.sourceLabel, '打开原文') }}
      </a>
    </div>
  </article>
</template>

<style scoped>
.gui-card {
  --gui-tone: var(--status-info, #60a5fa);
  --gui-soft: var(--status-info-soft, rgba(96, 165, 250, 0.1));
  container-type: inline-size;
  overflow: hidden;
  padding: 12px;
  color: var(--text-primary, #e8eef7);
  background: var(--surface-secondary, #111f33);
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  border-radius: 7px;
  box-shadow: var(--shadow-raised, 0 12px 32px rgba(2, 6, 23, 0.32));
}
.gui-kind-item-list,
.gui-kind-timeline,
.gui-card.tone-ok { --gui-tone: var(--status-success, #34d399); --gui-soft: var(--status-success-soft, rgba(52, 211, 153, 0.1)); }
.gui-kind-data-table,
.gui-kind-metrics { --gui-tone: var(--accent-primary, #38bdf8); --gui-soft: var(--accent-soft, rgba(56, 189, 248, 0.12)); }
.gui-kind-source-list,
.gui-card.tone-warn { --gui-tone: var(--status-warning, #f59e0b); --gui-soft: var(--status-warning-soft, rgba(245, 158, 11, 0.1)); }
.gui-card.tone-danger { --gui-tone: var(--status-danger, #fb7185); --gui-soft: var(--status-danger-soft, rgba(251, 113, 133, 0.1)); }
.gui-card.tone-muted { --gui-tone: var(--text-muted, #74839a); --gui-soft: rgba(116, 131, 154, 0.1); }
.gui-head {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12));
}
.gui-head strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary, #e8eef7);
  font-size: 12.5px;
  font-weight: 750;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gui-head em,
.gui-muted,
.gui-item em,
.gui-status em,
.gui-source em {
  display: block;
  margin-top: 2px;
  color: var(--text-muted, #74839a);
  font-size: 10.5px;
  font-style: normal;
}
.gui-icon,
.gui-step-dot {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  color: var(--gui-tone);
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  border-radius: 4px;
}
.gui-icon { width: 28px; height: 28px; }
.gui-weather-now {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px 14px;
  align-items: center;
}
.gui-temp {
  color: var(--text-primary, #e8eef7);
  font: 800 42px/0.95 var(--font-mono, ui-monospace, monospace);
}
.gui-temp span { margin-left: 1px; color: var(--text-muted, #74839a); font-size: 17px; }
.gui-weather-text { color: var(--text-primary, #e8eef7); font-size: 14px; font-weight: 700; }
.gui-metrics {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
  overflow: hidden;
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12));
  border-radius: 5px;
}
.gui-metric {
  min-width: 0;
  padding: 8px 9px;
  background: var(--surface-inset, #0b1524);
  border-right: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12));
}
.gui-metric:last-child { border-right: 0; }
.gui-metric small { display: block; color: var(--text-muted, #74839a); font-size: 10px; }
.gui-metric b {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  color: var(--text-primary, #e8eef7);
  font: 750 12.5px/1.25 var(--font-mono, ui-monospace, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gui-forecast,
.gui-list,
.gui-sources,
.gui-timeline {
  overflow: hidden;
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12));
  border-radius: 5px;
}
.gui-forecast-row,
.gui-item,
.gui-source { border-bottom: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12)); }
.gui-forecast-row:last-child,
.gui-item:last-child,
.gui-source:last-child { border-bottom: 0; }
.gui-forecast-row {
  display: grid;
  grid-template-columns: minmax(58px, 0.9fr) minmax(76px, 1fr) minmax(64px, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 36px;
  padding: 7px 9px;
}
.gui-forecast-row span,
.gui-forecast-row em,
.gui-forecast-row small {
  min-width: 0;
  overflow: hidden;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gui-forecast-row span,
.gui-forecast-row small { color: var(--text-muted, #74839a); font-size: 10.5px; }
.gui-forecast-row strong { color: var(--text-primary, #e8eef7); font-size: 12px; }
.gui-forecast-row em { color: var(--text-secondary, #a8b5c7); font-size: 11.5px; }
.gui-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 9px;
  padding: 9px 10px;
}
.gui-item:hover,
.gui-status:hover,
.gui-source:hover,
.gui-forecast-row:hover { background: var(--surface-raised, #142238); }
.gui-item strong,
.gui-item-link strong,
.gui-step strong,
.gui-source strong,
.gui-section strong {
  display: block;
  color: var(--text-primary, #e8eef7);
  font-size: 12px;
  font-weight: 700;
}
.gui-item-link { display: block; color: inherit; text-decoration: none; }
.gui-item-link:hover strong { color: var(--accent-hover, #7dd3fc); text-decoration: underline; text-underline-offset: 2px; }
.gui-item p,
.gui-step p,
.gui-source p,
.gui-summary p { margin: 4px 0 0; color: var(--text-secondary, #a8b5c7); font-size: 11px; line-height: 1.55; }
.gui-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; max-width: 150px; }
.gui-badges span {
  min-height: 20px;
  padding: 2px 6px;
  color: var(--gui-tone);
  background: var(--gui-soft);
  border: 1px solid color-mix(in srgb, var(--gui-tone) 28%, transparent);
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 15px;
}
.gui-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  overflow: hidden;
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12));
  border-radius: 5px;
}
.gui-status {
  display: block;
  min-width: 0;
  padding: 10px;
  color: inherit;
  border-right: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12));
  text-decoration: none;
}
.gui-status:last-child { border-right: 0; }
.gui-status strong,
.gui-status span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gui-status strong { color: var(--text-primary, #e8eef7); font-size: 11.5px; }
.gui-status span { margin-top: 5px; color: var(--gui-tone); font: 750 11.5px/1.25 var(--font-mono, ui-monospace, monospace); }
.gui-table-wrap {
  max-width: 100%;
  overflow-x: auto;
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12));
  border-radius: 5px;
}
.gui-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.gui-table th,
.gui-table td { padding: 8px 10px; border-bottom: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12)); text-align: left; white-space: nowrap; }
.gui-table tbody tr:last-child td { border-bottom: 0; }
.gui-table th { color: var(--text-secondary, #a8b5c7); background: var(--surface-raised, #142238); font: 700 10px/1.2 var(--font-mono, ui-monospace, monospace); }
.gui-table td { color: var(--text-secondary, #a8b5c7); }
.gui-step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 9px;
  padding: 8px 9px;
  border-bottom: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12));
}
.gui-step:last-child { border-bottom: 0; }
.gui-step-dot { width: 22px; height: 22px; color: var(--text-muted, #74839a); background: var(--surface-secondary, #111f33); }
.gui-source { display: block; padding: 9px 10px; color: inherit; text-decoration: none; }
.gui-source small { display: inline-flex; margin-top: 7px; color: var(--gui-tone); font: 700 10px/1.2 var(--font-mono, ui-monospace, monospace); }
.gui-section { margin-top: 11px; padding-top: 11px; border-top: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12)); }
.gui-section ul { margin: 6px 0 0; padding-left: 16px; }
.gui-section li { margin: 3px 0; color: var(--text-secondary, #a8b5c7); font-size: 11px; }
.gui-section li::marker { color: var(--gui-tone); }
.gui-source-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 11px;
  min-height: 30px;
  padding: 0 9px;
  color: var(--accent-hover, #7dd3fc);
  background: var(--surface-inset, #0b1524);
  border: 1px solid var(--border-default, rgba(148, 163, 184, 0.2));
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  text-decoration: none;
}
.gui-source-link:hover { color: var(--text-primary, #e8eef7); background: var(--surface-raised, #142238); border-color: var(--border-strong, rgba(148, 163, 184, 0.3)); }
.gui-empty { margin: 0; padding: 13px; color: var(--text-muted, #74839a); background: var(--surface-inset, #0b1524); border: 1px dashed var(--border-default, rgba(148, 163, 184, 0.2)); border-radius: 4px; font-size: 11.5px; }
.tone-ok > span,
.tone-ok > b { color: var(--status-success, #34d399); }
.tone-warn > span,
.tone-warn > b { color: var(--status-warning, #f59e0b); }
.tone-danger > span,
.tone-danger > b { color: var(--status-danger, #fb7185); }
.tone-muted { opacity: 0.76; }
.step-done .gui-step-dot { color: var(--status-success, #34d399); background: var(--status-success-soft, rgba(52, 211, 153, 0.1)); border-color: color-mix(in srgb, var(--status-success, #34d399) 36%, transparent); }
.step-doing .gui-step-dot { color: var(--status-info, #60a5fa); background: var(--status-info-soft, rgba(96, 165, 250, 0.1)); border-color: color-mix(in srgb, var(--status-info, #60a5fa) 36%, transparent); }
.step-blocked .gui-step-dot { color: var(--status-danger, #fb7185); background: var(--status-danger-soft, rgba(251, 113, 133, 0.1)); border-color: color-mix(in srgb, var(--status-danger, #fb7185) 36%, transparent); }
@container (max-width: 420px) {
  .gui-forecast-row,
  .gui-item { grid-template-columns: 1fr; }
  .gui-badges { justify-content: flex-start; max-width: none; }
  .gui-status-grid { grid-template-columns: 1fr; }
  .gui-status { border-right: 0; border-bottom: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.12)); }
  .gui-status:last-child { border-bottom: 0; }
}
</style>
