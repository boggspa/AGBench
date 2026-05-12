import { describe, expect, it } from 'vitest'
import { GEMINI_WRITE_RESUME_SKIPPED_REASON, resolveGeminiCliResumePolicy } from './GeminiSessionPolicy'

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
})
