/**
 * 知识库 / RAG · 本地优先 Vite 插件
 *
 * 这个插件同时提供两层能力：
 *   1. 构建兼容层：继续注入 virtual:kb-docs，让生产静态包仍可用旧的浏览器内检索；
 *   2. dev RAG 服务：提供 /rag/search /rag/health /rag/reindex /rag/eval，把入库、
 *      解析、脱敏、切片、混合检索、引用溯源放在 Node 侧完成。
 *
 * 二进制文件（PDF / 图片 / Office）默认收录元数据，并优先读取 sidecar 文本：
 *   - foo.pdf.md / foo.pdf.txt / foo.ocr.txt / foo.summary.md
 * 后续接入 pdf-parse、OCR、Office parser 时，只需替换 parseBinaryLikeFile。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { isHttpSource } from './src/features/kb/shared'
import { docTitle } from './src/features/kb/chunker'
import type {
  KbChunk,
  KbDocMeta,
  KbHealthIssue,
  KbHealthResponse,
  KbSearchHit,
  KbSearchResponse,
  KbSourceType,
  RawDoc,
} from './src/features/kb/types'

const VIRTUAL_ID = 'virtual:kb-docs'
const RESOLVED_ID = '\0' + VIRTUAL_ID

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TEXT_CHARS = 600_000
const MAX_CHUNK_CHARS = 1800
const CHUNK_OVERLAP_CHARS = 180
const DEFAULT_TOP_K = 5
const MAX_TOP_K = 12

const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.obsidian',
  '.trash',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'coverage',
])

const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdx'])
const TEXT_EXT = new Set([
  '.txt',
  '.log',
  '.yaml',
  '.yml',
  '.ini',
  '.conf',
  '.config',
  '.sql',
  '.xml',
])
const HTML_EXT = new Set(['.html', '.htm'])
const JSON_EXT = new Set(['.json'])
const CSV_EXT = new Set(['.csv', '.tsv'])
const CODE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.css',
  '.scss',
  '.less',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.py',
  '.rb',
  '.php',
  '.cs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.sh',
  '.ps1',
  '.bat',
])
const PDF_EXT = new Set(['.pdf'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff'])
const OFFICE_EXT = new Set(['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'])

const SECRET_PATTERNS: { re: RegExp; replacement: string }[] = [
  {
    re: /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd|authorization|cookie)\s*[:=]\s*)(["']?)[^\s"'`]+/gi,
    replacement: '$1$2[REDACTED]',
  },
  { re: /\b(bearer\s+)[a-z0-9._~+/=-]{12,}/gi, replacement: '$1[REDACTED]' },
  { re: /(https?:\/\/)([^:\s/@]+):([^@\s/]+)@/gi, replacement: '$1[REDACTED]@' },
]

interface LocalDocResult {
  docs: RawDoc[]
  warnings: KbHealthIssue[]
  errors: KbHealthIssue[]
  parserCoverage: Record<string, number>
}

interface IndexedChunk extends KbSearchHit {
  tokenFreq: Map<string, number>
  vector: Map<string, number>
  norm: number
  keywordText: string
}

interface RagIndex extends LocalDocResult {
  source: string
  mode: 'local'
  chunks: IndexedChunk[]
  indexedAt: string
  idf: Map<string, number>
}

interface FrontmatterResult {
  body: string
  meta: Partial<KbDocMeta>
}

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function hashText(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

function stripExt(rel: string): string {
  return rel.replace(/\.[^.\/\\]+$/i, '')
}

function isHiddenRel(rel: string): boolean {
  return toPosix(rel).split('/').some((seg) => seg.startsWith('.') && seg !== '.')
}

function sourceTypeOf(file: string): KbSourceType | null {
  const ext = path.extname(file).toLowerCase()
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  if (TEXT_EXT.has(ext)) return 'text'
  if (HTML_EXT.has(ext)) return 'html'
  if (JSON_EXT.has(ext)) return 'json'
  if (CSV_EXT.has(ext)) return 'csv'
  if (CODE_EXT.has(ext)) return 'code'
  if (PDF_EXT.has(ext)) return 'pdf'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (OFFICE_EXT.has(ext)) return 'office'
  return null
}

function mimeTypeOf(file: string): string {
  const ext = path.extname(file).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.markdown': 'text/markdown; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
  }
  return map[ext] || 'application/octet-stream'
}

function isTextLike(type: KbSourceType): boolean {
  return ['markdown', 'text', 'html', 'json', 'csv', 'code'].includes(type)
}

function isBinaryLike(type: KbSourceType): boolean {
  return ['pdf', 'image', 'office', 'binary'].includes(type)
}

async function readTextFile(file: string): Promise<string> {
  const raw = await fsp.readFile(file, 'utf-8')
  return raw.length > MAX_TEXT_CHARS ? raw.slice(0, MAX_TEXT_CHARS) : raw
}

function parseScalar(value: string): string | string[] {
  const v = value.trim()
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  }
  return v.replace(/^['"]|['"]$/g, '')
}

function parseFrontmatter(raw: string): FrontmatterResult {
  if (!raw.startsWith('---')) return { body: raw, meta: {} }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return { body: raw, meta: {} }
  const fm = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  const meta: Record<string, string | string[]> = {}
  let listKey = ''

  for (const line of fm.split(/\r?\n/)) {
    const list = line.match(/^\s*-\s+(.+)$/)
    if (list && listKey) {
      const cur = Array.isArray(meta[listKey]) ? meta[listKey] as string[] : []
      cur.push(String(parseScalar(list[1])))
      meta[listKey] = cur
      continue
    }
    const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/)
    if (!m) continue
    listKey = m[1]
    meta[listKey] = parseScalar(m[2])
  }

  return {
    body,
    meta: {
      tags: asStringArray(meta.tags),
      aliases: asStringArray(meta.aliases),
      owner: asString(meta.owner),
      lastReviewedAt: asString(meta.lastReviewedAt || meta.reviewedAt),
    },
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return v.split(',').map((x) => x.trim()).filter(Boolean)
  return undefined
}

function uniqueStrings(...groups: Array<string[] | undefined>): string[] | undefined {
  const out = Array.from(new Set(groups.flatMap((g) => g ?? []).map((s) => s.trim()).filter(Boolean)))
  return out.length ? out : undefined
}

function implicitAliases(rel: string): string[] {
  const p = rel.toLowerCase()
  const aliases: string[] = []
  if (rel.includes('环境入口') || /(^|\/)(dev|test|pre|prod)(\.|\/|$)/i.test(rel)) {
    aliases.push('环境地址', '环境域名', '环境入口', '开发环境', '测试环境', '预发环境', '生产环境')
  }
  if (rel.includes('发包') || rel.includes('部署') || rel.includes('发布')) {
    aliases.push('部署流程', '发布流程', '发包流程')
  }
  if (rel.includes('常用链接') || rel.includes('链接')) aliases.push('常用链接', '链接地址')
  if (p.includes('faq') || rel.includes('问题')) aliases.push('常见问题', 'FAQ', '排查记录')
  return aliases
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function stripHtml(raw: string): string {
  return decodeHtmlEntities(
    raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
      .replace(/<\/(h[1-6]|p|div|li|tr|section|article)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' '),
  )
}

function redact(raw: string): { content: string; redacted: boolean } {
  let content = raw
  let redacted = false
  for (const p of SECRET_PATTERNS) {
    const next = content.replace(p.re, p.replacement)
    if (next !== content) redacted = true
    content = next
  }
  return { content, redacted }
}

function sidecarCandidatesFor(file: string): string[] {
  const ext = path.extname(file)
  const base = file.slice(0, -ext.length)
  return [
    `${file}.md`,
    `${file}.txt`,
    `${base}.ocr.txt`,
    `${base}.summary.md`,
    `${base}.summary.txt`,
  ]
}

async function findSidecar(file: string): Promise<{ content: string; label: string } | null> {
  const candidates = sidecarCandidatesFor(file)
  for (const c of candidates) {
    try {
      const stat = await fsp.stat(c)
      if (stat.isFile()) return { content: await readTextFile(c), label: path.basename(c) }
    } catch {
      // try next candidate
    }
  }
  return null
}

function isSidecarOfBinary(file: string): boolean {
  const candidates = new Set<string>()
  const ext = path.extname(file)
  if (ext === '.md' || ext === '.txt') {
    const withoutSidecarExt = file.slice(0, -ext.length)
    const directType = sourceTypeOf(withoutSidecarExt)
    if (directType && isBinaryLike(directType) && fs.existsSync(withoutSidecarExt)) return true
  }

  for (const binaryExt of [...PDF_EXT, ...IMAGE_EXT, ...OFFICE_EXT]) {
    candidates.add(file.replace(/\.ocr\.txt$/i, binaryExt))
    candidates.add(file.replace(/\.summary\.(?:md|txt)$/i, binaryExt))
  }
  for (const candidate of candidates) {
    const type = sourceTypeOf(candidate)
    if (type && isBinaryLike(type) && fs.existsSync(candidate)) return true
  }
  return false
}

async function parseTextLikeFile(file: string, rel: string, type: KbSourceType, stat: fs.Stats): Promise<RawDoc> {
  const raw = await readTextFile(file)
  const parsed = type === 'markdown' ? parseFrontmatter(raw) : { body: raw, meta: {} }
  let content = parsed.body

  if (type === 'html') content = stripHtml(content)
  if (type === 'json') {
    try {
      content = JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      // keep raw JSON-ish text
    }
  }

  const redacted = redact(content)
  const doc = stripExt(rel)
  const title = type === 'markdown' ? docTitle(redacted.content, doc) : doc

  return {
    doc,
    title,
    content: redacted.content,
    sourceType: type,
    metadata: {
      ...parsed.meta,
      aliases: uniqueStrings(parsed.meta.aliases, implicitAliases(rel)),
      path: rel,
      sourceType: type,
      mimeType: mimeTypeOf(file),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      redacted: redacted.redacted,
    },
  }
}

async function parseBinaryLikeFile(file: string, rel: string, type: KbSourceType, stat: fs.Stats): Promise<{ doc: RawDoc; warning?: KbHealthIssue }> {
  const sidecar = await findSidecar(file)
  const doc = stripExt(rel)
  const baseTitle = doc

  if (sidecar) {
    const fm = parseFrontmatter(sidecar.content)
    const redacted = redact(fm.body)
    return {
      doc: {
        doc,
        title: docTitle(redacted.content, baseTitle),
        content: redacted.content,
        sourceType: type,
        metadata: {
          ...fm.meta,
          aliases: uniqueStrings(fm.meta.aliases, implicitAliases(rel)),
          path: rel,
          sourceType: type,
          mimeType: mimeTypeOf(file),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          redacted: redacted.redacted,
          warnings: [`使用 sidecar 文本入库：${sidecar.label}`],
        },
      },
    }
  }

  const title = baseTitle
  const typeLabel: Record<KbSourceType, string> = {
    markdown: 'Markdown',
    text: 'Text',
    html: 'HTML',
    json: 'JSON',
    csv: 'CSV',
    code: 'Code',
    pdf: 'PDF',
    image: 'Image',
    office: 'Office',
    binary: 'Binary',
  }
  const warning = `已收录 ${typeLabel[type]} 文件元数据，但未发现 sidecar 文本；如需内容检索，请提供 ${path.basename(file)}.md / .txt / .ocr.txt / .summary.md`
  return {
    doc: {
      doc,
      title,
      content: [
        `# ${title}`,
        '',
        '## 文件已收录但尚未解析正文',
        `文件路径：${rel}`,
        `文件类型：${typeLabel[type]}`,
        `文件大小：${stat.size} bytes`,
        warning,
      ].join('\n'),
      sourceType: type,
      metadata: {
        aliases: uniqueStrings(undefined, implicitAliases(rel)),
        path: rel,
        sourceType: type,
        mimeType: mimeTypeOf(file),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        warnings: [warning],
      },
    },
    warning: { level: 'warn', message: warning, doc },
  }
}

async function parseFile(file: string, rel: string, stat: fs.Stats): Promise<{ doc?: RawDoc; warning?: KbHealthIssue; error?: KbHealthIssue }> {
  const type = sourceTypeOf(file)
  if (!type) return {}
  if (stat.size > MAX_FILE_BYTES && isTextLike(type)) {
    return {
      warning: {
        level: 'warn',
        message: `文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB，已跳过：${rel}`,
        doc: stripExt(rel),
      },
    }
  }

  try {
    if (isTextLike(type)) return { doc: await parseTextLikeFile(file, rel, type, stat) }
    return await parseBinaryLikeFile(file, rel, type, stat)
  } catch (e) {
    return {
      error: {
        level: 'error',
        message: `解析失败：${rel}：${e instanceof Error ? e.message : String(e)}`,
        doc: stripExt(rel),
      },
    }
  }
}

async function loadIgnorePatterns(root: string): Promise<string[]> {
  try {
    const raw = await fsp.readFile(path.join(root, '.kbignore'), 'utf-8')
    return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  } catch {
    return []
  }
}

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`(^|/)${escaped}($|/)`, 'i')
}

function ignored(rel: string, patterns: string[]): boolean {
  const p = toPosix(rel)
  return patterns.some((pattern) => {
    if (pattern.endsWith('/')) return p.startsWith(pattern.slice(0, -1))
    if (pattern.includes('*')) return patternToRegExp(pattern).test(p)
    return p === pattern || p.startsWith(`${pattern}/`) || p.includes(`/${pattern}/`)
  })
}

async function readLocalDocs(root: string): Promise<LocalDocResult> {
  const docs: RawDoc[] = []
  const warnings: KbHealthIssue[] = []
  const errors: KbHealthIssue[] = []
  const parserCoverage: Record<string, number> = {}
  const visited = new Set<string>()
  const sidecars = new Set<string>()
  const ignorePatterns = await loadIgnorePatterns(root)

  async function walk(folder: string): Promise<void> {
    let real = ''
    try {
      real = await fsp.realpath(folder)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)

    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(folder, { withFileTypes: true })
    } catch {
      return
    }

    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.name !== '.kbignore') continue
      if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue

      const full = path.join(folder, ent.name)
      const rel = toPosix(path.relative(root, full))
      if (!rel || isHiddenRel(rel) || ignored(rel, ignorePatterns)) continue

      let stat: fs.Stats
      try {
        stat = await fsp.stat(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        await walk(full)
        continue
      }
      if (!stat.isFile()) continue
      if (sidecars.has(full) || isSidecarOfBinary(full)) continue

      const type = sourceTypeOf(full)
      if (type && isBinaryLike(type)) {
        for (const c of sidecarCandidatesFor(full)) sidecars.add(c)
      }

      const result = await parseFile(full, rel, stat)
      if (result.doc) {
        docs.push(result.doc)
        const type = result.doc.sourceType || 'markdown'
        parserCoverage[type] = (parserCoverage[type] || 0) + 1
      }
      if (result.warning) warnings.push(result.warning)
      if (result.error) errors.push(result.error)
    }
  }

  await walk(root)
  return { docs, warnings, errors, parserCoverage }
}

function splitLongContent(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (normalized.length <= MAX_CHUNK_CHARS) return normalized ? [normalized] : []

  const parts: string[] = []
  const paragraphs = normalized.split(/\n{2,}/)
  let buf = ''

  const pushBuf = () => {
    const v = buf.trim()
    if (v) parts.push(v)
    buf = v.length > CHUNK_OVERLAP_CHARS ? v.slice(-CHUNK_OVERLAP_CHARS) : ''
  }

  for (const p of paragraphs) {
    if (p.length > MAX_CHUNK_CHARS) {
      pushBuf()
      for (let i = 0; i < p.length; i += MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS) {
        parts.push(p.slice(i, i + MAX_CHUNK_CHARS).trim())
      }
      buf = ''
      continue
    }
    if ((buf + '\n\n' + p).length > MAX_CHUNK_CHARS) pushBuf()
    buf = buf ? `${buf}\n\n${p}` : p
  }
  pushBuf()
  return parts
}

function chunkRawDoc(doc: RawDoc): KbChunk[] {
  const lines = doc.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const sections: { path: string[]; section: string; content: string; lineStart: number; lineEnd: number }[] = []
  let headingPath: string[] = []
  let buf: string[] = []
  let lineStart = 1

  const flush = (lineEnd: number) => {
    const content = buf.join('\n').trim()
    if (content) {
      const section = headingPath[headingPath.length - 1] || ''
      sections.push({ path: [doc.title, ...headingPath], section, content, lineStart, lineEnd })
    }
    buf = []
    lineStart = lineEnd + 1
  }

  lines.forEach((line, idx) => {
    const lineNo = idx + 1
    const m = line.match(/^(#{1,6})\s+(.+)$/)
    if (m) {
      flush(Math.max(lineNo - 1, lineStart))
      const level = m[1].length
      const title = m[2].trim()
      if (level === 1) {
        headingPath = []
      } else {
        headingPath[level - 2] = title
        headingPath = headingPath.slice(0, level - 1)
      }
      lineStart = lineNo + 1
      return
    }
    buf.push(line)
  })
  flush(lines.length)

  const fallback = sections.length ? sections : [{
    path: [doc.title],
    section: '',
    content: doc.content,
    lineStart: 1,
    lineEnd: lines.length,
  }]

  const chunks: KbChunk[] = []
  for (const s of fallback) {
    splitLongContent(s.content).forEach((content, idx) => {
      const id = hashText(`${doc.doc}:${s.section}:${idx}:${content.slice(0, 120)}`)
      const pathRef = doc.metadata?.path || doc.doc
      const assetUrl = doc.sourceType === 'image' && doc.metadata?.path
        ? `/rag/asset?path=${encodeURIComponent(doc.metadata.path)}`
        : undefined
      chunks.push({
        id,
        doc: doc.doc,
        docTitle: doc.title,
        section: s.section,
        content,
        titlePath: s.path.filter(Boolean),
        sourceType: doc.sourceType || 'markdown',
        citation: {
          label: s.path.filter(Boolean).join(' > ') || doc.title,
          path: pathRef,
          lineStart: s.lineStart,
          lineEnd: s.lineEnd,
        },
        metadata: doc.metadata,
        assetUrl,
        mimeType: doc.metadata?.mimeType,
      })
    })
  }
  return chunks
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  const wordRe = /[a-z0-9][a-z0-9_-]*/g
  let m: RegExpExecArray | null
  while ((m = wordRe.exec(lower))) tokens.push(m[0])

  const cjkRe = /[一-鿿]+/g
  while ((m = cjkRe.exec(lower))) {
    const s = m[0]
    if (s.length === 1) tokens.push(s)
    for (let i = 0; i < s.length - 1; i++) tokens.push(s.slice(i, i + 2))
  }
  return tokens.filter((t) => t.length > 1 || /[一-鿿]/.test(t))
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + 1)
  }
  return count
}

