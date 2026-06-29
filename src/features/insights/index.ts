/**
 * 洞察（Insights）特性模块公共出口（barrel）
 *
 * 外部统一从这里引入，不触达模块内部路径：
 *   import { useInboxInsights, predictItem, summarize } from '@/features/insights'
 *
 * 结构：
 *   types.ts       数据类型（WorkItem / Prediction / InsightSummary / RiskLevel）
 *   predict.ts     预测引擎（纯函数：逾期 / 临期 / 停滞，含可解释的 why 与行动建议 action）
 *   composable.ts  useInboxInsights——把三类 store 归一化 + 跑预测，暴露 predictions / summary
 *
 * 定位：首页「AI 主动评估」的确定性来源——纯启发式、即时、可解释，不依赖 LLM；
 * 与「晨报叙述」「交给小吴深聊」等需要自然语言的能力互补。
 */
export * from './types'
export { predictItem, summarize, deadlineDays, parseZentaoTime } from './predict'
export { detectInsights } from './detect'
export { useInboxInsights } from './composable'
