<script setup lang="ts">
/**
 * 悬浮侧边导航（宽屏主力）
 *
 * 设计：左侧悬浮的玻璃胶囊竖轨——默认收起（仅图标），鼠标悬停整轨时展开
 * 露出文字标签；带环境/本地启动的项，悬停该项时菜单向**右**飞出。
 * 与顶部 StatusNav 共享 nav-items.ts；窄屏（<1080px）本轨隐藏，回退顶栏。
 *
 * 运行期逻辑（wbscf 本地启动探测）复用 useWbscfServices，与 StatusNav 同源。
 */
import { computed, type Component } from 'vue'
import { useWbscfServices, wbscfServices } from '@/features/wbscf'
import {
  navItems,
  moreNavItems,
  envGroupsOf,
  envEntries,
  type NavItem,
  type EnvGroup,
  type EnvLinks,
} from './nav-items'
import IconAccount from '~icons/mdi/account-supervisor-circle-outline'
import IconCart from '~icons/mdi/cart-outline'
import IconStore from '~icons/mdi/storefront-outline'
import IconDashboard from '~icons/mdi/view-dashboard-outline'
import IconDatabase from '~icons/mdi/database-outline'
import IconRocket from '~icons/mdi/rocket-launch-outline'
import IconTag from '~icons/mdi/tag-multiple-outline'
import IconTruck from '~icons/mdi/truck-fast-outline'
import IconList from '~icons/mdi/format-list-bulleted-type'
import IconApi from '~icons/mdi/api'
import IconDots from '~icons/mdi/dots-horizontal-circle-outline'
import IconChevron from '~icons/mdi/chevron-right'
import IconPlay from '~icons/mdi/play-circle-outline'
import IconCheck from '~icons/mdi/check-circle'
import IconLoading from '~icons/mdi/loading'

// 图标名后缀 → 组件（与 nav-items.ts 的 icon 字段对应）
const iconMap: Record<string, Component> = {
  'account-supervisor-circle-outline': IconAccount,
  'cart-outline': IconCart,
  'storefront-outline': IconStore,
  'view-dashboard-outline': IconDashboard,
  'database-outline': IconDatabase,
  'rocket-launch-outline': IconRocket,
  'tag-multiple-outline': IconTag,
  'truck-fast-outline': IconTruck,
  'format-list-bulleted-type': IconList,
  'api': IconApi,
}
function iconOf(item: NavItem): Component {
  return iconMap[item.icon] ?? IconDots
}

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

const groupsOf = envGroupsOf
function entriesOf(envs: EnvLinks) {
  return envEntries(envs)
}

/** 是否有可展开菜单（环境 / 本地） */
function hasMenu(item: NavItem): boolean {
  return !!(item.envs || item.envGroups)
}

/** 给「更多」飞出项补一个图标占位（外部链接无 icon 时回退） */
const moreItems = computed(() => moreNavItems)
</script>

<template>
  <aside class="nav-rail" aria-label="工作台导航">
    <ul class="nav-rail-list">
      <li
        v-for="item in navItems"
        :key="item.label"
        class="nav-rail-item"
        :class="{ 'has-menu': hasMenu(item) }"
      >
        <!-- 触发器：外部链接 -->
        <a
          v-if="item.url"
          class="nav-rail-trigger"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="item.label"
        >
          <component :is="iconOf(item)" class="nav-rail-icon" />
          <span class="nav-rail-label">{{ item.label }}</span>
        </a>

        <!-- 触发器：带环境菜单 -->
        <button
          v-else
          type="button"
          class="nav-rail-trigger"
          :class="{ 'is-running': isRunning(item.local) }"
          :title="item.label"
        >
          <component :is="iconOf(item)" class="nav-rail-icon" />
          <span class="nav-rail-label">{{ item.label }}</span>
          <span v-if="isRunning(item.local)" class="nav-rail-run-dot" aria-hidden="true" />
          <IconChevron v-if="hasMenu(item)" class="nav-rail-chev" aria-hidden="true" />
        </button>

        <!-- 环境飞出菜单（向右） -->
        <div v-if="hasMenu(item)" class="nav-rail-flyout">
          <div class="nav-rail-card" role="menu">
            <button
              v-if="showLocal(item.local)"
              type="button"
              class="nav-rail-env nav-rail-local"
              :class="{ 'is-running': isRunning(item.local), 'is-booting': isBooting(item.local) }"
              :title="localTitle(item.local)"
              role="menuitem"
              @click="onLocalClick(item.local)"
            >
              <IconCheck v-if="isRunning(item.local)" class="nav-rail-env-icon text-emerald-400" />
              <IconLoading
                v-else-if="isBooting(item.local)"
                class="nav-rail-env-icon nav-rail-spin text-amber-300"
              />
              <IconPlay v-else class="nav-rail-env-icon text-white/40" />
              <span class="nav-rail-local-host">localhost:{{ portOf(item.local) }}</span>
              <span v-if="isBooting(item.local)" class="nav-rail-local-state">启动中…</span>
            </button>

            <div v-if="showLocal(item.local)" class="nav-rail-sep" aria-hidden="true" />
            <template
              v-for="(group, gi) in groupsOf(item)"
              :key="(group as EnvGroup).label ?? `g-${gi}`"
            >
              <div v-if="gi > 0" class="nav-rail-sep" aria-hidden="true" />
              <div v-if="(group as EnvGroup).label" class="nav-rail-env-group">
                {{ (group as EnvGroup).label }}
              </div>
              <a
                v-for="env in entriesOf((group as EnvGroup).envs)"
                :key="env.key"
                class="nav-rail-env nav-rail-env-link"
                :href="env.url"
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
              >{{ env.key }}</a>
            </template>
          </div>
        </div>
      </li>

      <!-- 更多（尾部外部链接） -->
      <li class="nav-rail-item">
        <button type="button" class="nav-rail-trigger" title="更多">
          <IconDots class="nav-rail-icon" />
          <span class="nav-rail-label">更多</span>
          <IconChevron class="nav-rail-chev" aria-hidden="true" />
        </button>
        <div class="nav-rail-flyout">
          <div class="nav-rail-card" role="menu">
            <a
              v-for="item in moreItems"
              :key="item.label"
              class="nav-rail-env nav-rail-env-link"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
            >{{ item.label }}</a>
          </div>
        </div>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.nav-rail {
  position: fixed;
  z-index: 35;
  top: 56px;
  bottom: 76px; /* 让出左下角 ChatLauncher 药丸的位置，避免遮挡 */
  left: 14px;
  display: flex;
  width: 50px;
  max-height: calc(100vh - 132px);
  flex-direction: column;
  padding: 8px 0;
  border: 1px solid rgba(0, 217, 255, 0.16);
  border-radius: var(--radius-lg);
  background: rgba(2, 6, 23, 0.6);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 18px 48px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px) saturate(135%);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  transition: width 0.26s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.26s ease;
}
.nav-rail:hover {
  width: 190px;
  border-color: rgba(0, 217, 255, 0.3);
}

