import { describe, expect, it } from 'vitest'
import {
  GEMINI_ENSEMBLE_RESUME_SKIPPED_REASON,
  GEMINI_WRITE_RESUME_SKIPPED_REASON,
  resolveGeminiCliResumePolicy
} from './GeminiSessionPolicy'

describe('GeminiSessionPolicy', () => {
  it('allows resume only for explicit plan mode sessions', () => {
    expect(resolveGeminiCliResumePolicy('plan', 'session-1')).toEqual({
      resumeSessionId: 'session-1'
    })
  })

  it('forces write-capable Gemini modes to start fresh', () => {
    expect(resolveGeminiCliResumePolicy('default', 'session-1')).toEqual({
      skippedReason: GEMINI_WRITE_RESUME_SKIPPED_REASON
    })
    expect(resolveGeminiCliResumePolicy('auto_edit', 'session-1')).toEqual({
      skippedReason: GEMINI_WRITE_RESUME_SKIPPED_REASON
    })
  })

  it('does not warn when there is no resume target', () => {
    expect(resolveGeminiCliResumePolicy('default', null)).toEqual({})
    expect(resolveGeminiCliResumePolicy('default', '')).toEqual({})
  })

  it('1.0.5-EW21: ensemble runs always start fresh regardless of approval mode', () => {
    // Regression: pre-EW21, ensemble participants that stored a
    // `linkedProviderSessionId` from an earlier turn would try to
    // resume that id on the next turn. If the spawn cwd had
    // changed in the meantime (EW17 swap, project move, etc.)
    // Gemini couldn't find the session and exited 42 "Invalid
    // session identifier". The orchestrator already supplies full
    // transcript context every turn so resume is redundant for
    // ensemble; always start fresh.
    expect(resolveGeminiCliResumePolicy('plan', 'session-1', true)).toEqual({
      skippedReason: GEMINI_ENSEMBLE_RESUME_SKIPPED_REASON
    })
    expect(resolveGeminiCliResumePolicy('default', 'session-1', true)).toEqual({
      skippedReason: GEMINI_ENSEMBLE_RESUME_SKIPPED_REASON
    })
    expect(resolveGeminiCliResumePolicy('auto_edit', 'session-1', true)).toEqual({
      skippedReason: GEMINI_ENSEMBLE_RESUME_SKIPPED_REASON
    })
  })

  it('1.0.5-EW21: ensemble flag still no-ops when there is no resume target', () => {
    // No session id means there's nothing to skip — the policy
    // returns the empty shape and the caller never emits a
    // "starting fresh" warning. Same as the solo no-resume case.
    expect(resolveGeminiCliResumePolicy('plan', null, true)).toEqual({})
    expect(resolveGeminiCliResumePolicy('default', '', true)).toEqual({})
  })
})
