/**
 * 知识库特性模块公共出口（barrel）
 *
 * 外部统一从这里引入，不触达模块内部路径：
 *   import { kbToolDefs, callKbTool } from '@/features/kb'
 *
 * 分层（自包含）：
 *   config.ts      KB 来源配置（VITE_KB_SOURCE：本地路径 / http URL）
 *   types.ts       文档原文 RawDoc / 片段 KbChunk 类型
 *   source.ts      加载文档原文（本地虚拟模块 / 远程 fetch manifest）
 *   chunker.ts     按二级标题切分片段（纯函数）
 *   loader.ts      加载 + 切片 + 缓存（getKbChunks）
 *   search.ts      关键词检索（searchKb，async）
 *   llm-tools.ts   LLM 工具层（kbToolDefs / callKbTool）
 *
 * 文档不放进项目：通过 .env 的 VITE_KB_SOURCE 指向项目外的本地文件夹或远程地址。
 * 本地源由根目录 vite-plugin-kb.ts 在 dev/构建时读取并注入虚拟模块。
 */
export * from './llm-tools'
