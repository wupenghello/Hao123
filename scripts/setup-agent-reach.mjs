#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const root = process.cwd()
const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'
const localBin = path.join(os.homedir(), '.local', 'bin')

// 把可能装了 CLI 但还没进当前 shell PATH 的目录提前，便于同一次运行里就找到刚装好的可执行。
const extraPath = [localBin]
if (isMac) {
  extraPath.push(process.arch === 'arm64' ? '/opt/homebrew/bin' : '/usr/local/bin')
}
if (isWindows) {
  // Python --user 安装的脚本目录（pipx 等）
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  extraPath.push(path.join(appdata, 'Python', 'Scripts'))
}
const env = {
  ...process.env,
  PATH: [...extraPath, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
}

function run(cmd, args, options = {}) {
  // Windows 上某些命令（如 .cmd / .bat / pipx 入口）需要 shell 解析；其余保持 shell:false 更稳。
  const needsShell = isWindows && /\.(cmd|bat)$/i.test(cmd)
  return spawnSync(cmd, args, {
    cwd: root,
    env,
    encoding: 'utf-8',
    stdio: options.stdio || 'pipe',
    shell: needsShell || undefined,
  })
}

function has(cmd, args = ['--version']) {
  const r = run(cmd, args)
  return r.status === 0
}

function firstLine(value) {
  return String(value || '').trim().split('\n')[0] || ''
}

function log(title) {
  console.log(`\n${title}`)
}

function ok(text) {
  console.log(`  [OK] ${text}`)
}

function warn(text) {
  console.log(`  [!] ${text}`)
}

function fail(text) {
  console.log(`  [X] ${text}`)
}

function commandOutput(cmd, args = ['--version']) {
  const r = run(cmd, args)
  return { ok: r.status === 0, text: firstLine(r.stdout || r.stderr), stderr: r.stderr }
}

// 解析「Python 3.12」的调用方式，返回 { cmd, pre }：
//   Windows：优先官方启动器 `py -3.12`，否则 `python3.12` / `python`
//   macOS / Linux：优先 `python3.12`，再试 Homebrew 路径
// 这样后续 `run(py.cmd, [...py.pre, ...])` 即可跨平台调用 3.12。
function python312() {
  const candidates = isWindows
    ? [['py', '-3.12'], ['python3.12'], ['python']]
    : [
        ['python3.12'],
        ['/opt/homebrew/bin/python3.12'],
        ['/usr/local/bin/python3.12'],
        ['python3'],
      ]
  for (const [cmd, ...pre] of candidates) {
    if (has(cmd, [...pre, '--version'])) return { cmd, pre }
  }
  return null
}

function python312Version() {
  const py = python312()
  if (!py) return ''
  const r = run(py.cmd, [...py.pre, '--version'])
  return firstLine(r.stdout || r.stderr)
}

// 返回 pipx 的调用前缀（{ cmd, pre }），统一走 `-m pipx`：
//   1) 不依赖 pipx 的可执行脚本是否在 PATH 上（Windows 上 `pip install --user pipx` 后常不在）
//   2) 自动复用上面定位到的 Python 3.12，venv 里就是 3.12，不用再传 `--python`
function pipxRunner() {
  const py = python312()
  if (!py) return null
  if (has(py.cmd, [...py.pre, '-m', 'pipx', '--version'])) {
    return { cmd: py.cmd, pre: [...py.pre, '-m', 'pipx'] }
  }
  return null
}

function ensureHomebrewBasics() {
  if (!isMac) return false
  if (!has('brew', ['--version'])) return false
  const py = python312()
  const pipx = !!pipxRunner()
  if (py && pipx) return true

  log('安装基础环境')
  console.log('  需要 Python 3.12 和 pipx。检测到 macOS + Homebrew，开始安装缺失项。')
  const args = ['install']
  if (!py) args.push('python@3.12')
  if (!pipx) args.push('pipx')
  const r = run('brew', args, { stdio: 'inherit' })
  return r.status === 0
}

// Windows / Linux 上没有 Homebrew，pipx 通过 `python -m pip install --user pipx` 装。
function ensurePipxInstalled() {
  if (pipxRunner()) return true
  const py = python312()
  if (!py) return false
  log('安装 pipx')
  console.log(`  使用 ${py.cmd} ${py.pre.join(' ')} -m pip install --user pipx`)
  const r = run(py.cmd, [...py.pre, '-m', 'pip', 'install', '--user', 'pipx'], {
    stdio: 'inherit',
  })
  if (r.status !== 0) return false
  // 让 pipx 把自己的 bin 目录加进用户 PATH（影响的是之后的 shell，本次运行靠 extraPath 兜底）。
  const runner = pipxRunner()
  if (runner) run(runner.cmd, [...runner.pre, 'ensurepath'])
  return !!pipxRunner()
}

function ensurePipxPath() {
  const runner = pipxRunner()
  if (!runner) return false
  const r = run(runner.cmd, [...runner.pre, 'ensurepath'])
  if (r.status === 0 || /already in PATH|ready to go/i.test(r.stdout + r.stderr)) return true
  return false
}

function ensureAgentReach() {
  if (has('agent-reach', ['--version'])) return true
  const runner = pipxRunner()
  if (!runner) return false
  log('安装 Agent Reach')
  const r = run(
    runner.cmd,
    [...runner.pre, 'install', 'https://github.com/Panniantong/agent-reach/archive/main.zip'],
    { stdio: 'inherit' },
  )
  return r.status === 0
}

function ensureTool(cmd, pipxPackage) {
  if (has(cmd, ['--version'])) return true
  const runner = pipxRunner()
  if (!runner) return false
  run(runner.cmd, [...runner.pre, 'install', pipxPackage], { stdio: 'inherit' })
  if (has(cmd, ['--version'])) return true
  // pipx 对「venv 已存在」会报 "already seems to be installed" 并退出 0，
  // 但若上次安装被中断，exe shim 可能并未生成 —— 复查 has() 失败就 force 重装。
  warn(`${cmd} 安装后仍不可用，可能是上次中断留下的残壳 venv，强制重装…`)
  run(runner.cmd, [...runner.pre, 'install', '--force', pipxPackage], { stdio: 'inherit' })
  if (has(cmd, ['--version'])) return true
  // metadata 损坏时 pipx uninstall/reinstall 都会失败（"cannot find package metadata"），
  // 直接删 venv 目录后重装（pipx 默认 PIPX_HOME：Windows=~/pipx，POSIX=~/.local/pipx）。
  warn(`${cmd} force 重装仍失败，清理 venv 目录后重装…`)
  const pipxHome = process.env.PIPX_HOME || path.join(os.homedir(), isWindows ? 'pipx' : '.local', 'pipx')
  const venvDir = path.join(pipxHome, 'venvs', pipxPackage)
  try {
    rmSync(venvDir, { recursive: true, force: true })
  } catch (e) {
    warn(`清理 ${venvDir} 失败：${e.message}`)
  }
  run(runner.cmd, [...runner.pre, 'install', pipxPackage], { stdio: 'inherit' })
  return has(cmd, ['--version'])
}

// 跨平台写入 yt-dlp 的 `--js-runtimes node` 配置（用 fs，不再依赖 sh/grep/printf）。
// 配置目录按 yt-dlp 官方约定：Mac 用 ~/Library/Application Support/yt-dlp，
// Windows 用 %APPDATA%/yt-dlp，Linux 用 $XDG_CONFIG_HOME/yt-dlp。
function ensureYtDlpConfig() {
  let dir
  if (isMac) {
    dir = path.join(os.homedir(), 'Library', 'Application Support', 'yt-dlp')
  } else if (isWindows) {
    dir = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'yt-dlp',
    )
  } else {
    dir = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
      'yt-dlp',
    )
  }
  const file = path.join(dir, 'config')
  try {
    mkdirSync(dir, { recursive: true })
    const FLAG = '--js-runtimes node'
    const existing = existsSync(file) ? readFileSync(file, 'utf-8').split(/\r?\n/) : []
    if (existing.includes(FLAG)) return
    const next = [...existing.filter((l) => l.trim() !== ''), FLAG].join('\n') + '\n'
    writeFileSync(file, next, { encoding: 'utf-8' })
  } catch (e) {
    warn(`写入 yt-dlp 配置失败（${file}）：${e.message}`)
  }
}

