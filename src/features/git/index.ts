/**
 * Git 仓库信息特性模块（barrel）
 *
 * 把 wbscf-web 代码库的 git 全部能力模块化封装，随时可调用：
 *   - 状态栏 GitWidget 显示当前分支 + 变更数（点击进入 GitDashboard）
 *   - GitDashboard 模态框：分支管理（创建/删除/切换/检出远端）、
 *     文件暂存/取消暂存/提交、标签管理（创建/删除/推送）、
 *     Stash 管理（暂存/恢复/弹出/丢弃）、提交日志 + diff 查看
 *   - LLM 工具层（14 个工具）让小吴能执行 git 操作
 *
 * 浏览器无法执行 git 命令，真正的命令执行在根目录 vite-plugin-git.ts
 * （dev server Node 侧）暴露 /git/* 中间件完成（10 个端点 + 18 种操作）；
 * 前端只拉状态 + 触发操作。
 * Widget 与 Dashboard 共享单例状态（useGitDashboard），避免重复轮询。
 * 外部统一从这里引入：
 *   import { useGitDashboard, gitToolDefs, callGitTool } from '@/features/git'
 */
export * from './types'
export * from './api'
export { useGitDashboard } from './composable'
export * from './llm-tools'
