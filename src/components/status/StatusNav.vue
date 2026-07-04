<script setup lang="ts">
import { useWbscfServices, wbscfServices } from '@/features/wbscf'
import GitWidget from './GitWidget.vue'
import ModelWidget from './ModelWidget.vue'
import ModaoWidget from './ModaoWidget.vue'
import IconPlay from '~icons/mdi/play-circle-outline'
import IconCheck from '~icons/mdi/check-circle'
import IconLoading from '~icons/mdi/loading'

type EnvKey = 'dev' | 'test' | 'pre'
type EnvLinks = Partial<Record<EnvKey, string>>

interface EnvGroup {
  label?: string
  envs: EnvLinks
}

interface NavItem {
  label: string
  url?: string
  envs?: EnvLinks
  envGroups?: EnvGroup[]
  local?: string
}

const envMeta: { key: EnvKey }[] = [
  { key: 'dev' },
  { key: 'test' },
  { key: 'pre' },
]

interface EnvEntry {
  key: EnvKey
  url: string
}

const navItems: NavItem[] = [
  { label: '账号中心', local: 'account', envs: {
      dev: 'http://i-dev.wbscf.tech/account/#/auth/login',
      test: 'http://i-test.wbscf.tech/account/#/auth/login',
      pre: 'http://i-pre.wbscf.tech/account/#/auth/login' } },
  { label: '买家中心', local: 'buyer', envs: {
      dev: 'http://i-dev.wbscf.tech/buyer/#/auth/login',
      test: 'http://i-test.wbscf.tech/buyer/#/auth/login',
      pre: 'http://i-pre.wbscf.tech/buyer/#/auth/login' } },
  { label: '卖家中心', local: 'seller', envs: {
      dev: 'http://i-dev.wbscf.tech/seller/#/auth/login',
      test: 'http://i-test.wbscf.tech/seller/#/auth/login',
      pre: 'http://i-pre.wbscf.tech/seller/#/auth/login' } },
  { label: '运营管理', local: 'ops', envs: {
      dev: 'http://ops-dev.wbscf.tech/#/dashboard',
      test: 'http://ops-test.wbscf.tech/#/dashboard',
      pre: 'http://ops-pre.wbscf.tech/#/dashboard' } },
  { label: 'ERP', local: 'erp',
    envGroups: [
      { label: '新ERP', envs: {
          dev: 'https://erp-dev.wbscf.tech/console/#/auth/login',
          test: 'https://erp-test.wbscf.tech/console/#/auth/login',
          pre: 'https://erp-pre.wbscf.tech/console/#/auth/login' } },
      { label: '老ERP', envs: {
          dev: 'https://erp-dev.wbscf.com',
          test: 'https://erp-test.wbscf.com' } },
    ] },
  { label: '水星', url: 'http://admin-dev.wbscf.tech/login' },
  { label: 'GitLab Tags', url: 'http://git.esteel.tech/brcc/wbtech/fe/platform/wbscf-web/-/tags' },
  { label: '发布平台', url: 'http://cd.esteel.tech/#/page/history' },
  { label: '我的地盘-禅道', url: 'http://pm.esteel.tech/zentao/my/' },
  { label: 'apifox', url: 'https://app.apifox.com/project/7718065' },
]
const moreNavItems = navItems.slice(7)

const { startOrOpen, statusOf } = useWbscfServices()

function showLocal(app?: string): boolean {
  return !!app && statusOf(app)?.available === true
}
function isRunning(app?: string): boolean {
  return !!app && statusOf(app)?.running === true
}
function isBooting(app?: string): boolean {
  return !!app && statusOf(app)?.booting === true
}
function portOf(app?: string): number | undefined {
  if (!app) return undefined
  return wbscfServices.find((s) => s.app === app)?.port
}
function localTitle(app?: string): string {
  if (isRunning(app)) return '本地服务运行中，点击打开'
  if (isBooting(app)) return '正在启动本地服务…'
  return '点击启动本地 dev 服务'
}
function onLocalClick(app?: string): void {
  if (app) startOrOpen(app)
}
function envGroupsOf(item: NavItem): EnvGroup[] {
  if (item.envGroups?.length) return item.envGroups
  return item.envs ? [{ envs: item.envs }] : []
}
function envEntries(envs: EnvLinks): EnvEntry[] {
  return envMeta
    .map(({ key }) => ({ key, url: envs[key] }))
    .filter((env): env is EnvEntry => !!env.url)
}
</script>

