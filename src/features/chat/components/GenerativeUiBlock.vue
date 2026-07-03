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
  return [dir, scale ? `${scale}级` : '', speed ? `${speed}km/h` : ''].filter(Boolean).join(' · ')
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
  <article class="gui-card" :class="`gui-${block.kind}`">
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
          <template v-if="windLabel(data.wind)"> · {{ windLabel(data.wind) }}</template>
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
          <strong>{{ str(it.title, '未命名') }}</strong>
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
      <div v-for="src in sources" :key="str(src.title) + str(src.subtitle)" class="gui-source">
        <strong>{{ str(src.title, '来源') }}</strong>
        <em v-if="src.subtitle">{{ str(src.subtitle) }}</em>
        <p v-if="src.excerpt">{{ str(src.excerpt) }}</p>
        <small v-if="src.confidence || src.score">
          {{ str(src.confidence, 'score') }}<template v-if="src.score"> · {{ str(src.score) }}</template>
        </small>
      </div>
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
    </div>
  </article>
</template>

<style scoped>
.gui-card {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  padding: 12px;
  color: rgba(255, 255, 255, 0.9);
  background:
    linear-gradient(135deg, rgba(15, 23, 42, 0.86), rgba(15, 23, 42, 0.72)),
    rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.gui-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, #38bdf8, #2dd4bf);
}
.gui-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  min-width: 0;
}
.gui-head strong {
  display: block;
  font-size: 13px;
  line-height: 1.25;
  color: rgba(255, 255, 255, 0.96);
}
.gui-head em,
.gui-muted,
.gui-item em,
.gui-status em,
.gui-source em {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-style: normal;
  color: rgba(255, 255, 255, 0.46);
}
.gui-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: 8px;
  color: rgb(125, 211, 252);
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(125, 211, 252, 0.18);
}
.gui-weather-now {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px 14px;
  align-items: center;
}
.gui-temp {
  font-size: 42px;
  line-height: 0.95;
  font-weight: 700;
  color: #fff;
}
.gui-temp span {
  font-size: 18px;
  margin-left: 1px;
  color: rgba(255, 255, 255, 0.62);
}
.gui-weather-text {
  font-size: 15px;
  font-weight: 650;
}
.gui-metrics {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(82px, 1fr));
  gap: 7px;
}
.gui-metric {
  min-width: 0;
  padding: 7px 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.gui-metric small {
  display: block;
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.45);
}
.gui-metric b {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.94);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gui-forecast {
  display: grid;
  gap: 6px;
}
.gui-forecast-row {
  display: grid;
  grid-template-columns: minmax(58px, 0.9fr) minmax(76px, 1fr) minmax(64px, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 34px;
  padding: 6px 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
}
.gui-forecast-row span,
.gui-forecast-row em,
.gui-forecast-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
}
.gui-forecast-row span,
.gui-forecast-row small {
  color: rgba(255, 255, 255, 0.48);
  font-size: 11px;
}
.gui-forecast-row strong {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.94);
}
.gui-forecast-row em {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}
.gui-list,
.gui-sources,
.gui-timeline {
  display: grid;
  gap: 7px;
}
.gui-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 8px 9px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  border-left: 2px solid rgba(125, 211, 252, 0.55);
}
.gui-item strong,
.gui-step strong,
.gui-source strong,
.gui-section strong {
  display: block;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.92);
}
.gui-item p,
.gui-step p,
.gui-source p,
.gui-summary p {
  margin: 3px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.62);
}
.gui-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  max-width: 140px;
}
.gui-badges span {
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 20px;
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.08);
}
.gui-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(116px, 1fr));
  gap: 7px;
}
.gui-status {
  display: block;
  min-width: 0;
  padding: 9px;
  border-radius: 7px;
  text-decoration: none;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.gui-status strong,
.gui-status span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gui-status strong {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.92);
}
.gui-status span {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 650;
}
.gui-table-wrap {
  max-width: 100%;
  overflow-x: auto;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.gui-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}
.gui-table th,
.gui-table td {
  padding: 7px 9px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.gui-table th {
  color: rgba(255, 255, 255, 0.76);
  background: rgba(255, 255, 255, 0.06);
}
.gui-table td {
  color: rgba(255, 255, 255, 0.64);
}
.gui-step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  padding: 7px 0;
}
.gui-step-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.42);
  background: rgba(255, 255, 255, 0.08);
}
.gui-source {
  padding: 8px 9px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
}
.gui-source small {
  display: inline-flex;
  margin-top: 6px;
  font-size: 10px;
  color: rgba(125, 211, 252, 0.8);
}
.gui-section {
  margin-top: 10px;
}
.gui-section ul {
  margin: 5px 0 0;
  padding-left: 16px;
}
.gui-section li {
  margin: 2px 0;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.62);
}
.gui-empty {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}
.tone-ok {
  border-color: rgba(52, 211, 153, 0.28);
  border-left-color: rgba(52, 211, 153, 0.74);
}
.tone-ok span,
.tone-ok b {
  color: rgba(110, 231, 183, 0.95);
}
.tone-warn {
  border-color: rgba(251, 191, 36, 0.26);
  border-left-color: rgba(251, 191, 36, 0.74);
}
.tone-warn span,
.tone-warn b {
  color: rgba(253, 230, 138, 0.94);
}
.tone-danger {
  border-color: rgba(251, 113, 133, 0.26);
  border-left-color: rgba(251, 113, 133, 0.76);
}
.tone-danger span,
.tone-danger b {
  color: rgba(253, 164, 175, 0.96);
}
.tone-muted {
  opacity: 0.72;
  border-left-color: rgba(148, 163, 184, 0.5);
}
.step-done .gui-step-dot {
  color: rgba(110, 231, 183, 0.92);
  background: rgba(52, 211, 153, 0.14);
}
.step-doing .gui-step-dot {
  color: rgba(125, 211, 252, 0.95);
  background: rgba(56, 189, 248, 0.15);
}
.step-blocked .gui-step-dot {
  color: rgba(253, 164, 175, 0.95);
  background: rgba(244, 63, 94, 0.14);
}
</style>
