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
  /**
   * G6 — resume a prior Grok session by id so a chat is a persistent
   * conversation rather than a fresh turn each message. Grok's `-r/--resume
   * [SESSION_ID]` mirrors Claude's `--resume` and is valid in print (`-p`)
   * mode. The id is captured from the previous turn's terminal
   * `{type:'end',sessionId}` event (GrokStreamingJson → updateCliProviderSession)
   * and threaded back via the renderer's providerSessionId, exactly like
   * Claude. Grok sessions are cwd-scoped, so the workspace must match across
   * turns for the resume to attach.
   */
  providerSessionId?: string | null
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
  // G6 — resume the prior session by id (persistent conversation). Only emit
  // for a genuine non-empty id; a fresh chat (no id yet) starts a new session,
  // whose id is captured from the terminal event for the next turn.
  const resumeId =
    typeof input.providerSessionId === 'string' ? input.providerSessionId.trim() : ''
  if (resumeId) {
    args.push('--resume', resumeId)
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
