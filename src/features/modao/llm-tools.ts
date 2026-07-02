import type { LlmTool, LlmToolDef } from '@/features/chat/llm/types'
import { omitRenderedScreenshot } from '@/features/rendered-screenshot'
import { fetchModaoPrototype, fetchModaoStatus, isModaoPrototypeUrl } from './api'
import { MODAO_PROJECT_LABEL, MODAO_PROJECT_URL, modaoConfigured } from './config'
import { MODAO_SKILL_PROMPT, MODAO_SKILL_SUMMARY } from './skill'

export const modaoEnabled = import.meta.env.DEV && modaoConfigured

function cleanUrl(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

const statusTool: LlmTool<Record<string, never>, unknown> = {
  name: 'modao.status',
  description:
    '查询墨刀原型读取 skill 是否可用，以及本机是否能用 Edge/Chrome 做无登录 headless 渲染。只读查询。',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute() {
    if (!modaoEnabled) return { enabled: false, note: '墨刀读取仅在 dev server 中可用。' }
    try {
      return await fetchModaoStatus()
    } catch (e) {
      return { enabled: false, error: (e as Error)?.message || '墨刀状态查询失败' }
    }
  },
}

const readTool: LlmTool<{ url?: string; includeScreenshot?: boolean }, unknown> = {
  name: 'modao.read',
  description:
    `${MODAO_SKILL_SUMMARY}\n${MODAO_SKILL_PROMPT}\n` +
    `默认读取 .env 配置的「${MODAO_PROJECT_LABEL}」项目迭代原型。` +
    '【适用】用户问项目迭代原型、让你解释原型、从禅道任务/Bug 外链里读需求原型、整理页面列表/按钮文案/验收点。' +
    '当用户明确要求看 UI 截图预览、按视觉稿判断、看页面布局/按钮位置/截图内容时，把 includeScreenshot 设为 true。' +
    '【不适用】非 modao.cc/proto 链接请用 webdoc.read；没有 includeScreenshot 时不要声称看到了像素级布局。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '可选。公开墨刀原型链接；不传则读取 .env 中 VITE_MODAO_PROJECT_URL 配置的项目迭代原型。',
      },
      includeScreenshot: {
        type: 'boolean',
        description: '可选。用户明确要求查看 UI 截图预览/视觉布局时传 true；普通需求理解和验收点整理不需要。',
      },
    },
    required: [],
  },
  async execute({ url, includeScreenshot }, signal) {
    const target = cleanUrl(url) || MODAO_PROJECT_URL
    if (!modaoEnabled) return { enabled: false, note: '墨刀读取仅在 dev server 且配置 VITE_MODAO_PROJECT_URL 时可用。' }
    if (!isModaoPrototypeUrl(target)) {
      return { enabled: true, ok: false, error: '这不是有效的公开墨刀原型链接。' }
    }
    const result = await fetchModaoPrototype(target, signal)
    return includeScreenshot ? result : omitRenderedScreenshot(result)
  },
}

export const modaoTools: LlmTool[] = [statusTool, readTool]

export const modaoToolDefs: LlmToolDef[] = modaoTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

export async function callModaoTool(
  name: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const tool = modaoTools.find((t) => t.name === name)
  if (!tool) return { error: `未知墨刀工具：${name}` }
  try {
    return await tool.execute((params ?? {}) as Record<string, unknown>, signal)
  } catch (e) {
    return { enabled: modaoEnabled, ok: false, error: (e as Error)?.message || '墨刀读取失败' }
  }
}
