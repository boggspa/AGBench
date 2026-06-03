import { describe, it, expect } from 'vitest'
import {
  buildGrokCliArgs,
  normalizeGrokEffortFlag,
  grokWriteCapable,
  GROK_READ_ONLY_DENY_RULES,
  GROK_WRITE_MODE_DENY_RULES
} from './GrokCliArgs'

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

  it('forwards --model only for genuine Grok model ids', () => {
    expect(buildGrokCliArgs(base)).not.toContain('--model')
    expect(buildGrokCliArgs({ ...base, model: 'default' })).not.toContain('--model')
    expect(buildGrokCliArgs({ ...base, model: 'cli-default' })).not.toContain('--model')
    // Regression guard (G3e): a model id carried over from another provider's
    // picker (e.g. Gemini's 'flash-lite') must NOT be forwarded — Grok rejects
    // unknown ids and the run fails with "unknown model id".
    expect(buildGrokCliArgs({ ...base, model: 'flash-lite' })).not.toContain('--model')
    expect(buildGrokCliArgs({ ...base, model: 'claude-opus-4-7' })).not.toContain('--model')
    const args = buildGrokCliArgs({ ...base, model: 'grok-code-fast-1' })
    expect(args[args.indexOf('--model') + 1]).toBe('grok-code-fast-1')
  })

  it('maps reasoning effort onto --effort only for documented levels', () => {
    const args = buildGrokCliArgs({ ...base, reasoningEffort: 'high' })
    expect(args[args.indexOf('--effort') + 1]).toBe('high')
    expect(buildGrokCliArgs({ ...base, reasoningEffort: 'off' })).not.toContain('--effort')
    expect(buildGrokCliArgs({ ...base, reasoningEffort: 'bogus' })).not.toContain('--effort')
  })

  it('G6 — resumes a prior session via --resume only when an id is present', () => {
    // Fresh chat (no id): no --resume → a new session is started.
    expect(buildGrokCliArgs(base)).not.toContain('--resume')
    expect(buildGrokCliArgs({ ...base, providerSessionId: null })).not.toContain('--resume')
    expect(buildGrokCliArgs({ ...base, providerSessionId: '' })).not.toContain('--resume')
    expect(buildGrokCliArgs({ ...base, providerSessionId: '   ' })).not.toContain('--resume')
    // Follow-up turn: resume the captured session by id.
    const args = buildGrokCliArgs({ ...base, providerSessionId: 'sess_abc123' })
    expect(args[args.indexOf('--resume') + 1]).toBe('sess_abc123')
  })

  it('G6 — resume stays read-only (still plan mode, still denies writes)', () => {
    const args = buildGrokCliArgs({ ...base, providerSessionId: 'sess_abc123' })
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan')
    expect(args).toContain('Bash(*)')
    expect(args).not.toContain('--always-approve')
  })

  it('G5c — read-only when approvalMode is plan / unset', () => {
    for (const approvalMode of [undefined, null, '', '   ', 'plan']) {
      const args = buildGrokCliArgs({ ...base, approvalMode })
      expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan')
      // All three write/shell tools denied.
      expect(args).toContain('Edit(*)')
      expect(args).toContain('Write(*)')
      expect(args).toContain('Bash(*)')
    }
  })

  it('G5c — file-write mode (non-plan): acceptEdits, Edit/Write allowed, Bash still denied', () => {
    const args = buildGrokCliArgs({ ...base, approvalMode: 'default' })
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
    // Edit/Write are NO LONGER denied (they're applied + diff-reviewed).
    expect(args).not.toContain('Edit(*)')
    expect(args).not.toContain('Write(*)')
    // Native shell stays denied — AGBench can't mediate Grok's Bash headless.
    const denied = args
      .map((value, index) => (value === '--deny' ? args[index + 1] : null))
      .filter((value): value is string => value !== null)
    expect(denied).toEqual([...GROK_WRITE_MODE_DENY_RULES])
    expect(denied).toEqual(['Bash(*)'])
  })

  it('G5c — write mode NEVER emits --always-approve (no auto-approve escape hatch)', () => {
    expect(buildGrokCliArgs({ ...base, approvalMode: 'default' })).not.toContain('--always-approve')
    expect(buildGrokCliArgs({ ...base, approvalMode: 'acceptEdits' })).not.toContain(
      '--always-approve'
    )
    expect(buildGrokCliArgs({ ...base, approvalMode: 'auto' })).not.toContain('--always-approve')
  })

  it('G5c — write mode composes with resume + model', () => {
    const args = buildGrokCliArgs({
      ...base,
      approvalMode: 'default',
      providerSessionId: 'sess_x',
      model: 'grok-code-fast-1'
    })
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
    expect(args[args.indexOf('--resume') + 1]).toBe('sess_x')
    expect(args[args.indexOf('--model') + 1]).toBe('grok-code-fast-1')
  })
})

describe('grokWriteCapable', () => {
  it('is false for read-only (plan / empty / nullish), true otherwise', () => {
    expect(grokWriteCapable(undefined)).toBe(false)
    expect(grokWriteCapable(null)).toBe(false)
    expect(grokWriteCapable('')).toBe(false)
    expect(grokWriteCapable('   ')).toBe(false)
    expect(grokWriteCapable('plan')).toBe(false)
    expect(grokWriteCapable('default')).toBe(true)
    expect(grokWriteCapable('acceptEdits')).toBe(true)
    expect(grokWriteCapable('auto')).toBe(true)
  })

  it('treats whitespace-padded plan as READ-ONLY (resume posture regression guard)', () => {
    expect(grokWriteCapable('plan ')).toBe(false)
    expect(grokWriteCapable(' plan')).toBe(false)
    expect(grokWriteCapable('\tplan\n')).toBe(false)
  })
})
