/**
 * 小吴 · 常驻 AI 伙伴（桌宠）特性模块公共出口（barrel）
 *
 * 外部统一从这里引入：
 *   import { CompanionPet, useCompanion } from '@/features/companion'
 *
 * 结构（自包含）：
 *   types.ts                       CompanionMood / State / BubblePayload / CompanionRenderer 接口
 *   config.ts                      Senko 模型源 / env / mood 常量 / 时间窗
 *   mood.ts                        resolveMood 纯函数（确定性心情仲裁）
 *   ui.ts                          mood → 视觉映射（色调光晕 / aria）
 *   speech.ts                      气泡 builder（问候 / 洞察 / 恢复 / 庆祝）
 *   composable.ts                  useCompanion（装配信号 → mood/bubble/actions）
 *   renderer/                      CompanionRenderer 实现（Live2D / 占位）+ 工厂
 *   components/CompanionPet.vue    本体（renderer 容器 + 徽标 + 气泡 + 拖拽 + 菜单 + 无障碍）
 *   components/CompanionBubble.vue 语音气泡（aria-live / auto-dismiss / hand-off）
 */
export { default as CompanionPet } from './components/CompanionPet.vue'
export { useCompanion } from './composable'
export { resolveMood } from './mood'
export { MOOD_VISUAL, greetingWord } from './ui'
export * from './types'