function termFrequency(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1)
  return m
}

function cosine(a: Map<string, number>, aNorm: number, b: Map<string, number>, bNorm: number): number {
  if (!aNorm || !bNorm) return 0
  let dot = 0
  for (const [k, v] of a) dot += v * (b.get(k) || 0)
  return dot / (aNorm * bNorm)
}

function vectorize(tf: Map<string, number>, idf: Map<string, number>): { vector: Map<string, number>; norm: number } {
  const vector = new Map<string, number>()
  let sum = 0
  for (const [t, n] of tf) {
    const weight = (1 + Math.log(n)) * (idf.get(t) || 1)
    vector.set(t, weight)
    sum += weight * weight
  }
  return { vector, norm: Math.sqrt(sum) }
}

function buildIndexFromDocs(root: string, local: LocalDocResult): RagIndex {
  const baseChunks = local.docs.flatMap(chunkRawDoc)
  const chunkTokens = baseChunks.map((c) => {
    const meta = c.metadata
    const keywordText = [
      c.doc,
      c.docTitle,
      c.section,
      c.content,
      meta?.path || '',
      ...(meta?.aliases ?? []),
      ...(meta?.tags ?? []),
      meta?.owner || '',
    ].join('\n')
    return { chunk: c, keywordText, tokens: tokenize(keywordText) }
  })

  const df = new Map<string, number>()
  for (const item of chunkTokens) {
    for (const t of new Set(item.tokens)) df.set(t, (df.get(t) || 0) + 1)
  }
  const idf = new Map<string, number>()
  const total = Math.max(chunkTokens.length, 1)
  for (const [t, n] of df) idf.set(t, Math.log((1 + total) / (1 + n)) + 1)

  const chunks: IndexedChunk[] = chunkTokens.map((item) => {
    const tokenFreq = termFrequency(item.tokens)
    const v = vectorize(tokenFreq, idf)
    return {
      ...item.chunk,
      score: 0,
      confidence: 'low',
      matchedTerms: [],
      highlights: [],
      tokenFreq,
      vector: v.vector,
      norm: v.norm,
      keywordText: item.keywordText.toLowerCase(),
    }
  })

  return {
    ...local,
    source: root,
    mode: 'local',
    chunks,
    indexedAt: new Date().toISOString(),
    idf,
  }
}

