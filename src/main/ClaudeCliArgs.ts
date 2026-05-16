// Pure helpers for building Claude CLI argv. Kept free of Electron / IPC / fs
// imports so it can be unit-tested directly. The argv values match the flags
// exposed by the installed Claude Code CLI (`claude --help`).

const CLAUDE_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export function normalizeClaudeEffortFlag(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = String(value).trim().toLowerCase()
  if (!trimmed || trimmed === 'off') return null
  return CLAUDE_EFFORT_LEVELS.has(trimmed) ? trimmed : null
}

export interface BuildClaudeCliArgsInput {
  prompt: string
  permissionMode: string
  model: string
  providerSessionId?: string | null
  claudeReasoningEffort?: string | null
  imagePaths?: string[] | null
}

export function buildClaudeCliArgs(input: BuildClaudeCliArgsInput): string[] {
  const args: string[] = [
    '-p',
    input.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    input.permissionMode
  ]
  if (input.model && input.model !== 'default') {
    args.push('--model', input.model)
  }
  if (input.providerSessionId) {
    args.push('--resume', input.providerSessionId)
  }
  const effort = normalizeClaudeEffortFlag(input.claudeReasoningEffort)
  if (effort) {
    args.push('--effort', effort)
  }
  for (const imagePath of input.imagePaths || []) {
    args.push('--image', imagePath)
  }
  return args
}