function envEnabled() {
  const file = path.join(root, '.env')
  if (!existsSync(file)) return false
  return /^VITE_AGENT_REACH_ENABLED\s*=\s*true\s*$/m.test(readFileSync(file, 'utf-8'))
}

console.log('TodayOps Agent Reach setup')
console.log('================================')
console.log('这个脚本安装/检查本机只读外部调研能力；不属于 npm install 的前端依赖。')
console.log(`平台：${process.platform}（${isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux'}）`)

ensureHomebrewBasics()
if (!isMac) ensurePipxInstalled()
ensurePipxPath()

log('基础检查')
const pyVer = python312Version()
if (pyVer) ok(`Python 3.12: ${pyVer}`)
else fail(
  '缺少 Python 3.12。Windows 推荐：winget install Python.Python.3.12 或从 python.org 安装；macOS：brew install python@3.12',
)

const pipx = (() => {
  const runner = pipxRunner()
  if (runner) return commandOutput(runner.cmd, [...runner.pre, '--version'])
  return { ok: false, text: '', stderr: '' }
})()
if (pipx.ok) ok(`pipx: ${pipx.text}`)
else fail('缺少 pipx。Windows：py -3.12 -m pip install --user pipx；macOS：brew install pipx')

if (pyVer && pipx.ok && ensureAgentReach()) {
  const ar = commandOutput('agent-reach')
  if (ar.ok) ok(`agent-reach: ${ar.text}`)
  else ok('agent-reach: 已安装（--version 无输出，可能需要重启 shell 让 PATH 生效）')
} else {
  fail('agent-reach 未安装成功')
}

