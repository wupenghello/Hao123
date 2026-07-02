export interface ModaoCanvasSummary {
  id: string
  name: string
  width?: number
  height?: number
  device?: string
}

export interface ModaoProjectSummary {
  cid?: string
  name?: string
  owner?: string
  updatedAt?: unknown
  width?: unknown
  height?: unknown
  device?: unknown
  screensCount?: unknown
}

export interface ModaoScreenSummary {
  id: string
  name?: string
  path?: string[]
  canvas?: ModaoCanvasSummary
  siblingScreens?: Array<{ id: string; name: string }>
  error?: string
}

export interface ModaoRenderedSummary {
  title?: string
  finalUrl?: string
  currentCanvasText?: string
  commentsText?: string
  visibleText?: string
  screenshotDataUrl?: string
  buttonTexts?: string[]
  canvasCount?: number
  iframeCount?: number
  imageCount?: number
  error?: string
}

export interface ModaoOutlineGroup {
  id: string
  name: string
  folder: boolean
  childCount?: number
  truncated?: boolean
  children: Array<{ id: string; name: string; path?: string[] }>
}

export interface ModaoPrototypeReadResponse {
  enabled: boolean
  ok: boolean
  sourceType?: 'modao-prototype'
  url?: string
  finalUrl?: string
  title?: string
  project?: ModaoProjectSummary
  targetScreen?: ModaoScreenSummary
  rendered?: ModaoRenderedSummary
  outline?: ModaoOutlineGroup[]
  pageCount?: number
  folderCount?: number
  note?: string
  error?: string
}

export interface ModaoStatusResponse {
  enabled: boolean
  configured?: boolean
  browserRender: boolean
  browserName?: string
  note?: string
}
