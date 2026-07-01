<script setup lang="ts">
import { useWbscfServices, wbscfServices } from '@/features/wbscf'
import WbscfToastHost from './WbscfToastHost.vue'
import GitWidget from './GitWidget.vue'
import IconPlay from '~icons/mdi/play-circle-outline'
import IconCheck from '~icons/mdi/check-circle'
import IconLoading from '~icons/mdi/loading'

/**
 * 状态栏左侧「工作台导航」
 *
 * 紧跟在品牌（Hao123）右侧的一排内部系统入口：
 *   - 账号中心 / 买家中心 / 卖家中心 / 运营管理 / ERP：hover 展开本地 dev 服务 + dev/test/pre；
 *   - 水星 / GitLab Tags / 发布平台 / 我的地盘-禅道 / apifox：普通直链（新标签打开）。
 *
 * 链接全部来自知识库（Obsidian「06-环境入口」「05-常用链接汇总」）；改地址只改下面
 * navItems 即可，无需动模板。
 *
 * 本地 dev 服务接入（wbscf-web）：状态来自 dev server 的 /wbscf/services。运行中时
 * 标签文字转绿（状态栏运行状态指示）；hover 菜单顶部一行 localhost:端口 可点击启动 / 打开，
 * 运行中绿字、启动中转圈琥珀、未启动可点击拉起。点击未运行服务另弹 toast 反馈启动进度。
 */
interface EnvLinks {
  dev: string
  test: string
  pre: string
}

interface NavItem {
  label: string
  /** 普通直链地址（无 envs 时用） */
  url?: string
  /** 配了 envs 的项，hover 展开 dev/test/pre 三环境子菜单 */
  envs?: EnvLinks
  /** wbscf-web 本地 dev 服务应用 key（account/buyer/seller/ops/erp）；配了即在 dev 前加 localhost 入口 */
  local?: string
}

/** 环境子菜单的展示顺序（dev/test/pre 纯文字，不带点） */
const envMeta: { key: keyof EnvLinks }[] = [
  { key: 'dev' },
  { key: 'test' },
  { key: 'pre' },
]

/** 导航项配置（地址取自知识库）。顺序即展示顺序：前 5 项带环境子菜单，后 5 项为直链。 */
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
  { label: 'ERP', local: 'erp', envs: {
      dev: 'https://erp-dev.wbscf.tech/console/#/auth/login',
      test: 'https://erp-test.wbscf.tech/console/#/auth/login',
      pre: 'https://erp-pre.wbscf.tech/console/#/auth/login' } },
  { label: '水星', url: 'http://admin-dev.wbscf.tech/login' },
  { label: 'GitLab Tags', url: 'http://git.esteel.tech/brcc/wbtech/fe/platform/wbscf-web/-/tags' },
  { label: '发布平台', url: 'http://cd.esteel.tech/#/page/history' },
  { label: '我的地盘-禅道', url: 'http://pm.esteel.tech/zentao/my/' },
  { label: 'apifox', url: 'https://app.apifox.com/project/7718065' },
]

const { toasts, startOrOpen, closeToast, statusOf } = useWbscfServices()

