export interface GeminiCliResumePolicy {
  resumeSessionId?: string
  skippedReason?: string
}

export const GEMINI_WRITE_RESUME_SKIPPED_REASON =
  'Starting a fresh Gemini session because write-capable Gemini runs cannot safely resume CLI sessions; Gemini can persist plan-mode tool limits inside a resumed session.'

export function resolveGeminiCliResumePolicy(
  effectiveApprovalMode: string,
  resumeSessionId?: string | null
): GeminiCliResumePolicy {
  const sessionId =
    typeof resumeSessionId === 'string' && resumeSessionId.trim()
      ? resumeSessionId.trim()
      : undefined
  if (!sessionId) {
    return {}
  }

  if (effectiveApprovalMode === 'plan') {
    return { resumeSessionId: sessionId }
  }

  return { skippedReason: GEMINI_WRITE_RESUME_SKIPPED_REASON }
}