function highlights(content: string, tokens: string[]): string[] {
  const out: string[] = []
  for (const line of content.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const lower = line.toLowerCase()
    if (tokens.some((t) => lower.includes(t))) out.push(line.slice(0, 220))
    if (out.length >= 3) break
  }
  if (!out.length && content.trim()) out.push(content.trim().slice(0, 220))
  return out
}

function confidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 18) return 'high'
  if (score >= 7) return 'medium'
  return 'low'
}

function searchIndex(index: RagIndex, query: string, topK: number, type?: string, tag?: string): KbSearchHit[] {
  const q = query.trim().toLowerCase()
  const qTokens = tokenize(q)
  if (!q || !qTokens.length) return []
  const qVec = vectorize(termFrequency(qTokens), index.idf)

  const scored = index.chunks.flatMap((c) => {
    if (type && c.sourceType !== type) return []
    if (tag && !c.metadata?.tags?.some((t) => t.toLowerCase() === tag.toLowerCase())) return []

    const metaLower = [
      c.metadata?.path || '',
      ...(c.metadata?.aliases ?? []),
      ...(c.metadata?.tags ?? []),
      c.metadata?.owner || '',
    ].join(' ').toLowerCase()
    const titleLower = `${c.docTitle} ${c.section}`.toLowerCase()
    const bodyLower = c.content.toLowerCase()
    const matched = qTokens.filter((t) => c.keywordText.includes(t))
    const exact = c.keywordText.includes(q)
    if (!matched.length && !exact) {
      const vectorOnly = cosine(qVec.vector, qVec.norm, c.vector, c.norm)
      if (vectorOnly < 0.08) return []
    }

    let keywordScore = exact ? 10 : 0
    if (metaLower.includes(q)) keywordScore += 12
    if (titleLower.includes(q)) keywordScore += 10
    for (const t of qTokens) {
      if (titleLower.includes(t)) keywordScore += 4
      if (metaLower.includes(t)) keywordScore += 5
      if (c.metadata?.aliases?.some((a) => a.toLowerCase().includes(t))) keywordScore += 6
      if (c.metadata?.tags?.some((tg) => tg.toLowerCase().includes(t))) keywordScore += 5
      keywordScore += Math.min(countOccurrences(bodyLower, t), 3)
    }
    if (matched.length >= 2) keywordScore += 16
    if (matched.length >= 2 && c.content.length <= 240) keywordScore += 4

    const vectorScore = cosine(qVec.vector, qVec.norm, c.vector, c.norm)
    const score = keywordScore + vectorScore * 14
    if (score <= 0) return []

    return [{
      ...c,
      score: Math.round(score * 100) / 100,
      confidence: confidence(score),
      matchedTerms: Array.from(new Set([...matched, exact ? q : ''].filter(Boolean))).slice(0, 10),
      highlights: highlights(c.content, qTokens),
      tokenFreq: undefined,
      vector: undefined,
      norm: undefined,
      keywordText: undefined,
    } as unknown as KbSearchHit]
  })

  const perDoc = new Map<string, number>()
  return scored
    .sort((a, b) => b.score - a.score)
    .filter((hit) => {
      const n = perDoc.get(hit.doc) || 0
      if (n >= Math.max(2, Math.ceil(topK / 2))) return false
      perDoc.set(hit.doc, n + 1)
      return true
    })
    .slice(0, topK)
    .map((hit) => ({
      ...hit,
      metadata: hit.metadata ? { ...hit.metadata, warnings: hit.metadata.warnings?.slice(0, 3) } : undefined,
    }))
}

