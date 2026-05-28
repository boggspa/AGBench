// Pure helpers for building the READ-ONLY Grok CLI argv. Kept free of
// Electron / IPC / fs imports so it can be unit-tested directly. The flags
// match `grok --help` on 0.2.3 (the CLI is closely modelled on Claude Code,
// so `--deny` == Claude's `--disallowedTools`).
//
// Read-only by construction (G3): the builder ALWAYS forces
// `--permission-mode plan` and denies the write/shell/edit tools, disables web
// search, and NEVER emits `--always-approve` (or any acceptEdits / auto /
// bypassPermissions mode). Write-capable Grok is a later, separately-gated
// slice (G5).

const GROK_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export function normalizeGrokEffortFlag(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = String(value).trim().toLowerCase()
  if (!trimmed || trimmed === 'off') return null
  return GROK_EFFORT_LEVELS.has(trimmed) ? trimmed : null
}

/**
 * The deny rules that keep a Grok run read-only. Grok mirrors Claude Code's
 * tool-name grammar, so these map to `--disallowedTools` semantics.
 */
export const GROK_READ_ONLY_DENY_RULES = ['Bash(*)', 'Edit(*)', 'Write(*)'] as const

export interface BuildGrokCliArgsInput {
  prompt: string
  workspace: string
  model?: string | null
  reasoningEffort?: string | null
}

export function buildGrokCliArgs(input: BuildGrokCliArgsInput): string[] {
  const args: string[] = [
    '--no-auto-update',
    '-p',
    input.prompt,
    '--cwd',
    input.workspace,
    '--output-format',
    'streaming-json',
    '--permission-mode',
    'plan',
    '--disable-web-search'
  ]
  for (const rule of GROK_READ_ONLY_DENY_RULES) {
    args.push('--deny', rule)
  }
  // Only forward genuine Grok model ids (e.g. grok-code-fast-1). The composer's
  // CLI-default option — and any model id that leaked in from another provider's
  // picker (e.g. Gemini's 'flash-lite') — must NOT be passed: Grok rejects
  // unknown ids and the whole run fails. Real Grok model wiring is a later slice.
  if (input.model && input.model.startsWith('grok')) {
    args.push('--model', input.model)
  }
  const effort = normalizeGrokEffortFlag(input.reasoningEffort)
  if (effort) {
    args.push('--effort', effort)
  }
  return args
}
