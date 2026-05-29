import { describe, it, expect } from 'vitest'
import { buildCursorCliArgs, cursorWriteCapable } from './CursorCliArgs'

describe('cursorWriteCapable', () => {
  it('is read-only for plan / empty / unset', () => {
    expect(cursorWriteCapable('plan')).toBe(false)
    expect(cursorWriteCapable('')).toBe(false)
    expect(cursorWriteCapable(null)).toBe(false)
    expect(cursorWriteCapable(undefined)).toBe(false)
  })
  it('is write-capable for any other mode', () => {
    expect(cursorWriteCapable('default')).toBe(true)
    expect(cursorWriteCapable('acceptEdits')).toBe(true)
  })
})

describe('buildCursorCliArgs', () => {
  const base = { prompt: 'do a thing', workspace: '/ws' }

  it('always uses headless stream-json with --trust + --workspace', () => {
    const args = buildCursorCliArgs(base)
    expect(args).toContain('-p')
    expect(args.join(' ')).toContain('--output-format stream-json')
    expect(args).toContain('--trust')
    expect(args.join(' ')).toContain('--workspace /ws')
    // prompt is the trailing positional
    expect(args[args.length - 1]).toBe('do a thing')
  })

  it('read-only mode passes --mode plan', () => {
    const args = buildCursorCliArgs({ ...base, approvalMode: 'plan' })
    expect(args.join(' ')).toContain('--mode plan')
  })

  it('write-capable mode omits --mode plan', () => {
    const args = buildCursorCliArgs({ ...base, approvalMode: 'acceptEdits' })
    expect(args).not.toContain('plan')
  })

  it('NEVER passes --force or --yolo (read-only OR write)', () => {
    for (const mode of ['plan', 'default', 'acceptEdits', '']) {
      const args = buildCursorCliArgs({ ...base, approvalMode: mode })
      expect(args).not.toContain('--force')
      expect(args).not.toContain('-f')
      expect(args).not.toContain('--yolo')
    }
  })

  it('forwards only Composer 2.5 model ids', () => {
    expect(buildCursorCliArgs({ ...base, model: 'composer-2.5' }).join(' ')).toContain('--model composer-2.5')
    expect(buildCursorCliArgs({ ...base, model: 'composer-2.5-fast' }).join(' ')).toContain('--model composer-2.5-fast')
  })

  it('drops non-Composer / sentinel / leaked model ids', () => {
    for (const m of ['gpt-5', 'cli-default', 'flash-lite', 'sonnet-4', '']) {
      expect(buildCursorCliArgs({ ...base, model: m })).not.toContain('--model')
    }
  })

  it('appends --resume for a real chat id, not for empty', () => {
    expect(buildCursorCliArgs({ ...base, providerSessionId: 'chat_123' }).join(' ')).toContain('--resume chat_123')
    expect(buildCursorCliArgs({ ...base, providerSessionId: '   ' })).not.toContain('--resume')
  })
})
