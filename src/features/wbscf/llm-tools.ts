/**
 * wbscf-web 本地 dev 服务 · LLM 工具层（function-calling / tool-use）
 *
 * 与天气 / 禅道 / 知识库 / 本地待办工具层同构（复用 LlmToolDef 接口），把「查询 / 启动本地 dev 服务」
 * 以工具形式暴露给小吴：查状态、按需拉起。
 *
 * 拉起与状态栏点击走同一条路径——dev server 的 /wbscf/launch（ensureStarted 幂等）：
 *   - 点击：在用户手势内 window.open 打开中转页（HTML，端口就绪后自动跳转到应用）；
 *   - 本工具：无手势，window.open 会被弹窗拦截，故只 fetch 该端点触发服务端拉起，
 *     再轮询 /wbscf/services 等 running=true。两者命中同一 ensureStarted，不重复拉起。
 *
 * 生产构建无 dev server，端点 404：fetchWbscfServices 抛错，这里 catch 成 { enabled:false }，
 * 模型据此说明「当前不可用」而非收到一条报错。
 */
import type { LlmToolDef, LlmTool } from '@/features/chat/llm/types'
import { fetchWbscfServices, triggerWbscfLaunch } from './api'
import type { WbscfServicesResponse } from './types'

/** fetchWbscfServices 在生产（无 dev server，/wbscf/services 404）会抛错；
 *  统一降级为 { enabled:false }，让工具返回「当前不可用」而非 { error }。 */
async function safeFetchServices(): Promise<WbscfServicesResponse | { enabled: false }> {
  try {
    return await fetchWbscfServices()
  } catch {
    return { enabled: false }
  }
}

/** 服务状态精简项（喂给模型的每项只留必要字段，省 token） */
interface ServiceStateItem {
  app: string
  label: string
  script: string
  port: number
  url: string
  available: boolean
  running: boolean
  booting: boolean
}

/** 从全量响应里取（过滤后的）精简服务列表；enabled:false 时返回 [] */
function pickServices(resp: WbscfServicesResp, app?: string): ServiceStateItem[] {
  if (!resp.enabled) return []
  return resp.services
    .filter((s) => !app || s.app === app)
    .map((s) => ({
      app: s.app,
      label: s.label,
      script: s.script,
      port: s.port,
      url: s.url,
      available: s.available,
      running: s.running,
      booting: s.booting,
    }))
}

// 局部类型别名：fetchWbscfServices 成功，或降级的 { enabled:false }
type WbscfServicesResp = WbscfServicesResponse | { enabled: false }

/** 1. 查询 wbscf-web 各子应用的本地 dev 服务状态 */
const statusTool: LlmTool<{ app?: string }, unknown> = {
  name: 'wbscf.services',
  description:
    '查询 wbscf-web 代码库各子应用（账号中心 account / 买家中心 buyer / 卖家中心 seller / 运营管理 ops / ERP erp）的本地 dev 服务运行状态，' +
    '返回每个服务的端口、本地访问地址、是否在运行（running）、是否启动中（booting）。' +
    '【适用】用户问本地服务相关——「account 起没起」「erp 在不在跑」「哪些本地服务开着」「本地访问地址是多少」等。' +
    '只读查询，不改变状态。生产环境无 dev server 时返回 enabled=false。',
  parameters: {
    type: 'object',
    properties: {
      app: {
        type: 'string',
        description: '可选，只查某个子应用（account / buyer / seller / ops / erp）；不传则返回全部',
        enum: ['account', 'buyer', 'seller', 'ops', 'erp'],
      },
    },
    required: [],
  },
  async execute({ app }) {
    const resp = await safeFetchServices()
    if (!resp.enabled) {
      return {
        enabled: false,
        note: '未配置 wbscf-web 代码库（VITE_WBSCF_WEB_ROOT），或当前无 dev server（生产环境）。',
      }
    }
    return { enabled: true, root: resp.root, services: pickServices(resp, app) }
  },
}

/** 共享的启动超时常量（composable 与 launcherHtml 各自的轮询也用同一口径） */
export const LAUNCH_TIMEOUT_MS = 120_000
/** 启动轮询间隔 */
const LAUNCH_POLL_MS = 1500

/**
 * 2. 启动 wbscf-web 某子应用的本地 dev 服务
 * 与状态栏点击同源：fetch /wbscf/launch 触发服务端拉起（幂等），再轮询端口就绪。
 * 支持 signal：上层（chat store 的 AbortController）可中断长轮询，用户点「停止」即时生效。
 */
