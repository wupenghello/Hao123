/**
 * 知识库 / RAG · 类型
 *
 * RawDoc / KbChunk 保持向后兼容；RAG 服务会额外填充 sourceType、metadata、
 * citation、score 等字段，供小吴做可靠引用与低置信度处理。
 */
export type KbSourceType =
  | 'markdown'
  | 'text'
  | 'html'
  | 'json'
  | 'csv'
  | 'code'
  | 'pdf'
  | 'image'
  | 'office'
  | 'binary'

export interface KbDocMeta {
  /** 原始文件相对路径或远程 manifest 中的 path */
  path?: string
  /** 文件类型 / MIME / 解析器补充信息 */
  sourceType?: KbSourceType
  /** 媒体文件 MIME，用于视觉模型读取图片 */
  mimeType?: string
  /** 文件大小（字节） */
  size?: number
  /** 本地文件修改时间戳 */
  mtimeMs?: number
  /** 文档标签，用于过滤与提示词引用 */
  tags?: string[]
  /** 同义词 / 别名，提升关键词召回 */
  aliases?: string[]
  /** 内容负责人，方便知识治理 */
  owner?: string
  /** 最近人工确认日期，ISO 日期字符串 */
  lastReviewedAt?: string
  /** 是否经过脱敏 */
  redacted?: boolean
  /** 入库/解析警告 */
  warnings?: string[]
}

export interface RawDoc {
  /** 文档标识（去扩展名的文件名，或 manifest 给定的 key） */
  doc: string
  /** 文档标题（取自首个 # 一级标题，无则用 doc） */
  title: string
  /** 文档原文（markdown） */
  content: string
  /** 原始类型；缺省按 markdown 处理 */
  sourceType?: KbSourceType
  /** 扩展元数据 */
  metadata?: KbDocMeta
}

export interface KbChunk {
  /** 文档标识（同 RawDoc.doc） */
  doc: string
  /** 文档标题（取自首个 # 一级标题，无则用文件名） */
  docTitle: string
  /** 段落标题（## 二级标题）；文档开头的前言片段为空串 */
  section: string
  /** 片段正文 */
  content: string
  /** 稳定片段 id，RAG 服务返回；旧本地切片可为空 */
  id?: string
  /** 标题层级路径，如 文档标题 > 章节 > 小节 */
  titlePath?: string[]
  /** 原始来源类型 */
  sourceType?: KbSourceType
  /** 引用定位（页码、行号、sheet、slide 等） */
  citation?: KbCitation
  /** 继承自文档的扩展元数据 */
  metadata?: KbDocMeta
  /** dev RAG 服务提供的媒体访问地址；图片命中时可转成 vision 输入 */
  assetUrl?: string
  /** 媒体 MIME；例如 image/png */
  mimeType?: string
}

export interface KbCitation {
  label: string
  path?: string
  page?: number
  lineStart?: number
  lineEnd?: number
  sheet?: string
  slide?: number
}

export type KbConfidence = 'high' | 'medium' | 'low'

export interface KbSearchHit extends KbChunk {
  score: number
  confidence?: KbConfidence
  matchedTerms?: string[]
  highlights?: string[]
}

export interface KbSearchResponse {
  enabled: boolean
  query: string
  count: number
  results: KbSearchHit[]
  backend: 'rag' | 'static' | 'remote' | 'disabled'
  latencyMs?: number
  error?: string
}

export interface KbHealthIssue {
  level: 'info' | 'warn' | 'error'
  message: string
  doc?: string
}

export interface KbHealthResponse {
  enabled: boolean
  source: string
  mode: 'local' | 'remote' | 'static' | 'disabled'
  backend: 'rag' | 'static' | 'remote' | 'disabled'
  docCount: number
  chunkCount: number
  indexedAt?: string
  parserCoverage: Record<string, number>
  warnings: KbHealthIssue[]
  errors: KbHealthIssue[]
}