log('安装/检查第一期上游工具')
if (ensureTool('yt-dlp', 'yt-dlp')) ok(`yt-dlp: ${commandOutput('yt-dlp').text}`)
else fail('yt-dlp 未安装成功')

if (ensureTool('bili', 'bilibili-cli')) ok(`bili: ${commandOutput('bili').text}`)
else fail('bili 未安装成功')

const gh = commandOutput('gh')
if (gh.ok) ok(`gh: ${gh.text}`)
else warn('gh 未安装；公开 GitHub 仓库分析仍可用，私有仓库能力需要 gh auth login')

ensureYtDlpConfig()

log('运行 Agent Reach 基础安装')
if (has('agent-reach', ['--version']) || has('agent-reach', ['--help'])) {
  const r = run('agent-reach', ['install', '--env=auto'], { stdio: 'inherit' })
  if (r.status !== 0) warn('agent-reach install 未完全成功，请查看上方输出')
} else {
  warn('agent-reach 未在 PATH 上；请重开终端后再运行一次本脚本以完成 agent-reach install')
}

log('项目配置')
if (envEnabled()) ok('.env 已启用 VITE_AGENT_REACH_ENABLED=true')
else warn('请在 .env 加上：VITE_AGENT_REACH_ENABLED=true，然后重启 npm run dev')

log('最终体检')
if (has('agent-reach', ['--version']) || has('agent-reach', ['--help'])) {
  const r = run('agent-reach', ['doctor', '--json'])
  if (r.status === 0) {
    const data = JSON.parse(r.stdout)
    for (const key of ['web', 'exa_search', 'youtube', 'bilibili', 'github']) {
      const item = data[key]
      const status = item?.status === 'ok' ? '[OK]' : item?.status === 'warn' ? '[!]' : '[X]'
      console.log(`  ${status} ${key}: ${item?.message || 'unknown'}`)
    }
  } else {
    warn('agent-reach doctor 执行失败')
  }
} else {
  warn('agent-reach 暂未在 PATH 上，跳过体检。重开终端后再跑一次 npm run setup:reach')
}

console.log('\n完成。启动/重启 dev server 后，可问小吴：检查一下外部调研能力是否可用。')