function healthResponse(source: string, index: RagIndex | null, mode: KbHealthResponse['mode'], backend: KbHealthResponse['backend'], issue?: KbHealthIssue): KbHealthResponse {
  return {
    enabled: !!index,
    source,
    mode,
    backend,
    docCount: index?.docs.length ?? 0,
    chunkCount: index?.chunks.length ?? 0,
    indexedAt: index?.indexedAt,
    parserCoverage: index?.parserCoverage ?? {},
    warnings: [...(index?.warnings ?? []), ...(issue && issue.level === 'warn' ? [issue] : [])],
    errors: [...(index?.errors ?? []), ...(issue && issue.level === 'error' ? [issue] : [])],
  }
}

async function readEvalCases(root: string): Promise<{ query: string; expectedDoc?: string; expectedSection?: string }[]> {
  const file = path.join(root, '.rag-eval.json')
  try {
    const raw = await fsp.readFile(file, 'utf-8')
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter((x) => typeof x?.query === 'string')
  } catch {
    return []
  }
}

async function runEval(root: string, index: RagIndex): Promise<unknown> {
  const cases = await readEvalCases(root)
  const results = cases.map((c) => {
    const hits = searchIndex(index, c.query, 5)
    const pass = hits.some((h) => {
      const docOk = !c.expectedDoc || h.doc.includes(c.expectedDoc)
      const sectionOk = !c.expectedSection || h.section.includes(c.expectedSection)
      return docOk && sectionOk
    })
    return { ...c, pass, top: hits.slice(0, 3).map((h) => ({ doc: h.doc, section: h.section, score: h.score })) }
  })
  const passed = results.filter((r) => r.pass).length
  return { count: cases.length, passed, passRate: cases.length ? passed / cases.length : null, results }
}

