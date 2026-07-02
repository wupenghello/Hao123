/**
 * wbscf-web · 本地 dev 服务 Vite 插件
 *
 * 浏览器无法 spawn 子进程，故由 Vite dev server（Node）在 dev 时承担：
 *   - 读 VITE_WBSCF_WEB_ROOT 指向的 wbscf-web/package.json，校验 dev:* 脚本是否存在
 *     （不存在则该导航项的 localhost 入口自动隐藏，dev/test/pre 不受影响）；
 *   - 暴露中间件：
 *       GET /wbscf/services          全部服务的 available / running / booting 状态；
 *       GET /wbscf/launch?app=<app>  返回一个「拉起 + 等就绪 + 跳转」的中转 HTML 页
 *                                    （已在运行则不重复拉、直接等跳转），供 window.open 打开。
 *   - 拉起用配置的包管理器（VITE_WBSCF_PKG_MGR，默认 pnpm）执行 `run <script>`，
 *     cwd=wbscf-web 根；stdio 继承到 TodayOps dev 终端，方便看 Vite 启动横幅与报错；
 *   - 「是否在运行」用 HTTP 探测 localhost:port（任意响应即视为就绪），既覆盖本插件拉起
 *     的服务，也覆盖用户在别处手动启动的服务——保证「启动了就不重复拉、直接打开」。
 *
 * 仅 dev 生效（configureServer 只在 serve 阶段跑）；生产构建无 dev server，前端 fetch
 * /wbscf/* 会 404 → composable 降级为不展示 localhost 入口。
 *
 * env 路径写法：Windows 建议用正斜杠（D:/projects/wbscf-web），反斜杠在 .env 解析中
 * 可能被当作转义符。
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { wbscfServices, type WbscfServiceDef } from './src/features/wbscf/config'
import type { WbscfServiceStatus, WbscfServicesResponse } from './src/features/wbscf/types'

interface WbscfPluginOptions {
  /** wbscf-web 仓库根目录（VITE_WBSCF_WEB_ROOT） */
  root: string
  /** 包管理器（VITE_WBSCF_PKG_MGR，默认 pnpm）：pnpm / npm / yarn */
  pkgMgr: string
}

interface ProcState {
  proc: ChildProcess | null
  pid: number | null
}

interface LaunchPlan {
  command: string
  args: string[]
}

/** 各 app 的拉起进程（dev server 单例，模块级即可） */
const states = new Map<string, ProcState>()

/** package.json scripts 缓存（按 mtime 失效，避免每次探测都读盘） */
let scriptsCache: { mtime: number; set: Set<string> } | null = null

function isOurs(app: string): boolean {
  const s = states.get(app)
  // exitCode/signalCode 都为 null 表示仍在运行；killed 表示已发 kill
  return !!s?.proc && !s.proc.killed && s.proc.exitCode === null && s.proc.signalCode === null
}

function killTree(st: ProcState): void {
  const pid = st.pid
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      // /T 连带子进程树（cmd → pnpm → turbo → vite）一起收掉，/F 强制
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      // 杀整个进程组：spawn 时 detached:true 让子进程自成一组（pgid=pid），
      // 负号 pid 连同 turbo/vite 等子孙一并收掉，避免只 SIGTERM 了 pnpm 壳、孙进程变孤儿占端口。
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        /* 组可能已不存在 */
      }
    }
  } catch {
    /* 进程可能已自行退出，忽略 */
  }
}

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

