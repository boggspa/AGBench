import { describe, expect, it } from 'vitest'

import {
  buildEditorPositionalArgs,
  findEditorById,
  findEditorByBundleId,
  isEditorId,
  listEditorAdapters,
  listEditorBundleIds
} from './EditorAdapters'

describe('EditorAdapters (Phase L)', () => {
  it('enumerates the curated editor list with VS Code, Cursor, Zed, Xcode, and the JetBrains family', () => {
    const ids = listEditorAdapters().map((a) => a.id)
    for (const expected of [
      'vscode',
      'vscode-insiders',
      'cursor',
      'zed',
      'sublime-text',
      'xcode',
      'bbedit',
      'nova',
      'textmate',
      'intellij-idea',
      'webstorm',
      'pycharm',
      'goland',
      'clion',
      'rider',
      'rubymine',
      'phpstorm',
      'android-studio'
    ]) {
      expect(ids).toContain(expected)
    }
  })

  it('listEditorBundleIds returns a deduplicated bundle id list', () => {
    const ids = listEditorBundleIds()
    expect(ids).toContain('com.microsoft.VSCode')
    expect(ids).toContain('com.todesktop.230313mzl4w4u92')
    expect(ids).toContain('com.apple.dt.Xcode')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('isEditorId narrows to the known id set', () => {
    expect(isEditorId('vscode')).toBe(true)
    expect(isEditorId('not-a-real-editor')).toBe(false)
    expect(isEditorId(undefined)).toBe(false)
  })

  it('findEditorByBundleId locates entries by any of their declared bundles', () => {
    expect(findEditorByBundleId('com.microsoft.VSCode')?.id).toBe('vscode')
    expect(findEditorByBundleId('com.sublimetext.4')?.id).toBe('sublime-text')
    // Sublime 3 still tracked alongside 4.
    expect(findEditorByBundleId('com.sublimetext.3')?.id).toBe('sublime-text')
    expect(findEditorByBundleId('com.apple.TextEdit')).toBeUndefined()
  })

  describe('buildEditorPositionalArgs', () => {
    it('formats VS Code / Cursor as `-g file:line:col`', () => {
      const vscode = findEditorById('vscode')!
      expect(buildEditorPositionalArgs(vscode, '/path/file.ts', 42, 5)).toEqual([
        '-g',
        '/path/file.ts:42:5'
      ])
      const cursor = findEditorById('cursor')!
      expect(buildEditorPositionalArgs(cursor, '/path/file.ts', 42, 5)).toEqual([
        '-g',
        '/path/file.ts:42:5'
      ])
    })

    it('formats Zed and Sublime as bare `file:line:col`', () => {
      const zed = findEditorById('zed')!
      expect(buildEditorPositionalArgs(zed, '/path/file.ts', 12, 4)).toEqual([
        '/path/file.ts:12:4'
      ])
      const sublime = findEditorById('sublime-text')!
      expect(buildEditorPositionalArgs(sublime, '/path/file.ts', 12, 4)).toEqual([
        '/path/file.ts:12:4'
      ])
    })

    it('formats Xcode as `-l <line> <file>` (no column)', () => {
      const xcode = findEditorById('xcode')!
      expect(buildEditorPositionalArgs(xcode, '/path/AppDelegate.swift', 88, 12)).toEqual([
        '-l',
        '88',
        '/path/AppDelegate.swift'
      ])
    })

    it('formats JetBrains family as --line --column <file>', () => {
      const intellij = findEditorById('intellij-idea')!
      expect(buildEditorPositionalArgs(intellij, '/path/Main.kt', 17, 9)).toEqual([
        '--line',
        '17',
        '--column',
        '9',
        '/path/Main.kt'
      ])
    })

    it('formats BBEdit / TextMate as `+<line> <file>` (column dropped)', () => {
      const bbedit = findEditorById('bbedit')!
      expect(buildEditorPositionalArgs(bbedit, '/x.txt', 99, 7)).toEqual(['+99', '/x.txt'])
      const textmate = findEditorById('textmate')!
      expect(buildEditorPositionalArgs(textmate, '/x.txt', 99, 7)).toEqual(['+99', '/x.txt'])
    })

    it('returns null for editors with no positional support', () => {
      const nova = findEditorById('nova')!
      expect(buildEditorPositionalArgs(nova, '/x.txt', 42, 1)).toBeNull()
    })

    it('defaults column to 1 when caller omits it (for editors that need a column)', () => {
      const vscode = findEditorById('vscode')!
      expect(buildEditorPositionalArgs(vscode, '/path/file.ts', 42)).toEqual([
        '-g',
        '/path/file.ts:42:1'
      ])
    })

    it('treats column <= 0 as missing (defaults to 1)', () => {
      const vscode = findEditorById('vscode')!
      expect(buildEditorPositionalArgs(vscode, '/path/file.ts', 42, 0)).toEqual([
        '-g',
        '/path/file.ts:42:1'
      ])
      expect(buildEditorPositionalArgs(vscode, '/path/file.ts', 42, -5)).toEqual([
        '-g',
        '/path/file.ts:42:1'
      ])
    })
  })
})
