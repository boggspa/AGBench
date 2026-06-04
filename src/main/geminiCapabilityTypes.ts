export const GEMINI_CAPABILITY_KINDS = ['mcp', 'extensions', 'skills', 'agents'] as const
export const GEMINI_CAPABILITY_COMMANDS = {
  mcp: ['mcp', 'list'],
  extensions: ['extensions', 'list'],
  skills: ['skills', 'list'],
  agents: ['agents', 'list']
} as const
export const GEMINI_CAPABILITY_TIMEOUT_MS = 8_000
export const MAX_CAPABILITY_OUTPUT_CHARS = 200_000

export type GeminiCapabilityKind = (typeof GEMINI_CAPABILITY_KINDS)[number]

export type GeminiCapabilityFormat = 'json' | 'raw' | 'error'

export interface GeminiCapabilityItem {
  id: string
  name: string
  status?: string
  detail?: string
  raw: string
}

export interface GeminiCapabilitySection {
  kind: GeminiCapabilityKind
  command: string[]
  format: GeminiCapabilityFormat
  items: GeminiCapabilityItem[]
  stdout: string
  stderr: string
  status: number | null
  timedOut: boolean
  error?: string
  parsingError?: string
  truncated?: boolean
}

export interface GeminiCapabilitiesState {
  refreshedAt: string
  workspace?: string
  sections: Record<GeminiCapabilityKind, GeminiCapabilitySection>
}

export interface GeminiCapabilityProcessResult {
  args: string[]
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  error?: string
  truncated?: boolean
}
