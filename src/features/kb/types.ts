/**
 * 知识库 · 类型
 *
 * - RawDoc：知识库文档原文（加载层返回），来源可为本地文件夹或远程 manifest。
 * - KbChunk：一篇文档按 ## 切出的最小检索单元。
 */
export interface RawDoc {
  /** 文档标识（去扩展名的文件名，或 manifest 给定的 key） */
  doc: string
  /** 文档标题（取自首个 # 一级标题，无则用 doc） */
  title: string
  /** 文档原文（markdown） */
  content: string
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
}
