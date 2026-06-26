/**
 * Chat 助手 · 公共配置（env 驱动）
 *
 * 把「助手身份」与「LLM 接入参数」这两类公共设置集中到一处，便于统一调整、
 * 后期拆分与多处引用：组件取身份（名称/标语），llm/ 层取接入参数。
 *
 * 所有可调项均可经 .env 覆盖（见 .env.example）：
 *   VITE_ASSISTANT_NAME      助手名称（默认「小吴」）
 *   VITE_ASSISTANT_TAGLINE   助手一句话定位（欢迎页/提示用）
 *   VITE_DEEPSEEK_API_KEY    LLM API Key（OpenAI 兼容）
 *   VITE_DEEPSEEK_MODEL      模型名
 */

/** 读取并 trim env，空串/未配置回退到默认值 */
function envOr(value: string | undefined, fallback: string): string {
  const v = value?.trim()
  return v || fallback
}

// ============ 助手身份 ============

/** 助手名称（默认「小吴」），全应用文案统一引用此处 */
export const ASSISTANT_NAME = envOr(import.meta.env.VITE_ASSISTANT_NAME, '小吴')

/** 助手一句话定位（欢迎页副标题 / 命令面板提示） */
export const ASSISTANT_TAGLINE = envOr(
  import.meta.env.VITE_ASSISTANT_TAGLINE,
  '你的工作台智能助理 —— 查天气、看禅道任务与 Bug，一句话就够。',
)

// ============ LLM 接入（OpenAI 兼容；当前接 DeepSeek）============

/**
 * LLM 是否「已配置」。
 *
 * API Key 由 vite 代理层注入（见 vite.config.ts），客户端不能直接读 VITE_DEEPSEEK_API_KEY
 * ——该变量以 VITE_ 开头会被打进前端包，导致密钥泄露。故用一个独立的、非敏感的布尔开关
 * VITE_DEEPSEEK_CONFIGURED 表达「Key 是否已在 .env / 代理侧配置好」，客户端据此决定是否
 * 显示「尚未接入 LLM」引导与禁用输入框，而无需触碰密钥本身。
 *
 * 代理侧（vite.config.ts）在请求时校验真正的 VITE_DEEPSEEK_API_KEY；未配置时返回 401。
 */
const configuredRaw = String(import.meta.env.VITE_DEEPSEEK_CONFIGURED).toLowerCase()
const isConfigured = configuredRaw === 'true' || configuredRaw === '1'

/** LLM 接入参数；走 vite 代理 /deepseek 规避跨域（见 vite.config.ts） */
export const llmConfig = {
  /** 提供方标识（调试/日志用） */
  provider: 'deepseek',
  /** API Key 由 vite 代理层注入（见 vite.config.ts），客户端不再携带 */
  apiKey: '',
  model: envOr(import.meta.env.VITE_DEEPSEEK_MODEL, 'deepseek-chat'),
  /** chat/completions 端点（经代理转发到提供方） */
  endpoint: '/deepseek/chat/completions',
  /** 是否已配置（基于非敏感开关 VITE_DEEPSEEK_CONFIGURED，非密钥本身） */
  configured: isConfigured,
} as const