.nav-rail-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0 6px;
  list-style: none;
  /* 不设 overflow：一旦某一轴非 visible，另一轴的 visible 会被规范当成 auto，
     从而裁掉向右飞出的二级菜单。桌面宽屏 11 项放得下，无需滚动。 */
}

.nav-rail-item {
  position: relative;
}

.nav-rail-trigger {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  height: 42px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgba(226, 240, 253, 0.74);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;
}
.nav-rail-trigger:hover,
.nav-rail-item:focus-within > .nav-rail-trigger {
  background: rgba(0, 217, 255, 0.1);
  color: #fff;
}
.nav-rail-trigger.is-running {
  color: #00ff94;
}

.nav-rail-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.nav-rail-label {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 0.2s ease 0.04s, transform 0.2s ease 0.04s;
}
.nav-rail:hover .nav-rail-label {
  opacity: 1;
  transform: translateX(0);
}

.nav-rail-chev {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0;
  color: rgba(0, 217, 255, 0.6);
  transition: opacity 0.2s ease 0.04s;
}
.nav-rail:hover .nav-rail-chev {
  opacity: 1;
}

.nav-rail-run-dot {
  position: absolute;
  top: 9px;
  left: 26px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #00ff94;
  box-shadow: 0 0 8px rgba(0, 255, 148, 0.85);
}

/* ===== 飞出菜单（向右）===== */
.nav-rail-flyout {
  position: absolute;
  top: -6px;
  left: calc(100% + 8px);
  min-width: 168px;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-6px);
  transition: opacity 0.16s ease, transform 0.16s ease;
  z-index: 40;
}
.nav-rail-item:hover > .nav-rail-flyout,
.nav-rail-item:focus-within > .nav-rail-flyout {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}
.nav-rail-card {
  display: flex;
  flex-direction: column;
  min-width: 168px;
  padding: 6px;
  border: 1px solid rgba(0, 217, 255, 0.18);
  border-radius: var(--radius-md);
  background: rgba(2, 6, 23, 0.9);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
}

.nav-rail-env {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: var(--radius-xs);
  font-size: 12px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.7);
  text-decoration: none;
  transition: color 0.15s, background-color 0.15s;
}
.nav-rail-env-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.nav-rail-spin {
  animation: nav-rail-spin 0.9s linear infinite;
}
@keyframes nav-rail-spin {
  to { transform: rotate(360deg); }
}
.nav-rail-local {
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
.nav-rail-local:hover,
.nav-rail-env-link:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.nav-rail-local-host {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.nav-rail-local-state {
  color: rgba(252, 211, 77, 0.9);
  font-size: 11px;
  white-space: nowrap;
}
.nav-rail-local.is-running {
  background: rgba(0, 255, 148, 0.1);
  color: #00ff94;
}
.nav-rail-local.is-booting {
  color: #fcd34d;
}
.nav-rail-env-group {
  padding: 7px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: rgba(0, 217, 255, 0.72);
  white-space: nowrap;
}
.nav-rail-sep {
  height: 1px;
  margin: 4px;
  background: rgba(255, 255, 255, 0.08);
}

/* 仅宽屏启用；窄屏回退顶栏 StatusNav */
@media (max-width: 1079px) {
  .nav-rail { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .nav-rail,
  .nav-rail-label,
  .nav-rail-chev,
  .nav-rail-flyout { transition: none; }
  .nav-rail-spin { animation: none; }
}
</style>
