<script setup lang="ts">
/**
 * Dock —— 底部「码头」导航：把原左 icon 栏 + 顶栏 dev 导航 + 顶 dev 服务条
 * 三处冗余合并为单一发光 dock（macOS 式 magnify + 向上飞出环境菜单）。
 *
 * 数据源 nav-items.ts（唯一）；wbscf 本地启动复用 useWbscfServices。
 * 门控：仅 dev + 配置了 wbscf-web 根目录时实例化轮询 composable，
 * 否则生产/未配置不空轮询 /wbscf/services（条件稳定，composable 不挂载即无副作用）。
 */
import { ref } from 'vue'
import { navItems, envGroupsOf, envEntries, iconOf, type NavItem } from './status/nav-items'
import { useWbscfServices, wbscfServices } from '@/features/wbscf'
import IconPlay from '~icons/mdi/play-circle-outline'
import IconCheck from '~icons/mdi/check-circle'
import IconLoading from '~icons/mdi/loading'

const devEnabled = import.meta.env.DEV && !!import.meta.env.VITE_WBSCF_WEB_ROOT?.trim()
// 条件在组件生命周期内恒定 → 不会触发 hook 顺序问题；未启用时不实例化、不轮询
const wbscf = devEnabled ? useWbscfServices() : null

/* 二级菜单显隐状态：用响应式 hovered 替代纯 CSS :hover，
   这样点击链接后能主动收起（新标签打开后原页 hover 态卡死） */
const hovered = ref<string | null>(null)
function onEnter(label: string) { hovered.value = label }
function onLeave() { hovered.value = null }
function isHovered(label: string): boolean { return hovered.value === label }
/* 点击菜单项（链接 / localhost）后主动收起，避免新标签打开后菜单关不掉 */
function closeMenu() { hovered.value = null }
/* 键盘可访问性：Enter/Space 打开二级菜单，Esc 关闭 */
function onMenuKeydown(e: KeyboardEvent, label: string) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    hovered.value = hovered.value === label ? null : label
  } else if (e.key === 'Escape') {
    e.preventDefault()
    hovered.value = null
  }
}

function statusOf(app?: string) {
  return app ? wbscf?.statusOf(app) : undefined
}
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
  if (devEnabled && app) wbscf?.startOrOpen(app)
  closeMenu()
}
function hasMenu(item: NavItem): boolean {
  return !!(item.envs || item.envGroups)
}
</script>

<template>
  <nav class="dock" aria-label="工作台 dock">
    <div
      v-for="item in navItems"
      :key="item.label"
      class="dk-item"
      :class="{ 'has-fly': hasMenu(item), 'is-hovered': isHovered(item.label) }"
      :tabindex="hasMenu(item) ? 0 : -1"
      :aria-haspopup="hasMenu(item) ? 'menu' : undefined"
      :aria-expanded="hasMenu(item) ? isHovered(item.label) : undefined"
      @mouseenter="onEnter(item.label)"
      @mouseleave="onLeave"
      @keydown="hasMenu(item) && onMenuKeydown($event, item.label)"
    >
      <a
        v-if="item.url"
        class="dk-btn"
        :class="{ 'is-new': item.isNew }"
        :href="item.url"
        target="_blank"
        rel="noopener noreferrer"
        :title="item.label"
      >
        <component :is="iconOf(item)" class="dk-ic" />
        <span class="dk-lb">{{ item.railLabel ?? item.label }}</span>
        <span v-if="item.isNew" class="dk-new">NEW</span>
      </a>
      <button
        v-else
        type="button"
        class="dk-btn"
        :class="{ 'is-run': isRunning(item.local) }"
        :title="item.label"
        @click="onLocalClick(item.local)"
      >
        <component :is="iconOf(item)" class="dk-ic" />
        <span class="dk-lb">{{ item.railLabel ?? item.label }}</span>
        <span v-if="isRunning(item.local)" class="dk-dot" aria-hidden="true" />
      </button>

      <div v-if="hasMenu(item)" class="dk-fly">
        <div class="dk-card" role="menu">
          <button
            v-if="showLocal(item.local)"
            type="button"
            class="dk-env dk-local"
            :class="{ 'is-run': isRunning(item.local), 'is-boot': isBooting(item.local) }"
            :title="localTitle(item.local)"
            role="menuitem"
            @click="onLocalClick(item.local)"
          >
            <IconCheck v-if="isRunning(item.local)" class="dk-ei run" />
            <IconLoading v-else-if="isBooting(item.local)" class="dk-ei spin boot" />
            <IconPlay v-else class="dk-ei dim" />
            <span class="dk-host">localhost:{{ portOf(item.local) }}</span>
            <span v-if="isBooting(item.local)" class="dk-state">启动中…</span>
          </button>
          <div v-if="showLocal(item.local)" class="dk-sep" aria-hidden="true" />
          <template v-for="(g, gi) in envGroupsOf(item)" :key="g.label ?? `g-${gi}`">
            <div v-if="gi > 0" class="dk-sep" aria-hidden="true" />
            <div v-if="g.label" class="dk-grp">{{ g.label }}</div>
            <a
              v-for="env in envEntries(g.envs)"
              :key="env.key"
              class="dk-env"
              :href="env.url"
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              @click="closeMenu"
            >{{ env.key }}</a>
          </template>
        </div>
      </div>
    </div>
  </nav>
</template>

<style scoped>
/* 底部发光 dock —— 深色玻璃拟态，与 .dk-card / .sat / .deck-total 同口径：
   高不透明玻璃底 + accent 辉光边框 + 顶部高光，匹配项目「唯一交互主色 accent」规范 */
