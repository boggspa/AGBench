/**
 * M6 (1.0.7) — Ensemble thinking-ephemerality policy.
 *
 * Blueprint goal: a participant's *reasoning chain* (chain-of-thought /
 * thinking block) must not accumulate in the prompt context fed to FUTURE
 * rounds, except where a provider explicitly streams reasoning as durable
 * output (Codex). Claude / Gemini / Kimi / Grok / Cursor reasoning is
 * ephemeral by design and should be dropped from next-round context.
 *
 * Current state (verified 1.0.7): the ensemble transcript builder already only
 * carries `message.content`, and `ChatMessage` has no reasoning field — so
 * reasoning does NOT currently leak into future prompts. This module ENCODES
 * that as a tested invariant rather than leaving it accidental:
 *
 *   1. `shouldRetainReasoning(provider)` — the per-provider policy, the single
 *      source of truth for "does this provider's reasoning persist?".
 *   2. `stripReasoningChains(content, provider)` — a defensive guard applied in
 *      `buildTaggedTranscript`. Today it's a no-op for well-formed content
 *      (there are no reasoning fences in `.content`), but if a future provider
 *      adapter ever starts inlining a reasoning block into the persisted
 *      assistant message (a real risk as providers expose CoT), this guard
 *      removes it from the ephemeral providers' future-context transcript
 *      automatically — the invariant can't silently regress.
 *
 * Pure + dependency-free so the policy is exhaustively unit-testable.
 */
import type { ProviderId } from './store/types'

/**
 * Providers whose reasoning is durable output that SHOULD persist into future
 * round context. Codex streams its reasoning as a first-class part of its
 * answer; dropping it would lose content the panel legitimately referenced.
 * Everything else is ephemeral.
 */
const REASONING_DURABLE_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>(['codex'])

export function shouldRetainReasoning(provider: ProviderId | undefined): boolean {
  return provider !== undefined && REASONING_DURABLE_PROVIDERS.has(provider)
}

/**
 * Reasoning-fence patterns we defensively strip for ephemeral providers. These
 * are the common shapes a provider/adapter might use if it ever inlines a
 * thinking block into the persisted message content:
 *   - <think>…</think> / <thinking>…</thinking> (Kimi/DeepSeek-style tags)
 *   - <reasoning>…</reasoning>
 * Matched case-insensitively, across newlines, non-greedy so multiple blocks in
 * one message are each removed. Anchored to the tag names only — ordinary prose
 * that merely contains the word "thinking" is untouched.
 */
const REASONING_FENCE = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi

/**
 * Strip reasoning-fenced blocks from `content` UNLESS the authoring provider's
 * reasoning is durable (Codex). Collapses the blank lines a removed block
 * leaves behind so the transcript stays tidy. Returns the input unchanged when
 * retention applies or when there's nothing to strip — callers can rely on
 * reference equality to skip work.
 */
export function stripReasoningChains(content: string, provider: ProviderId | undefined): string {
  if (typeof content !== 'string' || content.length === 0) return content
  if (shouldRetainReasoning(provider)) return content
  if (!REASONING_FENCE.test(content)) {
    REASONING_FENCE.lastIndex = 0 // reset the stateful global regex
    return content
  }
  REASONING_FENCE.lastIndex = 0
  const stripped = content
    .replace(REASONING_FENCE, '')
    // Collapse 3+ newlines (left by a removed block) down to a paragraph break.
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return stripped
}
