/**
 * Phase I3.x — Detect-and-redirect heuristic for cross-provider delegation.
 *
 * Background: AGBench exposes `AGBench__delegate_to_subthread` so a Gemini
 * (or Codex / Claude / Kimi) run can hand work off to a different provider.
 * Empirically Gemini still prefers its built-in `invoke_agent` even when the
 * user explicitly asked for "delegate to Kimi". Those built-in agents run
 * inside Gemini's own process and cannot reach AGBench providers — the
 * delegation is silently dropped on the floor.
 *
 * This module owns the heuristic that watches Gemini's stdout for an
 * invoke_agent style tool call AND checks whether the original user prompt
 * mentioned another AGBench provider. When both are true we emit a single
 * non-blocking `provider_warning` event back to the renderer.
 *
 * The detection is pure: it doesn't talk to electron, IPC, or the store —
 * those concerns live in the caller. Keeping it side-effect free makes it
 * unit-testable and trivially reusable when we wire the same heuristic into
 * other providers' streams.
 */

/** Tool-call names emitted by Gemini's built-in sub-agent system. Any of
 * these short-circuits the heuristic. */
const GEMINI_INTERNAL_AGENT_TOOL_NAMES = [
  'invoke_agent',
  'create_agent',
  'run_agent',
  'spawn_agent',
  'task'
] as const

/** Free-text phrases that also indicate Gemini's internal agent surface
 * (the CLI sometimes prints a one-liner before / after the tool call). */
const GEMINI_INTERNAL_AGENT_PHRASES = [
  'spawned agent',
  'spawned agents',
  'invoke_agent',
  'invoking agent',
  'invoking subagent',
  'invoke-agent'
] as const

/** Cross-provider keywords in the user prompt. We match case-insensitively;
 * full word boundaries are not enforced because users phrase requests like
 * "ask Kimi to..." but also "ask kimi-instant to...".  The set is small and
 * unambiguous enough that bare substring match doesn't false-positive on
 * real prompts. */
const CROSS_PROVIDER_PROMPT_KEYWORDS = [
  'kimi',
  'codex',
  'claude',
  'delegate to',
  'sub-agent',
  'subagent',
  'sub-thread',
  'subthread'
] as const

export interface CrossProviderDetectionInput {
  /** The user's prompt for the current run. Used to confirm cross-provider
   * intent — we only flag invoke_agent calls when the user mentioned another
   * provider. */
  userPrompt?: string
  /** Raw Gemini stdout chunk (or a parsed tool name when the caller has
   * extracted it). The detector inspects both shapes. */
  stdoutChunk?: string
  /** Optional structured tool-call name. When provided we short-circuit on
   * an exact match instead of substring-scanning the stdout. */
  toolName?: string
}

export interface CrossProviderDetectionResult {
  /** True iff the stdout chunk looks like Gemini's internal agent surface
   * AND the user prompt expressed cross-provider intent. */
  shouldWarn: boolean
  /** Reason text — useful for tests + the renderer chip. */
  reason?: string
}

/** Pure detector. Side-effect free; callers wire the result to whatever
 * notification surface they own (durable run event + non-blocking chip). */
export function detectCrossProviderDelegationMisuse(
  input: CrossProviderDetectionInput
): CrossProviderDetectionResult {
  const prompt = (input.userPrompt || '').toLowerCase()
  if (!prompt) return { shouldWarn: false }

  const hasCrossProviderKeyword = CROSS_PROVIDER_PROMPT_KEYWORDS.some((needle) =>
    prompt.includes(needle)
  )
  if (!hasCrossProviderKeyword) return { shouldWarn: false }

  if (input.toolName) {
    const normalized = input.toolName.trim().toLowerCase()
    if ((GEMINI_INTERNAL_AGENT_TOOL_NAMES as readonly string[]).includes(normalized)) {
      return {
        shouldWarn: true,
        reason: `Gemini called its built-in ${normalized} tool while the user prompt expressed cross-provider intent.`
      }
    }
  }

  const chunk = (input.stdoutChunk || '').toLowerCase()
  if (!chunk) return { shouldWarn: false }

  // Match a tool_name JSON field (case-insensitive). Allows whitespace +
  // single or double quotes around the value.
  const toolNameMatch = chunk.match(/"tool[_-]?name"\s*:\s*"([^"]+)"/)
  if (toolNameMatch) {
    const matched = toolNameMatch[1].trim().toLowerCase()
    if ((GEMINI_INTERNAL_AGENT_TOOL_NAMES as readonly string[]).includes(matched)) {
      return {
        shouldWarn: true,
        reason: `Gemini emitted a tool_call for ${matched} while the user prompt expressed cross-provider intent.`
      }
    }
  }

  for (const phrase of GEMINI_INTERNAL_AGENT_PHRASES) {
    if (chunk.includes(phrase)) {
      return {
        shouldWarn: true,
        reason: `Gemini stdout matched internal-agent phrase "${phrase}" while the user prompt expressed cross-provider intent.`
      }
    }
  }

  return { shouldWarn: false }
}

/** Convenience: the canonical user-facing warning text. The renderer reads
 * this verbatim from the `provider_warning` event. */
export function crossProviderDelegationWarningMessage(): string {
  return (
    'This delegation used Gemini\'s internal agents (no AGBench sub-thread spawned). ' +
    'For cross-provider delegation to Kimi/Codex/Claude, the agent should call ' +
    'AGBench__delegate_to_subthread instead.'
  )
}
