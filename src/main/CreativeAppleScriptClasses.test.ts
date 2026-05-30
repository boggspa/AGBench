import { describe, expect, it } from 'vitest'

import {
  APPLESCRIPT_CLASSES,
  escapeAppleScriptString,
  findAppleScriptClass,
  formatAppleScriptClassName
} from './CreativeAppleScriptClasses'

describe('CreativeAppleScriptClasses (K4)', () => {
  it('exposes a stable set of named classes across FCP + Logic', () => {
    const ids = APPLESCRIPT_CLASSES.map((c) => c.id).sort()
    expect(ids).toContain('fcp.open-project')
    expect(ids).toContain('fcp.set-playhead')
    expect(ids).toContain('fcp.export-current')
    expect(ids).toContain('logic.open-project')
    expect(ids).toContain('logic.set-tempo')
  })

  it('formatAppleScriptClassName namespaces class ids under applescript:', () => {
    expect(formatAppleScriptClassName('fcp.open-project')).toBe('applescript:fcp.open-project')
    expect(formatAppleScriptClassName('raw')).toBe('applescript:raw')
  })

  describe('escapeAppleScriptString', () => {
    it('escapes backslashes and double-quotes', () => {
      expect(escapeAppleScriptString('hello "world"')).toBe('hello \\"world\\"')
      expect(escapeAppleScriptString('path\\with\\backslashes')).toBe('path\\\\with\\\\backslashes')
    })
    it('passes other characters through', () => {
      expect(escapeAppleScriptString("it's a 'test'")).toBe("it's a 'test'")
      expect(escapeAppleScriptString('newlines\nstay\nnewlines')).toBe('newlines\nstay\nnewlines')
    })
  })

  describe('fcp.open-project', () => {
    it('rejects relative paths via validate', () => {
      const entry = findAppleScriptClass('fcp.open-project')!
      const errors = entry.params
        .map((p) => p.validate?.('relative/path.fcpx'))
        .filter((e): e is string => Boolean(e))
      expect(errors).toContain('projectPath must be an absolute path starting with /')
    })
    it('accepts absolute paths', () => {
      const entry = findAppleScriptClass('fcp.open-project')!
      expect(entry.params[0].validate?.('/Users/dev/edit.fcpx')).toBeNull()
    })
    it('builds a script that targets Final Cut Pro and escapes the path', () => {
      const entry = findAppleScriptClass('fcp.open-project')!
      const source = entry.build({ projectPath: '/path/with "quotes"/edit.fcpx' })
      expect(source).toContain('tell application "Final Cut Pro"')
      expect(source).toContain('activate')
      expect(source).toContain('\\"quotes\\"')
    })
  })

  describe('fcp.set-playhead', () => {
    it('validates timecode shape', () => {
      const entry = findAppleScriptClass('fcp.set-playhead')!
      expect(entry.params[0].validate?.('00:01:23:15')).toBeNull()
      expect(entry.params[0].validate?.('0:1:23:15')).toBe('timecode must be in HH:MM:SS:FF format')
      expect(entry.params[0].validate?.('not-timecode')).toBe(
        'timecode must be in HH:MM:SS:FF format'
      )
    })
    it('builds a System Events keystroke chain', () => {
      const entry = findAppleScriptClass('fcp.set-playhead')!
      const source = entry.build({ timecode: '00:01:23:15' })
      expect(source).toContain('System Events')
      expect(source).toContain('keystroke "=" using {command down}')
      expect(source).toContain('keystroke "00:01:23:15"')
    })
  })

  describe('logic.set-tempo', () => {
    it('validates BPM range', () => {
      const entry = findAppleScriptClass('logic.set-tempo')!
      expect(entry.params[0].validate?.('120')).toBeNull()
      expect(entry.params[0].validate?.('0')).toContain('between 1 and 999')
      expect(entry.params[0].validate?.('1500')).toContain('between 1 and 999')
      expect(entry.params[0].validate?.('not-a-number')).toContain('between 1 and 999')
    })
  })

  it('findAppleScriptClass returns undefined for unknown ids', () => {
    expect(findAppleScriptClass('nonsense.class')).toBeUndefined()
  })

  it('every class declares an apple-creative bundle id', () => {
    const allowedBundles = new Set(['com.apple.FinalCut', 'com.apple.logic10'])
    for (const entry of APPLESCRIPT_CLASSES) {
      expect(allowedBundles.has(entry.targetBundleId)).toBe(true)
    }
  })
})
