/**
 * 知识库 · 公共工具（Node 侧 vite-plugin 与浏览器侧 config 共用，无 fs 依赖）
 *
 * 把「是否远程源」的判断收敛到一处，避免 vite-plugin-kb.ts 与 config.ts 各持一份
 * 正则导致构建期/运行期判定漂移。
 */

/** 判断 KB source 是否为 http(s) URL */
export function isHttpSource(s: string): boolean {
  return /^https?:\/\//i.test(s)
}