export function wbscfPlugin(options: WbscfPluginOptions): Plugin {
  const root = options.root?.trim() ? path.resolve(options.root.trim()) : ''
  const pkgMgr = (options.pkgMgr?.trim() || 'pnpm').toLowerCase()

  /**
   * 就绪探测分两层：
   *   - port probe 很轻，只判断端口是否已 listen；用于 /wbscf/services 高频状态刷新，避免每 4s
   *     对 5 个 Vite 子应用各发一次首页 HTTP 请求，触发 optimizeDeps/transform 而拖慢启动。
   *   - HTTP ready probe 只在中转页/LLM 真要跳转前使用，确保首屏编译完成后再 replace。
   */
  function probePort(port: number, timeoutMs = 350): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port })
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        socket.destroy()
        resolve(ok)
      }
      socket.setTimeout(timeoutMs)
      socket.once('connect', () => finish(true))
      socket.once('timeout', () => finish(false))
      socket.once('error', () => finish(false))
    })
  }

  async function probeHttp(url: string, timeoutMs = 1000): Promise<boolean> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      await fetch(url, { signal: ctrl.signal })
      return true
    } catch {
      return false // ECONNREFUSED / 超时 / 中止
    } finally {
      clearTimeout(timer)
    }
  }

  /** 探测结果短缓存：状态刷新走端口探测，跳转前走 HTTP ready 探测；两套缓存互不污染。 */
  const portProbeCache = new Map<string, { running: boolean; at: number }>()
  const readyProbeCache = new Map<string, { ready: boolean; at: number }>()
  const PROBE_CACHE_FRESH_MS = 600
  async function cachedPortProbe(app: string, port: number): Promise<boolean> {
    const hit = portProbeCache.get(app)
    const fresh = hit && Date.now() - hit.at < (hit.running ? 4000 : PROBE_CACHE_FRESH_MS)
    if (fresh) return hit!.running
    const running = await probePort(port)
    portProbeCache.set(app, { running, at: Date.now() })
    return running
  }
  async function cachedReadyProbe(app: string, url: string): Promise<boolean> {
    const hit = readyProbeCache.get(app)
    const fresh = hit && Date.now() - hit.at < (hit.ready ? 4000 : PROBE_CACHE_FRESH_MS)
    if (fresh) return hit!.ready
    const ready = await probeHttp(url, 8000)
    readyProbeCache.set(app, { ready, at: Date.now() })
    return ready
  }

  /** 读 wbscf-web/package.json 的 scripts（按 mtime 缓存） */
  function getScripts(): Set<string> {
    if (!root) return new Set()
    const pkgPath = path.join(root, 'package.json')
    try {
      const st = fs.statSync(pkgPath)
      if (scriptsCache && scriptsCache.mtime === st.mtimeMs) return scriptsCache.set
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> }
      const set = new Set(Object.keys(pkg.scripts ?? {}))
      scriptsCache = { mtime: st.mtimeMs, set }
      return set
    } catch {
      return new Set()
    }
  }

  function snapshot() {
    const enabled = !!root && fs.existsSync(path.join(root, 'package.json'))
    return { enabled, scripts: enabled ? getScripts() : new Set<string>() }
  }

  function launchPlan(svc: WbscfServiceDef): LaunchPlan {
    if (pkgMgr === 'pnpm') return { command: pkgMgr, args: ['--filter', svc.pkg, 'run', 'dev'] }
    if (pkgMgr === 'yarn') return { command: pkgMgr, args: ['workspace', svc.pkg, 'dev'] }
    return { command: pkgMgr, args: ['run', svc.script] }
  }

  async function buildStatus(): Promise<WbscfServicesResponse> {
    const { enabled, scripts } = snapshot()
    const services: WbscfServiceStatus[] = await Promise.all(
      wbscfServices.map(async (svc) => {
        const ours = isOurs(svc.app)
        const running = enabled ? await cachedPortProbe(svc.app, svc.port) : false
        return {
          app: svc.app,
          label: svc.label,
          script: svc.script,
          url: svc.url,
          port: svc.port,
          available: scripts.has(svc.script),
          running,
          booting: ours && !running,
        }
      }),
    )
    return { enabled, root, services }
  }

  /**
   * 预热 workspace 包的 CLI shim：pnpm 首次执行某个 filter 时会生成/校验 node_modules/.bin，
   * 提前在 TodayOps dev server 启动后空闲期做掉，用户点击时少等一段同步准备时间。
   */
  function warmPnpmFilters(): void {
    if (pkgMgr !== 'pnpm' || !snapshot().enabled) return
    for (const svc of wbscfServices) {
      const r = spawn(pkgMgr, ['--filter', svc.pkg, 'exec', 'vite', '--version'], {
        cwd: root,
        shell: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      r.on('error', () => {})
      r.on('exit', () => {})
    }
  }

  /** 拉起服务（已由本插件拉起则不重复拉） */
  function spawnService(app: string): void {
    if (isOurs(app)) return
    const svc = wbscfServices.find((s) => s.app === app)
    if (!svc) return
    const plan = launchPlan(svc)
    const proc = spawn(plan.command, plan.args, {
      cwd: root,
      shell: true,
      stdio: 'inherit',
      // 非 Windows 下 detached 让子进程自成进程组（pgid=pid），killTree 才能用 -pid 收掉整棵树。
      // Windows 不用 detached（靠 taskkill /T 收树）；detached 本身不影响 stdio:'inherit' 的输出转发。
      detached: process.platform !== 'win32',
    })
    states.set(app, { proc, pid: proc.pid ?? null })
    // spawn 失败（pkgMgr 缺失 / 权限 / 句柄耗尽）触发 'error' 而非 'exit'：
    // 不监听会让 states 残留死 proc（isOurs 永真 → 该 app 永远卡「启动中」），
    // 且 Node 会把无监听 'error' 当未捕获异常抛出。这里复位 state 让后续可重试。
    proc.on('error', () => {
      const cur = states.get(app)
      if (cur?.proc === proc) states.set(app, { proc: null, pid: null })
    })
    proc.on('exit', () => {
      const cur = states.get(app)
      if (cur?.proc === proc) states.set(app, { proc: null, pid: null })
    })
  }

  /** 幂等启动：我们已拉起 / 外部已在运行 / 脚本不存在 / 根未配置 都不重复拉 */
  async function ensureStarted(app: string): Promise<void> {
    if (isOurs(app)) return
    const svc = wbscfServices.find((s) => s.app === app)
    if (!svc) return
    const { enabled, scripts } = snapshot()
    if (!enabled || !scripts.has(svc.script)) return
    if (await cachedPortProbe(app, svc.port)) return // 外部已在运行，直接打开、不重复拉
    spawnService(app)
  }

  /** 「拉起 + 等端口就绪 + 跳转」的中转页（点击即打开，不会被弹窗拦截） */
  function launcherHtml(svc: WbscfServiceDef): string {
    const cfg = JSON.stringify({ app: svc.app, label: svc.label, url: svc.url, port: svc.port, readyUrl: `/wbscf/ready?app=${svc.app}` })
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>启动 ${svc.label} 本地服务</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0f172a;color:#e2e8f0;
       font:14px/1.6 ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif}
  .wrap{text-align:center;padding:32px}
  .ring{width:34px;height:34px;border-radius:50%;
        border:3px solid rgba(255,255,255,.15);border-top-color:#34d399;
        animation:sp 1s linear infinite;margin:0 auto 16px}
  @keyframes sp{to{transform:rotate(360deg)}}
  h1{font-size:16px;font-weight:600;margin:0 0 6px}
  .url{color:#94a3b8;font-size:13px}
  .url code{color:#67e8f9}
  .hint{margin-top:18px;color:#64748b;font-size:12px}
  .hint a{color:#67e8f9}
  .err .ring{border-top-color:#f87171;animation:none}
</style></head><body>
<div class="wrap" id="wrap">
  <div class="ring"></div>
  <h1>正在启动 <b>${svc.label}</b> 本地服务…</h1>
  <div class="url">端口 ${svc.port} · <code>${svc.url}</code></div>
  <div class="hint" id="hint">首次构建可能需要数十秒，请稍候（启动日志见运行 TodayOps 的终端）</div>
</div>
<script>
var CFG=${cfg};
var start=Date.now();
var stopped=false;
var pending=false;
var xhr=function(){
  if(stopped||pending)return;
  pending=true;
  fetch(CFG.readyUrl).then(function(r){return r.json()}).then(function(d){
    if(d.ready){done();location.replace(CFG.url);return;}
  }).catch(function(){}).finally(function(){pending=false;});
};
var done=function(){stopped=true;};
// 硬墙钟超时检查：不依赖 fetch 是否返回（连接挂起不响应时也能到点报错），
// 与 composable 的轮询口径一致用 120s，避免中转页 90s 已超时而 toast/LLM 仍在等的不一致。
var watchdog=setInterval(function(){
  if(stopped)return;
  if(Date.now()-start>120000){
    stopped=true;
    clearInterval(watchdog);
    document.getElementById("wrap").classList.add("err");
    document.getElementById("hint").innerHTML=
      "启动超时，请到运行 TodayOps 的终端查看 wbscf-web 的报错；"+
      '<a href="'+CFG.url+'">点此手动打开</a> 或重试。';
  }
},1000);
xhr();
setInterval(function(){if(!stopped)xhr();},1500);
</script></body></html>`
  }

  /**
   * 启动 Claude Code（新开独立终端窗口，cwd = root）。
   * 用 spawnSync 同步捕获 spawn 失败（终端程序不存在 / 权限 / 路径错误），避免 spawn 异步
   * 'error' 事件晚于 HTTP 响应返回，造成前端「已启动」假成功。与 spawnService 不同：
   * claude 是交互式终端窗口、无端口可探测就绪，无法靠轮询兜底，故必须同步拿到 spawn 结果。
   */
  function spawnClaude(): { ok: boolean; error?: string } {
    if (!root) return { ok: false, error: '未配置 VITE_WBSCF_WEB_ROOT' }
    try {
      let r: ReturnType<typeof spawnSync>
      if (process.platform === 'win32') {
        // 优先 Windows Terminal（wt）：现代标签页终端，Claude Code TUI 体验最佳，不弹老版 cmd 黑框。
        // wt 是 Store 应用，未安装时 spawnSync 返回 ENOENT（执行别名 stub 偶尔也给异常错误）→
        // 回退到系统自带 PowerShell（仍是独立窗口，但非老 cmd）。两种方式都同步检测 spawn 失败。
        // root 来自受信任的开发环境变量（path.resolve 后的路径）。
        // wt 直接 CreateProcess("claude") 不查 PATHEXT，找不到 npm 全局 shim（实际文件是 claude.cmd），
        // 故用 PowerShell 包装让 shell 解析 shim；窗口仍是 Windows Terminal（非老 cmd 黑框）。
        // `--` 必需：wt 规定以 `-` 开头的 commandline 参数（-NoExit/-Command）前必须用 -- 分隔，
        // 否则会被当成 wt 自己的选项而报错。
        r = spawnSync('wt', ['-d', root, '--', 'powershell', '-NoExit', '-Command', 'claude'], {
          stdio: 'ignore',
        })
        if (r.error) {
          r = spawnSync(
            'powershell',
            ['-NoExit', '-Command', `Set-Location -LiteralPath '${root}'; claude`],
            { stdio: 'ignore' },
          )
        }
      } else if (process.platform === 'darwin') {
        // macOS：osascript 新开 Terminal 窗口，路径转义引号避免注入
        const safePath = root.replace(/"/g, '\\"')
        const script = `tell application "Terminal" to do script "cd \\"${safePath}\\" && claude; exec bash"`
        r = spawnSync('osascript', ['-e', script], { stdio: 'ignore' })
      } else {
        // Linux：x-terminal-emulator 是 Debian/Ubuntu 专属，Arch/Fedora/CentOS 缺失时 spawnSync
        // 同步返回 ENOENT，据此报错而非假成功（用户可自行安装终端模拟器）。
        const safePath = root.replace(/"/g, '\\"')
        r = spawnSync(
          'x-terminal-emulator',
          ['-e', 'sh', '-c', `cd "${safePath}" && claude; exec bash`],
          { stdio: 'ignore' },
        )
      }
      if (r.error) return { ok: false, error: r.error.message }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return {
    name: 'wbscf-dev-services',
    configureServer(server) {
      const warmTimer = setTimeout(warmPnpmFilters, 1200)

      server.middlewares.use((req, res, next) => {
        const reqUrl = req.url ?? ''
        // 处理 wbscf 和 claude 两类接口，其他请求放行
        if (!reqUrl.startsWith('/wbscf/') && !reqUrl.startsWith('/claude/')) return next()
        void (async () => {
          const u = new URL(reqUrl, 'http://localhost')
          const pathname = u.pathname.replace(/\/+$/, '') || '/'
          const app = u.searchParams.get('app') ?? ''

          if (pathname === '/wbscf/services' && req.method === 'GET') {
            sendJson(res, 200, await buildStatus())
            return
          }
          if (pathname === '/wbscf/ready' && req.method === 'GET') {
            const svc = wbscfServices.find((s) => s.app === app)
            if (!svc) {
              sendJson(res, 400, { error: 'unknown app' })
              return
            }
            const ready = await cachedReadyProbe(svc.app, svc.url)
            if (ready) portProbeCache.set(svc.app, { running: true, at: Date.now() })
            sendJson(res, 200, { app: svc.app, ready })
            return
          }
          if (pathname === '/wbscf/launch' && req.method === 'GET') {
            const svc = wbscfServices.find((s) => s.app === app)
            if (!svc) {
              sendJson(res, 400, { error: 'unknown app' })
              return
            }
            await ensureStarted(svc.app)
            // ?json=1：只触发拉起并返回 JSON 状态（供无用户手势的 LLM 路径，省去收发整页 HTML）。
            // 不带 json：返回「拉起 + 等就绪 + 跳转」中转页（供状态栏点击 window.open）。
            if (u.searchParams.get('json') === '1') {
              sendJson(res, 200, await buildStatus())
              return
            }
            res.setHeader('content-type', 'text/html; charset=utf-8')
            res.end(launcherHtml(svc))
            return
          }

          // Claude Code 接口（仅允许 GET，对齐 wbscf 接口规范）
          if (pathname === '/claude/status' && req.method === 'GET') {
            // 复用 snapshot() 的 enabled 判定（与 wbscf 同源，避免两处 root 有效性逻辑各自维护而漂移）
            sendJson(res, 200, { enabled: snapshot().enabled })
            return
          }
          if (pathname === '/claude/launch' && req.method === 'GET') {
            const result = spawnClaude()
            sendJson(res, result.ok ? 200 : 500, result)
            return
          }
          // 其他 /claude/* 路径返回 404
          if (reqUrl.startsWith('/claude/')) {
            sendJson(res, 404, { error: 'not found' })
            return
          }

          next()
        })().catch((err) => {
          if (!res.headersSent) sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        })
      })

      // TodayOps dev server 退出时连带收掉拉起的子进程树，避免孤儿 dev server。
      // 'exit' 不覆盖 SIGKILL/崩溃；补 SIGINT/SIGTERM 让 Ctrl+C / 信号终止也能清理
      // （处理后主动 exit，交给 Vite 其余收尾）。handler 幂等 + 一次性，防 server 重启叠加。
      let cleaned = false
      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        clearTimeout(warmTimer)
        for (const [, st] of states) killTree(st)
        states.clear()
        // Claude 是独立终端窗口，用户自己管理，TodayOps 退出不强制关闭
      }
      process.on('exit', cleanup)
      process.once('SIGINT', () => { cleanup(); process.exit(0) })
      process.once('SIGTERM', () => { cleanup(); process.exit(0) })
    },
  }
}
