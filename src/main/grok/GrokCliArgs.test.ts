import { describe, it, expect } from 'vitest'
import { buildGrokCliArgs, normalizeGrokEffortFlag, GROK_READ_ONLY_DENY_RULES } from './GrokCliArgs'

describe('normalizeGrokEffortFlag', () => {
  it('returns null for nullish, empty, or off values', () => {
    expect(normalizeGrokEffortFlag(null)).toBeNull()
    expect(normalizeGrokEffortFlag(undefined)).toBeNull()
    expect(normalizeGrokEffortFlag('')).toBeNull()
    expect(normalizeGrokEffortFlag('off')).toBeNull()
  })

  it('passes through documented effort levels case-insensitively', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(normalizeGrokEffortFlag(level)).toBe(level)
    }
    expect(normalizeGrokEffortFlag('HIGH')).toBe('high')
  })

  it('rejects unknown values rather than passing them to the CLI', () => {
    expect(normalizeGrokEffortFlag('extreme')).toBeNull()
    expect(normalizeGrokEffortFlag('123')).toBeNull()
  })
})

describe('buildGrokCliArgs', () => {
  const base = { prompt: 'explain this repo', workspace: '/tmp/ws' }

  it('emits the read-only baseline argv', () => {
    const args = buildGrokCliArgs(base)
    expect(args).toEqual([
      '--no-auto-update',
      '-p',
      'explain this repo',
      '--cwd',
      '/tmp/ws',
      '--output-format',
      'streaming-json',
      '--permission-mode',
      'plan',
      '--disable-web-search',
      '--deny',
      'Bash(*)',
      '--deny',
      'Edit(*)',
      '--deny',
      'Write(*)'
    ])
  })

  it('always pins permission-mode to plan (never a write mode)', () => {
    const args = buildGrokCliArgs(base)
    const modeIndex = args.indexOf('--permission-mode')
    expect(args[modeIndex + 1]).toBe('plan')
    expect(args).not.toContain('acceptEdits')
    expect(args).not.toContain('auto')
    expect(args).not.toContain('dontAsk')
    expect(args).not.toContain('bypassPermissions')
  })

  it('NEVER emits --always-approve', () => {
    expect(buildGrokCliArgs(base)).not.toContain('--always-approve')
    expect(
      buildGrokCliArgs({ ...base, model: 'grok-code-fast-1', reasoningEffort: 'high' })
    ).not.toContain('--always-approve')
  })

  it('denies the write/shell/edit tools to keep the run read-only', () => {
    const args = buildGrokCliArgs(base)
    const denied = args
      .map((value, index) => (value === '--deny' ? args[index + 1] : null))
      .filter((value): value is string => value !== null)
    expect(denied).toEqual([...GROK_READ_ONLY_DENY_RULES])
  })

  it('disables web search for hermeticity', () => {
    expect(buildGrokCliArgs(base)).toContain('--disable-web-search')
  })

  it('appends --model only when not a default placeholder', () => {
    expect(buildGrokCliArgs(base)).not.toContain('--model')
    expect(buildGrokCliArgs({ ...base, model: 'default' })).not.toContain('--model')
    expect(buildGrokCliArgs({ ...base, model: 'cli-default' })).not.toContain('--model')
    const args = buildGrokCliArgs({ ...base, model: 'grok-code-fast-1' })
    expect(args[args.indexOf('--model') + 1]).toBe('grok-code-fast-1')
  })

  it('maps reasoning effort onto --effort only for documented levels', () => {
    const args = buildGrokCliArgs({ ...base, reasoningEffort: 'high' })
    expect(args[args.indexOf('--effort') + 1]).toBe('high')
    expect(buildGrokCliArgs({ ...base, reasoningEffort: 'off' })).not.toContain('--effort')
    expect(buildGrokCliArgs({ ...base, reasoningEffort: 'bogus' })).not.toContain('--effort')
  })
})
