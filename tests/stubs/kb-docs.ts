/**
 * 测试环境桩：把 vite-plugin-kb 注入的 'virtual:kb-docs' 虚拟模块映射到空文档。
 * 测试环境没有 dev server / KB 目录，kbConfig.hasSource=false，kb 工具本就不启用，
 * 空数组即可让 loadKbDocs 正常工作。
 */
export const docs: never[] = []
