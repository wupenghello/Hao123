/**
 * 知识库 · 本地源 Vite 插件
 *
 * 浏览器无法直接读取本地磁盘的任意文件夹（安全沙箱），故由 Vite 的 dev server
 * （Node 进程）在 dev / 构建时读取 env 指定的本地文件夹，把文档以「虚拟模块」形式
 * 注入到前端包：
 *   - dev：import 'virtual:kb-docs' 即拿到文档；改文档后刷新页面生效（插件已声明
 *     文件依赖，Vite 会在 .md 变化时失效虚拟模块并触发热更新）
 *   - 生产构建：文档随构建打进包，部署后无需文件系统
 *
 * 仅当 VITE_KB_SOURCE 为「本地路径」时插件读取文件系统；为「http URL」时插件注入
 * 空数组（前端改走 fetch 远程 manifest，见 source.ts）。
 *
 * env 路径写法：Windows 建议用正斜杠，如 D:/projects/todayops-kb
 *   （反斜杠在 .env / dotenv 解析中可能被当作转义符，正斜杠最稳妥）。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { isHttpSource } from './src/features/kb/shared'
import { docTitle } from './src/features/kb/chunker'

const VIRTUAL_ID = 'virtual:kb-docs'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/**
 * 递归读取文件夹下全部 .md 文档，解析标题（首个 # 一级标题）。
 * 遍历子目录（Obsidian 等笔记库普遍按文件夹分类存放，顶层往往没有 .md），
 * 但跳过隐藏目录（.obsidian / .trash / .git 等是配置/回收站，非知识内容）
 * 与不可读文件，不因单个坏文件拖垮整个知识库。
 *
 * 类型判定用 fs.statSync（跟随符号链接），使链接进来的子目录 / .md 也能被收录
 * （云同步、共享笔记常用 symlink / junction 接入）；并用 realpath 集合防环，
 * 避免链接回指祖先造成无限递归。
 * 目录不存在时返回 null，由调用方决定是报错还是降级为空。
 */
function readLocalDir(dir: string): { doc: string; title: string; content: string }[] | null {
  if (!dir || !fs.existsSync(dir)) return null
  const out: { doc: string; title: string; content: string }[] = []
  const visited = new Set<string>()

  const walk = (folder: string) => {
    // 用真实路径防环（symlink / junction 回指祖先时不再二次下钻）
    let real: string
    try {
      real = fs.realpathSync(folder)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      // 跳过隐藏项（.obsidian / .trash / .DS_Store 等）
      if (ent.name.startsWith('.')) continue
      const full = path.join(folder, ent.name)
      // statSync 跟随符号链接判定真实类型；Dirent 的 isDirectory/isFile
      // 对 symlink 返回 false，会让链接进来的目录/文件被静默丢弃。
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full)
        continue
      }
      if (!stat.isFile() || !/\.md$/i.test(ent.name)) continue
      let raw: string
      try {
        raw = fs.readFileSync(full, 'utf-8')
      } catch {
        continue
      }
      // doc 用相对根目录的路径（POSIX 斜杠、去扩展名）：既保证跨子目录唯一，
      // 也把分类（如 06-环境入口）带进标识，回传给 LLM 时更有上下文。
      const rel = path.relative(dir, full).replace(/\\/g, '/').replace(/\.md$/i, '')
      out.push({ doc: rel, title: docTitle(raw, rel), content: raw })
    }
  }

  walk(dir)
  return out
}

/**
 * 知识库本地源插件。
 * @param source VITE_KB_SOURCE 的值（本地路径 或 http URL）
 */
export function kbPlugin(source: string): Plugin {
  const isLocal = !!source && !isHttpSource(source)
  const dir = isLocal ? path.resolve(source) : ''

  return {
    name: 'kb-local-source',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      // 远程源：本地虚拟模块注入空数组，由 source.ts 运行时 fetch
      if (!isLocal) return `export const docs = [];`

      const docs = readLocalDir(dir)
      if (docs === null) {
        // 本地源目录不存在：构建/启动时直接报错，避免静默打包成空知识库
        throw new Error(`[kb] 知识库目录不存在：${dir}（请检查 .env 的 VITE_KB_SOURCE）`)
      }
      return `export const docs = ${JSON.stringify(docs)};`
    },
    // 声明本地 .md 文件为虚拟模块的依赖：dev 下文件变化时失效缓存并热更新，
    // 使「改文档后刷新页面即生效」真正成立（虚拟模块本身不在模块图里，需手动声明）。
    configureServer(server) {
      if (!isLocal || !dir || !fs.existsSync(dir)) return
      server.watcher.add(dir)
      // 仅 .md 且不在隐藏目录（.obsidian / .trash 等）下才触发重载，
      // 与 readLocalDir 的收录口径保持一致。
      // change/add/unlink 都要管：新增或删除 .md 也需让虚拟模块失效，否则
      // 递归收录的新文档不生效（用户得手动刷新，甚至读到模块图里的旧缓存）。
      const reloadIfKb = (file: string) => {
        const rel = path.relative(dir, file).replace(/\\/g, '/')
        if (!rel || rel.split('/').some((seg) => seg.startsWith('.')) || !/\.md$/i.test(file)) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: 'full-reload' })
        }
      }
      server.watcher.on('change', reloadIfKb)
      server.watcher.on('add', reloadIfKb)
      server.watcher.on('unlink', reloadIfKb)
    },
  }
}
