import { describe, it, expect } from 'vitest'
import { detectExternalPath } from './ExternalPathDetector'

describe('detectExternalPath', () => {
  it('returns needsPrompt=true for read_file outside the workspace', () => {
    const result = detectExternalPath({
      toolName: 'read_file',
      params: { path: '/etc/hosts' },
      workspacePath: '/Users/me/code/proj'
    })
    expect(result).toEqual({
      needsPrompt: true,
      path: '/etc/hosts',
      access: 'read',
      basename: 'hosts'
    })
  })

  it('returns needsPrompt=true for write_file outside the workspace', () => {
    const result = detectExternalPath({
      toolName: 'write_file',
      params: { file_path: '/tmp/outside.txt' },
      workspacePath: '/Users/me/code/proj'
    })
    expect(result).toEqual({
      needsPrompt: true,
      path: '/tmp/outside.txt',
      access: 'write',
      basename: 'outside.txt'
    })
  })

  it('returns needsPrompt=false for read_file INSIDE the workspace', () => {
    expect(
      detectExternalPath({
        toolName: 'read_file',
        params: { path: '/Users/me/code/proj/src/foo.ts' },
        workspacePath: '/Users/me/code/proj'
      })
    ).toEqual({ needsPrompt: false })
  })

  it('returns needsPrompt=false for non-file-IO tools (e.g. shell)', () => {
    expect(
      detectExternalPath({
        toolName: 'run_shell_command',
        params: { command: 'ls /tmp' },
        workspacePath: '/Users/me/code/proj'
      })
    ).toEqual({ needsPrompt: false })
  })

  it('returns needsPrompt=false when params has no recognised path field', () => {
    expect(
      detectExternalPath({
        toolName: 'read_file',
        params: { query: '/etc/hosts' },
        workspacePath: '/Users/me/code/proj'
      })
    ).toEqual({ needsPrompt: false })
  })

  it('returns needsPrompt=false for relative paths (we only flag absolute)', () => {
    expect(
      detectExternalPath({
        toolName: 'read_file',
        params: { path: '../outside/file.ts' },
        workspacePath: '/Users/me/code/proj'
      })
    ).toEqual({ needsPrompt: false })
  })

  it('respects existing grants — read covered by read grant', () => {
    expect(
      detectExternalPath({
        toolName: 'read_file',
        params: { path: '/etc/hosts' },
        workspacePath: '/Users/me/code/proj',
        existingGrants: [{ path: '/etc/hosts', access: 'read' }]
      })
    ).toEqual({ needsPrompt: false })
  })

  it('respects existing grants — write covered by write grant on same path', () => {
    expect(
      detectExternalPath({
        toolName: 'write_file',
        params: { file_path: '/tmp/outside.txt' },
        workspacePath: '/Users/me/code/proj',
        existingGrants: [{ path: '/tmp/outside.txt', access: 'write' }]
      })
    ).toEqual({ needsPrompt: false })
  })

  it('write request NOT covered by read-only grant', () => {
    const result = detectExternalPath({
      toolName: 'write_file',
      params: { file_path: '/tmp/outside.txt' },
      workspacePath: '/Users/me/code/proj',
      existingGrants: [{ path: '/tmp/outside.txt', access: 'read' }]
    })
    expect(result.needsPrompt).toBe(true)
    expect(result.access).toBe('write')
  })

  it('respects directory-level grants — read inside granted directory', () => {
    expect(
      detectExternalPath({
        toolName: 'read_file',
        params: { path: '/Users/me/Other/proj/src/foo.ts' },
        workspacePath: '/Users/me/code/proj',
        existingGrants: [{ path: '/Users/me/Other/proj', access: 'read' }]
      })
    ).toEqual({ needsPrompt: false })
  })

  it('strips mcp__server__ tool prefix before category lookup', () => {
    expect(
      detectExternalPath({
        toolName: 'mcp__filesystem__read_file',
        params: { path: '/etc/hosts' },
        workspacePath: '/Users/me/code/proj'
      })
    ).toEqual({
      needsPrompt: true,
      path: '/etc/hosts',
      access: 'read',
      basename: 'hosts'
    })
  })

  it('global chat (no workspace) treats every path as external', () => {
    expect(
      detectExternalPath({
        toolName: 'read_file',
        params: { path: '/Users/me/anything.txt' },
        workspacePath: undefined
      })
    ).toEqual({
      needsPrompt: true,
      path: '/Users/me/anything.txt',
      access: 'read',
      basename: 'anything.txt'
    })
  })

  it('does not false-positive on sibling-prefix workspaces', () => {
    // `/Users/me/proj-2` should NOT be considered inside `/Users/me/proj`
    expect(
      detectExternalPath({
        toolName: 'read_file',
        params: { path: '/Users/me/proj-2/src/foo.ts' },
        workspacePath: '/Users/me/proj'
      })
    ).toEqual({
      needsPrompt: true,
      path: '/Users/me/proj-2/src/foo.ts',
      access: 'read',
      basename: 'foo.ts'
    })
  })
})
