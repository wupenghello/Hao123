export const MODAO_PROJECT_URL = import.meta.env.VITE_MODAO_PROJECT_URL?.trim() || ''

export const MODAO_PROJECT_LABEL = import.meta.env.VITE_MODAO_PROJECT_LABEL?.trim() || '项目迭代原型'

export const modaoConfigured = !!MODAO_PROJECT_URL