function resolveAssetPath(root: string, rel: string): string | null {
  const normalized = toPosix(rel).replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0') || normalized.split('/').includes('..')) return null
  const full = path.resolve(root, normalized)
  const rootResolved = path.resolve(root)
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null
  // /rag/asset 只给聊天视觉上下文读取图片原件；文本/代码/PDF 等内容必须走
  // 已脱敏的索引结果，避免绕过 redact() 直接下载知识库原文件。
  if (sourceTypeOf(full) !== 'image') return null
  return full
}

/**
 * 知识库本地源插件。
 * @param source VITE_KB_SOURCE 的值（本地路径 或 http URL）
 */
export function kbPlugin(source: string): Plugin {
  const isLocal = !!source && !isHttpSource(source)
  const dir = isLocal ? path.resolve(source) : ''
  let indexPromise: Promise<RagIndex> | null = null
  let indexCache: RagIndex | null = null

  const getIndex = async (force = false): Promise<RagIndex> => {
    if (!isLocal || !dir) throw new Error('RAG 本地知识库未启用')
    if (!fs.existsSync(dir)) throw new Error(`[kb] 知识库目录不存在：${dir}（请检查 .env 的 VITE_KB_SOURCE）`)
    if (indexCache && !force) return indexCache
    if (indexPromise && !force) return indexPromise

    indexPromise = readLocalDocs(dir).then((local) => {
      const idx = buildIndexFromDocs(dir, local)
      indexCache = idx
      indexPromise = null
      return idx
    }).catch((e) => {
      indexPromise = null
      throw e
    })
    return indexPromise
  }

  const clearIndex = () => {
    indexPromise = null
    indexCache = null
  }

  return {
    name: 'kb-rag-local-source',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null
      if (!isLocal) return `export const docs = [];`
      if (!fs.existsSync(dir)) {
        throw new Error(`[kb] 知识库目录不存在：${dir}（请检查 .env 的 VITE_KB_SOURCE）`)
      }
      const local = await readLocalDocs(dir)
      return `export const docs = ${JSON.stringify(local.docs)};`
    },
    configureServer(server) {
      if (isLocal && dir && fs.existsSync(dir)) {
        server.watcher.add(dir)
        const reloadIfKb = (file: string) => {
          const rel = toPosix(path.relative(dir, file))
          if (!rel || isHiddenRel(rel) || rel.split('/').some((seg) => SKIP_DIRS.has(seg))) return
          if (!sourceTypeOf(file) && !/(?:\.ocr\.txt|\.summary\.(?:md|txt)|\.(?:pdf|png|jpe?g|webp|gif|docx?|xlsx?|pptx?)\.(?:md|txt))$/i.test(file)) return
          clearIndex()
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
          if (mod) server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: 'full-reload' })
        }
        server.watcher.on('change', reloadIfKb)
        server.watcher.on('add', reloadIfKb)
        server.watcher.on('unlink', reloadIfKb)
      }

      server.middlewares.use(async (req, res, next) => {
        const reqUrl = req.url || ''
        if (!reqUrl.startsWith('/rag/')) return next()

        try {
          const url = new URL(reqUrl, 'http://localhost')
          if (!isLocal) {
            const mode = source ? 'remote' : 'disabled'
            const backend = source ? 'remote' : 'disabled'
            if (url.pathname === '/rag/health') {
              sendJson(res, 200, healthResponse(source, null, mode, backend, {
                level: 'info',
                message: source ? '当前为远程 manifest / 静态回退模式，dev RAG 服务未接管。' : '未配置 VITE_KB_SOURCE。',
              }))
              return
            }
            if (url.pathname === '/rag/search') {
              const q = url.searchParams.get('q') || ''
              sendJson(res, 200, { enabled: false, query: q, count: 0, results: [], backend } satisfies KbSearchResponse)
              return
            }
          }

          if (url.pathname === '/rag/health' && req.method === 'GET') {
            const index = await getIndex(false)
            sendJson(res, 200, healthResponse(source, index, 'local', 'rag'))
            return
          }

          if (url.pathname === '/rag/asset' && req.method === 'GET') {
            const rel = url.searchParams.get('path') || ''
            const full = resolveAssetPath(dir, rel)
            if (!full) {
              sendJson(res, 400, { error: '非法或不支持的资源路径' })
              return
            }
            if (!fs.existsSync(full)) {
              sendJson(res, 404, { error: '资源不存在' })
              return
            }
            res.statusCode = 200
            res.setHeader('content-type', mimeTypeOf(full))
            res.setHeader('cache-control', 'no-store')
            fs.createReadStream(full).pipe(res)
            return
          }

          if (url.pathname === '/rag/reindex' && (req.method === 'GET' || req.method === 'POST')) {
            const index = await getIndex(true)
            sendJson(res, 200, healthResponse(source, index, 'local', 'rag'))
            return
          }

          if (url.pathname === '/rag/eval' && req.method === 'GET') {
            const index = await getIndex(false)
            sendJson(res, 200, await runEval(dir, index))
            return
          }

          if (url.pathname === '/rag/search' && req.method === 'GET') {
            const started = Date.now()
            const q = url.searchParams.get('q') || ''
            const topK = Math.min(Math.max(Number(url.searchParams.get('top_k') || DEFAULT_TOP_K), 1), MAX_TOP_K)
            const type = url.searchParams.get('type') || undefined
            const tag = url.searchParams.get('tag') || undefined
            const index = await getIndex(false)
            const results = searchIndex(index, q, topK, type, tag)
            sendJson(res, 200, {
              enabled: true,
              query: q,
              count: results.length,
              results,
              backend: 'rag',
              latencyMs: Date.now() - started,
            } satisfies KbSearchResponse)
            return
          }

          sendJson(res, 404, { error: `未知端点：${url.pathname}` })
        } catch (e) {
          sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) })
        }
      })
    },
  }
}
