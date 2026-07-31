/**
 * Avatar 模块 · 公共出口（barrel）
 *
 * 外部统一从这里引入，不触达模块内部路径：
 *   import { AvatarStage, useAvatar, DEFAULT_MODEL_CONFIG } from '@/features/avatar'
 */
export * from './types'
export * from './config'
export * from './runtime'
export { useAvatar } from './composables/useAvatar'
export { default as AvatarStage } from './components/AvatarStage.vue'
