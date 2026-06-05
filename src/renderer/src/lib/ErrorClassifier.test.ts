import { describe, it, expect } from 'vitest'
import { classifyError, redactLog } from './ErrorClassifier'

describe('ErrorClassifier', () => {
  it('detects model capacity exhausted (429)', () => {
    expect(classifyError('Attempt 1 failed with status 429. Retrying with backoff...')).toBe(
      'model_capacity_exhausted'
    )
    expect(
      classifyError('No capacity available for model gemini-3.1-pro-preview on the server')
    ).toBe('model_capacity_exhausted')
    expect(classifyError('status: RESOURCE_EXHAUSTED\nreason: MODEL_CAPACITY_EXHAUSTED')).toBe(
      'model_capacity_exhausted'
    )
  })

  it('detects missing cli', () => {
    expect(classifyError('/bin/sh: line 1: gemini: command not found')).toBe('missing_cli')
    expect(classifyError('spawn gemini ENOENT')).toBe('missing_cli')
  })

  it('detects untrusted workspace', () => {
    expect(classifyError('FatalUntrustedWorkspaceError: Directory is not trusted')).toBe(
      'untrusted_workspace'
    )
  })

  it('redacts logs correctly', () => {
    expect(redactLog('My email is test@example.com.')).toBe('My email is [EMAIL REDACTED].')
    expect(redactLog('Bearer abcdef12345==')).toBe('Bearer [REDACTED]')
    expect(redactLog('Path is /Users/example/Documents/TaskWraith/src')).toBe(
      'Path is ~/Documents/TaskWraith/src'
    )
  })
})
