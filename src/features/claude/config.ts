/**
 * Claude Code 本地启动 · 配置
 *
 * 启用条件：dev 模式且配置了 VITE_WBSCF_WEB_ROOT（claude 的工作目录复用 wbscf-web 根目录，
 * 由 vite-plugin-wbscf 在 dev server 侧拉起）。生产构建无 dev server、未配置根目录时
 * 均不启用——不暴露工具给模型、不渲染状态栏按钮（对齐 wbscfEnabled / kbEnabled 门控约定）。
 */

/** Claude 启动功能是否启用（构建期常量：dev && 配置了 VITE_WBSCF_WEB_ROOT） */
export const claudeEnabled =
  import.meta.env.DEV && !!import.meta.env.VITE_WBSCF_WEB_ROOT?.trim()