<template>
  <nav class="status-nav" aria-label="工作台导航">
    <ul class="status-nav-list">
      <li
        v-for="(item, index) in navItems"
        :key="item.label"
        class="status-nav-item"
        :class="{
          'status-nav-tail-item': index >= 7,
          'status-nav-compact-tail-item': index >= 7,
        }"
      >
        <template v-if="item.envs || item.envGroups">
          <span class="status-nav-label" :class="{ 'is-local-running': isRunning(item.local) }">
            {{ item.label }}
            <span v-if="isRunning(item.local)" class="status-nav-run-dot" aria-hidden="true" />
          </span>

          <div class="status-nav-menu">
            <div class="status-nav-menu-card" role="menu">
              <button
                v-if="showLocal(item.local)"
                type="button"
                class="status-nav-env status-nav-local"
                :class="{ 'is-running': isRunning(item.local), 'is-booting': isBooting(item.local) }"
                :title="localTitle(item.local)"
                role="menuitem"
                @click="onLocalClick(item.local)"
              >
                <IconCheck v-if="isRunning(item.local)" class="status-nav-env-icon text-emerald-400" />
                <IconLoading v-else-if="isBooting(item.local)" class="status-nav-env-icon status-nav-spin text-amber-300" />
                <IconPlay v-else class="status-nav-env-icon text-white/40" />
                <span class="status-nav-local-host">localhost:{{ portOf(item.local) }}</span>
                <span v-if="isBooting(item.local)" class="status-nav-local-state">启动中…</span>
              </button>

              <div v-if="showLocal(item.local)" class="status-nav-menu-sep" aria-hidden="true" />
              <template v-for="(group, groupIndex) in envGroupsOf(item)" :key="group.label ?? `envs-${groupIndex}`">
                <div v-if="groupIndex > 0" class="status-nav-menu-sep" aria-hidden="true" />
                <div v-if="group.label" class="status-nav-env-group">{{ group.label }}</div>
                <a
                  v-for="env in envEntries(group.envs)"
                  :key="env.key"
                  class="status-nav-env status-nav-env-link"
                  :href="env.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                >{{ env.key }}</a>
              </template>
            </div>
          </div>
        </template>

        <a
          v-else
          class="status-nav-label"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
        >{{ item.label }}</a>
      </li>

      <li class="status-nav-item status-nav-more-item">
        <button type="button" class="status-nav-label status-nav-more-button">更多</button>
        <div class="status-nav-menu status-nav-more-menu">
          <div class="status-nav-menu-card" role="menu">
            <a
              v-for="item in moreNavItems"
              :key="item.label"
              class="status-nav-env status-nav-env-link"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
            >{{ item.label }}</a>
          </div>
        </div>
      </li>

      <li class="status-nav-divider" aria-hidden="true" />
      <li class="status-nav-item status-nav-modao-item">
        <ModaoWidget />
      </li>
      <li class="status-nav-item status-nav-git-item">
        <GitWidget />
      </li>
      <li class="status-nav-item status-nav-model-item">
        <ModelWidget />
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.status-nav {
  display: flex;
  align-items: stretch;
  align-self: stretch;
  min-width: 0;
}

.status-nav-list {
  display: flex;
  align-items: stretch;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.status-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}

.status-nav-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0;
  color: rgba(224, 242, 254, 0.82);
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
button.status-nav-label {
  border: 0;
  background: transparent;
  appearance: none;
  -webkit-appearance: none;
}

.status-nav-item:hover > .status-nav-label {
  color: #fff;
  background: rgba(125, 211, 252, 0.09);
}

.status-nav-label.is-local-running {
  color: #34d399;
}
.status-nav-run-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: #34d399;
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.8);
}

.status-nav-divider {
  align-self: center;
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: rgba(125, 211, 252, 0.18);
  flex-shrink: 0;
}
.status-nav-more-item {
  display: none;
}
.status-nav-more-menu {
  left: auto;
  right: 0;
}

.status-nav-menu {
  position: absolute;
  top: 100%;
  left: 0;
  padding-top: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 50;
}

.status-nav-item:hover > .status-nav-menu,
.status-nav-item:focus-within > .status-nav-menu {
  opacity: 1;
  pointer-events: auto;
}

.status-nav-menu-card {
  display: flex;
  flex-direction: column;
  min-width: 160px;
  padding: 6px;
  border-radius: 10px;
  background: rgba(2, 6, 23, 0.86);
  border: 1px solid rgba(125, 211, 252, 0.14);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px) saturate(135%);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
}

.status-nav-env {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.68);
  text-decoration: none;
  transition: color 0.15s, background-color 0.15s;
}

.status-nav-env-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.status-nav-spin {
  animation: status-nav-spin 0.9s linear infinite;
}
@keyframes status-nav-spin {
  to {
    transform: rotate(360deg);
  }
}

.status-nav-local {
  width: 100%;
  flex-wrap: nowrap;
  border: 0;
  background: rgba(255, 255, 255, 0.045);
  appearance: none;
  -webkit-appearance: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.status-nav-local:hover,
.status-nav-env-link:hover {
  background: rgba(255, 255, 255, 0.075);
  color: #fff;
}
.status-nav-local-host {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.status-nav-local-state {
  color: rgba(252, 211, 77, 0.9);
  font-size: 11px;
  white-space: nowrap;
}
.status-nav-local.is-running {
  background: rgba(52, 211, 153, 0.09);
  color: #34d399;
}
.status-nav-local.is-booting {
  color: #fcd34d;
}

.status-nav-env-group {
  padding: 7px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: rgba(125, 211, 252, 0.72);
  white-space: nowrap;
}

.status-nav-menu-sep {
  height: 1px;
  margin: 4px 4px;
  background: rgba(255, 255, 255, 0.08);
}

@media (max-width: 1380px) {
  .status-nav-tail-item {
    display: none;
  }
  .status-nav-more-item {
    display: flex;
  }
}
@media (max-width: 1180px) {
  .status-nav-compact-tail-item {
    display: none;
  }
}
@media (max-width: 900px) {
  .status-nav-item:nth-child(n + 5):not(.status-nav-more-item):not(.status-nav-modao-item):not(.status-nav-git-item):not(.status-nav-model-item),
  .status-nav-model-item {
    display: none;
  }
  .status-nav-more-item {
    display: flex;
  }
}
</style>
