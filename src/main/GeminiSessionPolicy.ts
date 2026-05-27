export interface GeminiCliResumePolicy {
  resumeSessionId?: string
  skippedReason?: string
}

export const GEMINI_WRITE_RESUME_SKIPPED_REASON =
  'Starting a fresh Gemini session because write-capable Gemini runs cannot safely resume CLI sessions; Gemini can persist plan-mode tool limits inside a resumed session.'

// 1.0.5-EW21 — Ensemble participants don't benefit from Gemini CLI
// session resume the way a solo iterative chat does. The
// orchestrator rebuilds full transcript context on every turn
// via `buildEnsembleParticipantPrompt`, so the conversation
// history is already in the prompt — the CLI session's role is
// just internal tool state. Worse, ensemble participants
// accumulate `linkedProviderSessionId` values that get tied to
// the cwd Gemini was spawned in; if anything about that cwd
// changes (EW17's isolated dir swap, or the user moving the
// project), the stored ID points at a session that no longer
// exists in the current storage location → exit 42 "Invalid
// session identifier".
export const GEMINI_ENSEMBLE_RESUME_SKIPPED_REASON =
  'Starting a fresh Gemini session because ensemble participants do not benefit from CLI session resume — the orchestrator includes full transcript context in every turn, and stale session ids can fail to resolve when the spawn cwd changes.'

/**
 * 1.0.5-EW21 — `isEnsembleRun` forces a fresh session regardless
 * of approval mode. Solo plan-mode Gemini keeps the existing
 * resume-when-possible behavior.
 */
export function resolveGeminiCliResumePolicy(
  effectiveApprovalMode: string,
  resumeSessionId?: string | null,
  isEnsembleRun: boolean = false
): GeminiCliResumePolicy {
  const sessionId =
    typeof resumeSessionId === 'string' && resumeSessionId.trim()
      ? resumeSessionId.trim()
      : undefined
  if (!sessionId) {
    return {}
  }

  if (isEnsembleRun) {
    return { skippedReason: GEMINI_ENSEMBLE_RESUME_SKIPPED_REASON }
  }

  if (effectiveApprovalMode === 'plan') {
    return { resumeSessionId: sessionId }
  }

  return { skippedReason: GEMINI_WRITE_RESUME_SKIPPED_REASON }
}