/** localhost 入口是否展示：仅当 dev 服务可用（脚本存在于 wbscf-web/package.json）时 */
function showLocal(app?: string): boolean {
  return !!app && statusOf(app)?.available === true
}
/** 本地 dev 服务是否运行中（决定标签文字绿色 + localhost 入口绿字） */
function isRunning(app?: string): boolean {
  return !!app && statusOf(app)?.running === true
}
/** 本地 dev 服务是否启动中（端口未就绪、已拉起）→ localhost 行转圈琥珀 + 「启动中…」 */
function isBooting(app?: string): boolean {
  return !!app && statusOf(app)?.booting === true
}
/** localhost 入口展示的端口（取自静态注册表，不依赖状态是否已加载） */
function portOf(app?: string): number | undefined {
  if (!app) return undefined
  return wbscfServices.find((s) => s.app === app)?.port
}
/** 悬停提示：点击语义随状态切换 */
function localTitle(app?: string): string {
  if (isRunning(app)) return '本地服务运行中，点击打开'
  if (isBooting(app)) return '正在启动本地服务…'
  return '点击启动本地 dev 服务'
}
function onLocalClick(app?: string): void {
  if (app) startOrOpen(app)
}
/** toast「打开」按钮：在新标签打开该服务的本地 URL */
function openUrl(url: string): void {
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <nav class="status-nav" aria-label="工作台导航">
    <span class="status-nav-divider" aria-hidden="true" />
    <ul class="status-nav-list">
      <li v-for="item in navItems" :key="item.label" class="status-nav-item">
        <!-- 有环境子菜单：hover 展开本地服务 + dev/test/pre（标签是 hover 面，不跳转） -->
        <template v-if="item.envs">
          <!-- 本地 dev 服务运行中时，标签文字转绿（状态栏运行状态指示） -->
          <span class="status-nav-label" :class="{ 'is-local-running': isRunning(item.local) }">
            {{ item.label }}
          </span>

          <div class="status-nav-menu">
            <div class="status-nav-menu-card" role="menu">
              <!-- 本地服务（顶部高亮行）：localhost:端口；运行中绿字+✓、启动中转圈琥珀、未启动可点击拉起 -->
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
              <!-- 本地服务与环境的分组分隔 -->
              <div v-if="showLocal(item.local)" class="status-nav-menu-sep" aria-hidden="true" />
              <a
                v-for="env in envMeta"
                :key="env.key"
                class="status-nav-env status-nav-env-link"
                :href="item.envs[env.key]"
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
              >{{ env.key }}</a>
            </div>
          </div>
        </template>

        <!-- 普通直链 -->
        <a
          v-else
          class="status-nav-label"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
        >{{ item.label }}</a>
      </li>
      <li class="status-nav-item status-nav-git-item">
        <GitWidget />
      </li>
    </ul>
  </nav>

  <!-- 启动进度 toast：抽到独立组件 WbscfToastHost（Teleport 到 body、固定右下角） -->
  <WbscfToastHost :toasts="toasts" @close="closeToast" @open="openUrl" />
</template>

<style scoped>
/* align-self:stretch 让 nav 撑满状态栏高度（h-9），
   下拉菜单 top:100% 正好落在状态栏底边，不会叠在状态栏上 */
.status-nav {
  display: flex;
  align-items: stretch;
  align-self: stretch;
  min-width: 0;
}

.status-nav-divider {
  align-self: center;
  width: 1px;
  height: 14px;
  margin: 0 10px;
  background: rgba(255, 255, 255, 0.18);
  flex-shrink: 0;
}

.status-nav-list {
  display: flex;
  align-items: stretch;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.status-nav-item {
  position: relative;
  display: flex;
  align-items: center;
}

/* 文字口径对齐 StatusTime：text-white / 13px / font-normal / -0.01em；
   前 5 项（span）与后 5 项（a）共用同一段样式，颜色完全一致 */
.status-nav-label {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: -0.01em;
  color: #fff;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.status-nav-item:hover > .status-nav-label {
  background: rgba(255, 255, 255, 0.1);
}

/* 本地 dev 服务运行中：标签文字转绿（状态栏运行状态指示，替代原先的绿点） */
.status-nav-label.is-local-running {
  color: #34d399;
}

/* 下拉菜单：absolute 悬浮在状态栏下方（透明毛玻璃，同 ChatLauncher / ZentaoInbox 同族） */
.status-nav-menu {
  position: absolute;
  top: 100%;
  left: 0;
  /* 透明桥接区：鼠标从标签移到卡片途中不丢失 hover */
  padding-top: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 50;
}

.status-nav-item:hover > .status-nav-menu {
  opacity: 1;
  pointer-events: auto;
}

/* 下拉卡：加宽 + 加大圆角 + 更通透的玻璃底，呼吸感更好 */
.status-nav-menu-card {
  display: flex;
  flex-direction: column;
  min-width: 168px;
  padding: 6px;
  border-radius: 14px;
  background: rgba(20, 24, 36, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
}

.status-nav-env {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.66);
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

/* 本地服务行：满宽按钮 + 轻底高亮，使其作为主操作与下方环境链接区分 */
.status-nav-local {
  width: 100%;
  /* 整行不换行：localhost:xxxx + 启动中… 挤在一行，避免「启动中」换行 */
  flex-wrap: nowrap;
  border: 0;
  background: rgba(255, 255, 255, 0.05);
  appearance: none;
  -webkit-appearance: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.status-nav-local:hover {
  background: rgba(255, 255, 255, 0.1);
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
  background: rgba(52, 211, 153, 0.1);
  color: #34d399;
}
.status-nav-local.is-booting {
  color: #fcd34d;
}

/* 环境链接：纯文字行，hover 微提亮 */
.status-nav-env-link:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.status-nav-menu-sep {
  height: 1px;
  margin: 4px 4px;
  background: rgba(255, 255, 255, 0.08);
}
</style>