const launchTool: LlmTool<{ app: string; signal?: AbortSignal }, unknown> = {
  name: 'wbscf.launch',
  description:
    '启动 wbscf-web 某个子应用（account / buyer / seller / ops / erp）的本地 dev 服务，与用户在状态栏点击「localhost」走同一条启动路径。' +
    '已在运行则不重复拉起，直接返回运行中状态与本地访问地址。启动需数十秒（首次构建更久），本工具会等待端口就绪后返回结果。' +
    '【适用】用户说「把 account 跑起来」「启动 erp 本地服务」「帮我把卖家中心起一下」等。' +
    '【不适用】只查状态用 wbscf.services；生产环境无 dev server 时返回 enabled=false。',
  parameters: {
    type: 'object',
    properties: {
      app: {
        type: 'string',
        description: '要启动的子应用（account / buyer / seller / ops / erp）',
        enum: ['account', 'buyer', 'seller', 'ops', 'erp'],
      },
    },
    required: ['app'],
  },
  async execute({ app, signal }) {
    if (signal?.aborted) return { aborted: true }
    // 先看当前状态：已运行就直接返回，不重复拉起
    let resp = await safeFetchServices()
    if (!resp.enabled) {
      return {
        enabled: false,
        note: '未配置 wbscf-web 代码库（VITE_WBSCF_WEB_ROOT），或当前无 dev server（生产环境）。',
      }
    }
    const before = resp.services.find((s) => s.app === app)
    if (before?.running) {
      return { enabled: true, action: 'already_running', ...pickServices(resp, app)[0] }
    }
    if (before && !before.available) {
      return {
        enabled: true,
        action: 'unavailable',
        note: `wbscf-web/package.json 中不存在脚本 ${before.script}，无法启动。`,
        ...pickServices(resp, app)[0],
      }
    }

    // 触发拉起（与点击同源的 /wbscf/launch?json=1，幂等）。非 2xx 会抛错 →
    // 不再傻等超时，而是即时把服务端真实错误回给模型。
    try {
      resp = await triggerWbscfLaunch(app)
    } catch (e) {
      return { enabled: true, action: 'failed', note: `拉起失败：${(e as Error)?.message || e}` }
    }
    // 轮询端口就绪：用 signal 中断循环，避免用户停止后还干等最长 120s。
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (signal?.aborted) return { enabled: true, action: 'aborted' }
      await delayOrAbort(LAUNCH_POLL_MS, signal)
      if (signal?.aborted) return { enabled: true, action: 'aborted' }
      resp = await safeFetchServices()
      if (resp.enabled) {
        const cur = resp.services.find((s) => s.app === app)
        if (cur?.running) {
          return { enabled: true, action: 'started', ...pickServices(resp, app)[0] }
        }
      }
    }
    return {
      enabled: true,
      action: 'timeout',
      note: `启动超时（>${LAUNCH_TIMEOUT_MS / 1000}s），请到运行 Hao123 的终端查看 wbscf-web 报错。`,
      ...pickServices(resp, app)[0],
    }
  },
}

/** sleep，但在 signal abort 时立即 resolve（让轮询循环能及时退出） */
function delayOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((r) => setTimeout(r, ms))
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 全部 wbscf 工具 */
export const wbscfTools: LlmTool[] = [statusTool, launchTool]

/** 喂给 LLM 的工具声明（剥离 execute，可直接序列化） */
export const wbscfToolDefs: LlmToolDef[] = wbscfTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

/**
 * 按名执行 wbscf 工具（LLM 返回 tool_call 后由此分发）。
 * 与 callKbTool 一致：执行出错时返回 { error } 文本而非抛出，
 * 既避免中断整轮对话，也让上层（store）据 result.error 标记工具活动为错误。
 *
 * signal 由 chat store 的 AbortController 透传，让长轮询工具（wbscf.launch）可被用户「停止」中断。
 */
export async function callWbscfTool(
  name: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const tool = wbscfTools.find((t) => t.name === name)
  if (!tool) return { error: `未知 wbscf 工具：${name}` }
  try {
    // 把 signal 挂进 params（模型不会发这个字段；工具按需读取），保持 LlmTool 签名一致
    const args = { ...(params as Record<string, unknown> | null), signal } as Record<string, unknown>
    return await tool.execute(args)
  } catch (e) {
    return { error: (e as Error)?.message || 'wbscf 服务状态查询失败' }
  }
}
