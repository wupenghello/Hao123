export interface ReachSource {
  title?: string
  url: string
  snippet?: string
  provider?: string
  publishedAt?: string
}

export interface ReachStatusResponse {
  enabled: boolean
  installed: boolean
  version?: string
  doctor?: unknown
  tools: {
    agentReach: boolean
    mcporter: boolean
    ytDlp: boolean
    gh: boolean
    bili: boolean
    opencli: boolean
  }
  error?: string
}

export interface ReachSearchResponse {
  enabled: boolean
  ok: boolean
  query: string
  provider: 'exa' | 'duckduckgo'
  results: ReachSource[]
  raw?: string
  error?: string
}

export interface ReachReadUrlResponse {
  enabled: boolean
  ok: boolean
  url: string
  title?: string
  text?: string
  source?: ReachSource
  limited?: boolean
  error?: string
}

export interface ReachGithubRepoResponse {
  enabled: boolean
  ok: boolean
  repo?: string
  url?: string
  description?: string
  homepage?: string
  stars?: number
  forks?: number
  openIssues?: number
  watchers?: number
  language?: string
  license?: string
  topics?: string[]
  defaultBranch?: string
  createdAt?: string
  updatedAt?: string
  pushedAt?: string
  readme?: string
  recentCommits?: Array<{ sha: string; message: string; author?: string; date?: string; url?: string }>
  recentIssues?: Array<{ number: number; title: string; url: string; state: string; updatedAt?: string }>
  sources: ReachSource[]
  error?: string
}

export interface ReachVideoSummaryResponse {
  enabled: boolean
  ok: boolean
  url: string
  platform: 'youtube' | 'bilibili' | 'other'
  title?: string
  uploader?: string
  duration?: number
  webpageUrl?: string
  transcript?: string
  metadata?: string
  transcriptSource?: 'yt-dlp' | 'opencli' | 'metadata'
  subtitleAvailable?: boolean
  subtitleItemCount?: number
  limited?: boolean
  fallbackActions?: string[]
  sources: ReachSource[]
  error?: string
}

export interface ReachMarkdownNoteResponse {
  enabled: boolean
  ok: boolean
  title: string
  markdown: string
  sources?: ReachSource[]
  note: string
}
