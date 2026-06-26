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
 * env 路径写法：Windows 建议用正斜杠，如 D:/projects/hao123-kb
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
 * 读取本地文件夹下全部 .md 文档，解析标题（首个 # 一级标题）。
 * 跳过子目录与不可读文件（不因单个坏文件拖垮整个知识库）。
 * 目录不存在时返回 null，由调用方决定是报错还是降级为空。
 */
function readLocalDir(dir: string): { doc: string; title: string; content: string }[] | null {
  if (!dir || !fs.existsSync(dir)) return null
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((f) => /\.md$/i.test(f))
    .flatMap((f) => {
      const full = path.join(dir, f)
      // 跳过子目录（如 .md 结尾的文件夹）与不可读文件，避免 EISDIR/EACCES 中断
      let stat
      try {
        stat = fs.statSync(full)
      } catch {
        return []
      }
      if (!stat.isFile()) return []
      let raw: string
      try {
        raw = fs.readFileSync(full, 'utf-8')
      } catch {
        return []
      }
      const doc = f.replace(/\.md$/i, '')
      return { doc, title: docTitle(raw, doc), content: raw }
    })
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
      server.watcher.on('change', (file) => {
        if (file && path.resolve(file).startsWith(dir) && /\.md$/i.test(file)) {
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
          if (mod) {
            server.moduleGraph.invalidateModule(mod)
            server.ws.send({ type: 'full-reload' })
          }
        }
      })
    },
  }
}
