export const OMITTED_RENDERED_SCREENSHOT = '[omitted: rendered screenshot data URL]'

interface RenderedScreenshotResult {
  rendered?: {
    screenshotDataUrl?: string
    [key: string]: unknown
  }
}

export function renderedScreenshotDataUrl(result: unknown): string {
  const shot = (result as RenderedScreenshotResult | null)?.rendered?.screenshotDataUrl
  return typeof shot === 'string' && shot.startsWith('data:image/') ? shot : ''
}

export function omitRenderedScreenshot(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result
  const data = result as RenderedScreenshotResult
  if (!data.rendered?.screenshotDataUrl) return result
  return {
    ...(result as Record<string, unknown>),
    rendered: {
      ...data.rendered,
      screenshotDataUrl: OMITTED_RENDERED_SCREENSHOT,
    },
  }
}
