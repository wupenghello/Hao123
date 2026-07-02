import type { LlmTool, LlmToolDef } from '@/features/chat/llm/types'
import { omitRenderedScreenshot } from '@/features/rendered-screenshot'
import { fetchWebDoc } from './api'

export const webDocEnabled = import.meta.env.DEV

function cleanUrl(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

const readTool: LlmTool<{ url: string }> = {
  name: 'webdoc.read',
  description:
    'Read a public http/https document URL. For normal pages it extracts static title, description, visible text and links. ' +
    'For Modao/Mockitt prototype share URLs (modao.cc/proto/...) it reads public preview metadata and, in dev, uses a temporary no-login headless browser render to extract visible screen text: project name, target screen, canvas metadata, page outline, sibling screens, and current canvas text. ' +
    'Use this after Zentao task/bug details contain an external PRD/prototype/wiki/document link, or when the user asks what a shared web document says. ' +
    'It does not use browser login state. For JavaScript-only pages without a supported metadata API or local Edge/Chrome, it may only see a static shell. ' +
    'Use rendered.currentCanvasText / rendered.visibleText first when present; only ask for screenshots or exported docs when pixel-level layout details are required or rendered.error is present.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Public http/https document URL to read.' },
    },
    required: ['url'],
  },
  async execute({ url }, signal) {
    const target = cleanUrl(url)
    if (!webDocEnabled) {
      return { enabled: false, error: 'webdoc.read is only available in the dev server.' }
    }
    if (!/^https?:\/\//i.test(target)) {
      return { enabled: true, ok: false, error: 'Only http/https URLs are supported.' }
    }
    return omitRenderedScreenshot(await fetchWebDoc(target, signal))
  },
}

export const webDocTools: LlmTool[] = [readTool]

export const webDocToolDefs: LlmToolDef[] = webDocTools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}))

export async function callWebDocTool(name: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
  const tool = webDocTools.find((t) => t.name === name)
  if (!tool) return { error: `Unknown web document tool: ${name}` }
  try {
    return await tool.execute((params ?? {}) as Record<string, unknown>, signal)
  } catch (e) {
    return { enabled: webDocEnabled, ok: false, error: (e as Error)?.message || 'web document read failed' }
  }
}
