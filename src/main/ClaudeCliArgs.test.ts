import { describe, it, expect } from 'vitest'
import {
  buildClaudeCliArgs,
  claudeFastModeSettingsArg,
  normalizeClaudeEffortFlag
} from './ClaudeCliArgs'

describe('normalizeClaudeEffortFlag', () => {
  it('returns null for nullish, empty, or off values', () => {
    expect(normalizeClaudeEffortFlag(null)).toBeNull()
    expect(normalizeClaudeEffortFlag(undefined)).toBeNull()
    expect(normalizeClaudeEffortFlag('')).toBeNull()
    expect(normalizeClaudeEffortFlag('off')).toBeNull()
    expect(normalizeClaudeEffortFlag('  ')).toBeNull()
  })

  it('passes through documented effort levels case-insensitively', () => {
    expect(normalizeClaudeEffortFlag('low')).toBe('low')
    expect(normalizeClaudeEffortFlag('Medium')).toBe('medium')
    expect(normalizeClaudeEffortFlag('HIGH')).toBe('high')
    expect(normalizeClaudeEffortFlag('xhigh')).toBe('xhigh')
    expect(normalizeClaudeEffortFlag('max')).toBe('max')
  })

  it('rejects unknown values rather than passing them to the CLI', () => {
    expect(normalizeClaudeEffortFlag('extreme')).toBeNull()
    expect(normalizeClaudeEffortFlag('123')).toBeNull()
  })
})

describe('buildClaudeCliArgs', () => {
  const base = {
    prompt: 'hello',
    permissionMode: 'default',
    model: 'default'
  }

  it('emits the baseline argv with required flags', () => {
    const args = buildClaudeCliArgs(base)
    expect(args).toEqual([
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      'default'
    ])
    expect(args).not.toContain('--budget-tokens')
    expect(args).not.toContain('--effort')
  })

  it('appends --model only when not the placeholder default', () => {
    const args = buildClaudeCliArgs({ ...base, model: 'claude-opus-4-7' })
    expect(args).toContain('--model')
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-4-7')
  })

  it('translates claudeReasoningEffort=high into --effort high (never --budget-tokens)', () => {
    const args = buildClaudeCliArgs({ ...base, claudeReasoningEffort: 'high' })
    const effortIndex = args.indexOf('--effort')
    expect(effortIndex).toBeGreaterThan(-1)
    expect(args[effortIndex + 1]).toBe('high')
    expect(args).not.toContain('--budget-tokens')
  })

  it('omits --effort when reasoning is off or missing', () => {
    expect(buildClaudeCliArgs({ ...base, claudeReasoningEffort: 'off' })).not.toContain('--effort')
    expect(buildClaudeCliArgs({ ...base, claudeReasoningEffort: null })).not.toContain('--effort')
    expect(buildClaudeCliArgs({ ...base })).not.toContain('--effort')
  })

  it('maps every documented effort level 1:1', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const args = buildClaudeCliArgs({ ...base, claudeReasoningEffort: effort })
      expect(args).toContain('--effort')
      expect(args[args.indexOf('--effort') + 1]).toBe(effort)
    }
  })

  it('appends --resume when a provider session id is supplied', () => {
    const args = buildClaudeCliArgs({ ...base, providerSessionId: 'sess-123' })
    expect(args).toContain('--resume')
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-123')
  })

  it('emits one --image flag per supplied image path in order', () => {
    const args = buildClaudeCliArgs({
      ...base,
      imagePaths: ['/tmp/a.png', '/tmp/b.png']
    })
    const imageFlags = args
      .map((value, index) => (value === '--image' ? args[index + 1] : null))
      .filter((value): value is string => value !== null)
    expect(imageFlags).toEqual(['/tmp/a.png', '/tmp/b.png'])
  })

  it('passes the permissionMode through verbatim', () => {
    const args = buildClaudeCliArgs({ ...base, permissionMode: 'acceptEdits' })
    const modeIndex = args.indexOf('--permission-mode')
    expect(args[modeIndex + 1]).toBe('acceptEdits')
  })

  it('passes Claude fast mode through --settings when enabled', () => {
    const args = buildClaudeCliArgs({ ...base, claudeFastMode: true })
    const settingsIndex = args.indexOf('--settings')
    expect(settingsIndex).toBeGreaterThan(-1)
    expect(args[settingsIndex + 1]).toBe('{"fastMode":true}')
  })

  it('passes Claude fast mode through --settings when disabled', () => {
    const args = buildClaudeCliArgs({ ...base, claudeFastMode: false })
    const settingsIndex = args.indexOf('--settings')
    expect(settingsIndex).toBeGreaterThan(-1)
    expect(args[settingsIndex + 1]).toBe('{"fastMode":false}')
  })

  it('omits Claude fast-mode settings when the renderer did not choose a value', () => {
    expect(buildClaudeCliArgs({ ...base })).not.toContain('--settings')
    expect(buildClaudeCliArgs({ ...base, claudeFastMode: null })).not.toContain('--settings')
  })
})

describe('claudeFastModeSettingsArg', () => {
  it('serializes boolean fast-mode settings for Claude Code', () => {
    expect(claudeFastModeSettingsArg(true)).toBe('{"fastMode":true}')
    expect(claudeFastModeSettingsArg(false)).toBe('{"fastMode":false}')
  })

  it('returns null for unset values', () => {
    expect(claudeFastModeSettingsArg(null)).toBeNull()
    expect(claudeFastModeSettingsArg(undefined)).toBeNull()
  })
})
