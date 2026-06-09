import { describe, expect, it } from 'vitest'
import { resolveCanonicalWorkspaceId } from './WorkspaceIdentity'
import type { WorkspaceRecord } from './store/types'

function ws(overrides: Partial<WorkspaceRecord>): WorkspaceRecord {
  return {
    id: 'uuid-x',
    path: '/Users/x/proj',
    displayName: 'proj',
    createdAt: 1,
    lastOpenedAt: 1,
    pinned: false,
    ...overrides
  }
}

const WORKSPACES = [
  ws({ id: 'uuid-1', displayName: 'Test 1', path: '/Users/x/Test 1' }),
  ws({ id: 'uuid-2', displayName: 'Test 2', path: '/Users/x/Test 2' }),
  ws({ id: 'uuid-3', displayName: 'Dup', path: '/Users/x/dup-a' }),
  ws({ id: 'uuid-4', displayName: 'Dup', path: '/Users/x/dup-b' })
]

describe('resolveCanonicalWorkspaceId', () => {
  it('passes real ids through untouched', () => {
    expect(resolveCanonicalWorkspaceId('uuid-2', WORKSPACES)).toBe('uuid-2')
  })

  it('resolves legacy display-name ids when unambiguous', () => {
    expect(resolveCanonicalWorkspaceId('Test 1', WORKSPACES)).toBe('uuid-1')
    expect(resolveCanonicalWorkspaceId('  Test 2  ', WORKSPACES)).toBe('uuid-2')
  })

  it('refuses ambiguous display names', () => {
    expect(resolveCanonicalWorkspaceId('Dup', WORKSPACES)).toBeNull()
  })

  it('resolves path-form ids via the normalizer', () => {
    const normalize = (value: string): string => value.replace(/\/+$/, '')
    expect(resolveCanonicalWorkspaceId('/Users/x/Test 1/', WORKSPACES, normalize)).toBe('uuid-1')
  })

  it('returns null for unknown, empty, and nullish input', () => {
    expect(resolveCanonicalWorkspaceId('nope', WORKSPACES)).toBeNull()
    expect(resolveCanonicalWorkspaceId('', WORKSPACES)).toBeNull()
    expect(resolveCanonicalWorkspaceId('  ', WORKSPACES)).toBeNull()
    expect(resolveCanonicalWorkspaceId(null, WORKSPACES)).toBeNull()
    expect(resolveCanonicalWorkspaceId(undefined, WORKSPACES)).toBeNull()
  })

  it('survives a throwing normalizer', () => {
    const explosive = (): string => {
      throw new Error('boom')
    }
    expect(resolveCanonicalWorkspaceId('/Users/x/Test 1', WORKSPACES, explosive)).toBeNull()
  })
})
