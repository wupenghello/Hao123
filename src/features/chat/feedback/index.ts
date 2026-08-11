/**
 * Chat 助手 · 反馈子系统（偏好数据飞轮 + few-shot 召回）
 *
 * 把 👍/👎/重新生成 三个自然信号结构化成偏好对存 IndexedDB（preference-log），
 * 新对话时从飞轮捞词法相似的好答案作参考示例注入（few-shot）。
 * 本模块是静默数据采集：UI 不暴露（dev 检视面板另见 index.ts 的说明）。
 */
export * from './preference-log'
export * from './few-shot'