.dock {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 38;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  max-width: calc(100vw - 32px);
  padding: 8px 10px;
  border-radius: 20px;
  overflow: visible;
  background: linear-gradient(180deg, rgba(16, 24, 40, 0.92), rgba(8, 13, 22, 0.96));
  border: 1px solid color-mix(in srgb, var(--color-accent) 26%, var(--color-line));
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.04),
    0 24px 60px -20px rgba(0, 8, 16, 0.85),
    0 0 44px -12px color-mix(in srgb, var(--color-accent) 30%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(0, 0, 0, 0.4);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  backdrop-filter: blur(20px) saturate(150%);
}

.dk-item {
  position: relative;
  display: flex;
  flex: 0 0 auto;
}
.dk-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 58px;
  padding: 8px 4px 6px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--color-ink-2);
  text-decoration: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  transform-origin: bottom center;
  transition: transform 0.22s var(--ease-out-expo), color 0.2s, background 0.2s;
}
/* 按钮上移放大也由 .is-hovered 驱动（不再用纯 CSS :hover），
   避免切走再切回时原生 hover 态把按钮卡在上面 */
.dk-item.is-hovered > .dk-btn {
  transform: translateY(-9px) scale(1.16);
  color: var(--color-ink);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  box-shadow: 0 0 18px -6px color-mix(in srgb, var(--color-accent) 40%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.dk-ic { width: 22px; height: 22px; flex-shrink: 0; transition: color 0.2s, filter 0.2s; }
/* 图标发光同样由 .is-hovered 驱动，避免切走切回时卡住 */
.dk-item.is-hovered > .dk-btn .dk-ic { color: var(--color-accent-strong); filter: drop-shadow(0 0 8px color-mix(in srgb, var(--color-accent) 60%, transparent)); }
.dk-btn.is-run { color: var(--color-alive); }
.dk-btn.is-run .dk-ic { color: var(--color-alive); filter: drop-shadow(0 0 6px color-mix(in srgb, var(--color-alive) 55%, transparent)); }
.dk-lb { font-size: 9.5px; line-height: 1; letter-spacing: 0.02em; white-space: nowrap; }
.dk-dot {
  position: absolute; top: 6px; right: 12px;
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-alive); box-shadow: 0 0 8px var(--color-alive);
}
.dk-new {
  position: absolute; top: 4px; right: 6px;
  font: 700 8px/1 var(--font-mono); letter-spacing: 0.06em;
  padding: 2px 4px; border-radius: 4px;
  color: var(--color-accent-contrast); background: var(--color-accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--color-accent) 50%, transparent);
}

/* 向上飞出菜单 */
.dk-fly {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(6px);
  padding-bottom: 10px; /* 桥：消除按钮顶缘与菜单间的悬停死区 */
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
  z-index: 41;
}
/* 二级菜单显隐完全由响应式 .is-hovered 驱动（不再用纯 CSS :hover），
   这样点击链接 closeMenu() 后菜单才能真正收起，不会被浏览器原生 hover 立即重新打开 */
.dk-item.is-hovered > .dk-fly {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}
.dk-card {
  display: flex;
  flex-direction: column;
  min-width: 168px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(8, 13, 22, 0.92);
  border: 1px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
  box-shadow: 0 18px 44px rgba(0, 8, 16, 0.5), 0 0 24px -8px color-mix(in srgb, var(--color-accent) 22%, transparent);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  backdrop-filter: blur(20px) saturate(140%);
}
.dk-env {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 10px; border-radius: 7px;
  font-size: 12px; line-height: 1; color: var(--color-ink-2);
  text-decoration: none; transition: color 0.15s, background 0.15s;
}
.dk-ei { width: 15px; height: 15px; flex-shrink: 0; }
.dk-ei.dim { color: var(--color-ink-3); }
.dk-ei.run { color: var(--color-alive); }
.dk-ei.boot { color: var(--color-warning); }
.dk-spin, .spin { animation: dk-spin 0.9s linear infinite; }
@keyframes dk-spin { to { transform: rotate(360deg); } }
.dk-local {
  width: 100%; border: 0; background: rgba(255, 255, 255, 0.05);
  appearance: none; -webkit-appearance: none; font: inherit; text-align: left; cursor: pointer;
}
.dk-local:hover, .dk-env:hover { background: rgba(255, 255, 255, 0.08); color: var(--color-ink); }
.dk-local.is-run { background: color-mix(in srgb, var(--color-alive) 12%, transparent); color: var(--color-alive); }
.dk-local.is-boot { color: var(--color-warning); }
.dk-host { font-variant-numeric: tabular-nums; white-space: nowrap; }
.dk-state { color: var(--color-warning); font-size: 11px; white-space: nowrap; }
.dk-grp { padding: 7px 10px 4px; font-size: 11px; font-weight: 600; color: color-mix(in srgb, var(--color-accent) 72%, transparent); white-space: nowrap; }
.dk-sep { height: 1px; margin: 4px; background: rgba(255, 255, 255, 0.08); }

/* 窄屏兜底：不引入横向滚动（会裁掉飞出菜单），改为缩窄图标档位 */
@media (max-width: 780px) {
  .dk-btn { width: 46px; }
  .dk-lb { display: none; }
}
@media (max-width: 620px) {
  .dock { gap: 2px; padding: 6px 8px; }
  .dk-btn { width: 38px; padding: 6px 2px 5px; }
  .dk-ic { width: 18px; height: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  .dk-btn, .dk-fly { transition: none; }
  .spin { animation: none; }
}
</style>
