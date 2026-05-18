import { describe, expect, it } from 'vitest'
import {
  AUTO_RESUME_CONTINUATION_KIND,
  buildAutoResumeContinuationPrompt,
  shouldAutoResumeParent
} from './AutoResumeParent'

describe('shouldAutoResumeParent', () => {
  const happyPath = {
    setting: true,
    returnResultToParent: true,
    parentChatExists: true,
    parentChatIsRunning: false,
    parentChatHasProvider: true
  }

  it('returns true when all conditions hold (happy path)', () => {
    expect(shouldAutoResumeParent(happyPath)).toBe(true)
  })

  it('returns false when the setting is disabled', () => {
    expect(shouldAutoResumeParent({ ...happyPath, setting: false })).toBe(false)
  })

  it('returns false when returnResultToParent is false', () => {
    expect(shouldAutoResumeParent({ ...happyPath, returnResultToParent: false })).toBe(false)
  })

  it('returns false when the parent chat no longer exists', () => {
    expect(shouldAutoResumeParent({ ...happyPath, parentChatExists: false })).toBe(false)
  })

  it('returns false when the parent chat is currently running', () => {
    expect(shouldAutoResumeParent({ ...happyPath, parentChatIsRunning: true })).toBe(false)
  })

  it('returns false when the parent chat has no provider id', () => {
    expect(shouldAutoResumeParent({ ...happyPath, parentChatHasProvider: false })).toBe(false)
  })

  it('returns false when every condition is negated at once', () => {
    expect(
      shouldAutoResumeParent({
        setting: false,
        returnResultToParent: false,
        parentChatExists: false,
        parentChatIsRunning: true,
        parentChatHasProvider: false
      })
    ).toBe(false)
  })
})

describe('buildAutoResumeContinuationPrompt', () => {
  it('embeds the sub-thread title verbatim when provided', () => {
    const prompt = buildAutoResumeContinuationPrompt('Audit auth flow')
    expect(prompt).toContain('"Audit auth flow"')
    expect(prompt).toContain('has just completed')
    expect(prompt).toContain('Continue with the task')
  })

  it('falls back to "untitled" when the title is empty or whitespace', () => {
    expect(buildAutoResumeContinuationPrompt('')).toContain('"untitled"')
    expect(buildAutoResumeContinuationPrompt('   ')).toContain('"untitled"')
  })

  it('does not duplicate the sub-thread payload in the prompt body', () => {
    // Sanity check that the wording stays a hand-off note, not a
    // restatement of the result (the result lives in the synthetic
    // system message that sits immediately above this prompt).
    const prompt = buildAutoResumeContinuationPrompt('Title')
    expect(prompt.length).toBeLessThan(400)
  })
})

describe('AUTO_RESUME_CONTINUATION_KIND', () => {
  it('is a stable string the renderer can pattern-match on', () => {
    expect(AUTO_RESUME_CONTINUATION_KIND).toBe('autoResumeContinuation')
  })
})
