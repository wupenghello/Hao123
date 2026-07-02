export interface WebDocLink {
  text: string
  url: string
}

export interface WebDocReadResponse {
  enabled: boolean
  ok: boolean
  status?: number
  url?: string
  finalUrl?: string
  contentType?: string
  title?: string
  description?: string
  text?: string
  links?: WebDocLink[]
  limited?: boolean
  dynamicHint?: string
  error?: string
}
