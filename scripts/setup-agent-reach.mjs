#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const root = process.cwd()
const isMac = process.platform === 'darwin'
const localBin = path.join(os.homedir(), '.local', 'bin')
const brewBin = process.arch === 'arm64' ? '/opt/homebrew/bin' : '/usr/local/bin'
const env = {
  ...process.env,
  PATH: [localBin, brewBin, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    cwd: root,
    env,
    encoding: 'utf-8',
    stdio: options.stdio || 'pipe',
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

function python312Path() {
  const candidates = [
    '/opt/homebrew/bin/python3.12',
    '/usr/local/bin/python3.12',
    'python3.12',
  ]
  for (const c of candidates) {
    if (has(c, ['--version'])) return c
  }
  return ''
}

function ensureHomebrewBasics() {
  if (!isMac) return false
  if (!has('brew', ['--version'])) return false
  const py = python312Path()
  const pipx = has('pipx', ['--version'])
  if (py && pipx) return true

  log('安装基础环境')
  console.log('  需要 Python 3.12 和 pipx。检测到 macOS + Homebrew，开始安装缺失项。')
  const args = ['install']
  if (!py) args.push('python@3.12')
  if (!pipx) args.push('pipx')
  const r = run('brew', args, { stdio: 'inherit' })
  return r.status === 0
}

function ensurePipxPath() {
  if (!has('pipx', ['--version'])) return false
  const r = run('pipx', ['ensurepath'])
  if (r.status === 0 || /already in PATH|ready to go/i.test(r.stdout + r.stderr)) return true
  return false
}

function ensureAgentReach() {
  if (has('agent-reach', ['--version'])) return true
  const py = python312Path()
  if (!py) return false
  log('安装 Agent Reach')
  const r = run('pipx', [
    'install',
    '--python',
    py,
    'https://github.com/Panniantong/agent-reach/archive/main.zip',
  ], { stdio: 'inherit' })
  return r.status === 0
}

function ensureTool(cmd, pipxPackage) {
  if (has(cmd, ['--version'])) return true
  const r = run('pipx', ['install', pipxPackage], { stdio: 'inherit' })
  return r.status === 0
}

function ensureYtDlpConfig() {
  const dir = path.join(os.homedir(), 'Library', 'Application Support', 'yt-dlp')
  const file = path.join(dir, 'config')
  if (process.platform !== 'darwin') return
  const shell = [
    `mkdir -p ${JSON.stringify(dir)}`,
    `grep -qxF -- '--js-runtimes node' ${JSON.stringify(file)} 2>/dev/null || printf '%s\\n' '--js-runtimes node' >> ${JSON.stringify(file)}`,
  ].join(' && ')
  run('sh', ['-c', shell])
}

function envEnabled() {
  const file = path.join(root, '.env')
  if (!existsSync(file)) return false
  return /^VITE_AGENT_REACH_ENABLED\s*=\s*true\s*$/m.test(readFileSync(file, 'utf-8'))
}

console.log('TodayOps Agent Reach setup')
console.log('================================')
console.log('这个脚本安装/检查本机只读外部调研能力；不属于 npm install 的前端依赖。')

ensureHomebrewBasics()
ensurePipxPath()

log('基础检查')
const py = python312Path()
if (py) ok(`Python 3.12: ${firstLine(run(py, ['--version']).stdout || run(py, ['--version']).stderr)}`)
else fail('缺少 Python 3.12。macOS 可运行：brew install python@3.12')

const pipx = commandOutput('pipx')
if (pipx.ok) ok(`pipx: ${pipx.text}`)
else fail('缺少 pipx。macOS 可运行：brew install pipx')

if (py && pipx.ok && ensureAgentReach()) ok(`agent-reach: ${commandOutput('agent-reach').text}`)
else fail('agent-reach 未安装成功')

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
if (has('agent-reach', ['--version'])) {
  const r = run('agent-reach', ['install', '--env=auto'], { stdio: 'inherit' })
  if (r.status !== 0) warn('agent-reach install 未完全成功，请查看上方输出')
}

log('项目配置')
if (envEnabled()) ok('.env 已启用 VITE_AGENT_REACH_ENABLED=true')
else warn('请在 .env 加上：VITE_AGENT_REACH_ENABLED=true，然后重启 npm run dev')

log('最终体检')
if (has('agent-reach', ['--version'])) {
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
}

console.log('\n完成。启动/重启 dev server 后，可问小吴：检查一下外部调研能力是否可用。')
