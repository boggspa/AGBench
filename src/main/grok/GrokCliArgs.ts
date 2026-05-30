// Pure helpers for building the Grok CLI argv. Kept free of Electron / IPC / fs
// imports so it can be unit-tested directly. The flags match `grok --help` on
// 0.2.8 (the CLI is closely modelled on Claude Code, so `--deny` ==
// `--disallowedTools` and `--permission-mode acceptEdits` mirrors Claude's).
//
// PERMISSION POSTURE (keyed off the composer's approval mode, exactly like
// Claude — see claudePermissionModeForApproval):
//   - approvalMode === 'plan' (or unset) → READ-ONLY: `--permission-mode plan`
//     + deny Bash/Edit/Write. Nothing is written.
//   - any other approval mode → FILE-WRITE: `--permission-mode acceptEdits`
//     so native Edit/Write are applied (then surfaced + gated by AGBench's
//     diff / Create-PR review, the same workspace-authority model AGBench uses
//     for Codex/Claude). Native **Bash stays denied** — AGBench can't mediate
//     Grok's native shell without an MCP server, and Grok 0.2.8 has no per-run
//     `--mcp-config` flag (G5c-ACP routes shell through AGBench's MCP + the
//     approval ledger instead).
// In NO mode is `--always-approve` ever emitted.

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

/**
 * Deny rules for FILE-WRITE mode: Edit/Write are allowed (diff-reviewed via
 * AGBench), but native shell stays denied — AGBench can't mediate Grok's Bash
 * without an MCP server, and 0.2.8 has no per-run `--mcp-config`. Shell
 * mediation is the ACP path (G5c-ACP: AGBench MCP + approval ledger).
 */
export const GROK_WRITE_MODE_DENY_RULES = ['Bash(*)'] as const

/** True when the approval mode permits writes (anything other than read-only plan). */
export function grokWriteCapable(approvalMode: string | null | undefined): boolean {
  return typeof approvalMode === 'string' && approvalMode.trim() !== '' && approvalMode !== 'plan'
}

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
  /**
   * G5c — the composer's approval mode. `'plan'`/unset = read-only;
   * anything else = file-write (acceptEdits + Edit/Write allowed, Bash still
   * denied). Mirrors Claude's claudePermissionModeForApproval.
   */
  approvalMode?: string | null
}

export function buildGrokCliArgs(input: BuildGrokCliArgsInput): string[] {
  const writeCapable = grokWriteCapable(input.approvalMode)
  const args: string[] = [
    '--no-auto-update',
    '-p',
    input.prompt,
    '--cwd',
    input.workspace,
    '--output-format',
    'streaming-json',
    '--permission-mode',
    // acceptEdits applies file edits without an interactive prompt (they're
    // reviewed via AGBench's diff/Create-PR surface); plan writes nothing.
    writeCapable ? 'acceptEdits' : 'plan',
    '--disable-web-search'
  ]
  const denyRules = writeCapable ? GROK_WRITE_MODE_DENY_RULES : GROK_READ_ONLY_DENY_RULES
  for (const rule of denyRules) {
    args.push('--deny', rule)
  }
  // G6 — resume the prior session by id (persistent conversation). Only emit
  // for a genuine non-empty id; a fresh chat (no id yet) starts a new session,
  // whose id is captured from the terminal event for the next turn.
  const resumeId = typeof input.providerSessionId === 'string' ? input.providerSessionId.trim() : ''
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
