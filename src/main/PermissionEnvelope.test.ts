import { describe, expect, it } from 'vitest'

import {
  clampEnvelopeToParent,
  clampExpiry,
  derivePermissionEnvelope,
  intersectGrants,
  isEnvelopeExpired,
  isHostAllowedByEnvelope,
  isPathAllowedByEnvelope,
  isToolAllowedByEnvelope,
  READ_ONLY_TOOL_PRESET,
  walkActorChain
} from './PermissionEnvelope'
import type { PermissionEnvelope } from './store/types'

const NOW = '2026-05-27T22:00:00.000Z'

function envelope(overrides: Partial<PermissionEnvelope> = {}): PermissionEnvelope {
  return {
    envelopeId: 'env-1',
    parentRunId: 'run-parent',
    purpose: 'test envelope',
    allowedTools: [],
    fileReadScope: [],
    fileWriteScope: [],
    networkScope: [],
    redactionPatterns: [],
    createdAt: NOW,
    ...overrides
  }
}

describe('READ_ONLY_TOOL_PRESET', () => {
  it('contains non-mutating tools only', () => {
    // Sanity-check: no obvious mutators in the preset.
    expect(READ_ONLY_TOOL_PRESET).not.toContain('write_file')
    expect(READ_ONLY_TOOL_PRESET).not.toContain('apply_patch')
    expect(READ_ONLY_TOOL_PRESET).not.toContain('run_shell')
    expect(READ_ONLY_TOOL_PRESET).toContain('read_file')
    expect(READ_ONLY_TOOL_PRESET).toContain('list_directory')
    expect(READ_ONLY_TOOL_PRESET).toContain('grep')
  })
})

describe('derivePermissionEnvelope', () => {
  const counter = { n: 0 }
  function envelopeIdFor(): string {
    counter.n++
    return `env-derived-${counter.n}`
  }

  it('defaults child to read-only tool preset when request is empty', () => {
    const child = derivePermissionEnvelope({
      parentRunId: 'run-parent',
      purpose: 'cross-check the auth fix',
      request: {},
      nowIso: NOW,
      envelopeIdFor
    })
    expect(child.allowedTools).toEqual([...READ_ONLY_TOOL_PRESET])
  })

  it('defaults file write scope to empty (no writes without opt-in)', () => {
    const child = derivePermissionEnvelope({
      parentRunId: 'run-parent',
      purpose: 'p',
      request: {},
      nowIso: NOW,
      envelopeIdFor
    })
    expect(child.fileWriteScope).toEqual([])
  })

  it('defaults network scope to empty', () => {
    const child = derivePermissionEnvelope({
      parentRunId: 'run-parent',
      purpose: 'p',
      request: {},
      nowIso: NOW,
      envelopeIdFor
    })
    expect(child.networkScope).toEqual([])
  })

  it('inherits parent read scope when request omits fileReadScope', () => {
    const parent = envelope({ fileReadScope: ['/repo/'] })
    const child = derivePermissionEnvelope({
      parentRunId: 'run-parent',
      parentEnvelope: parent,
      purpose: 'p',
      request: {},
      nowIso: NOW,
      envelopeIdFor
    })
    expect(child.fileReadScope).toEqual(['/repo/'])
  })

  it('uses explicit request fields when supplied', () => {
    const child = derivePermissionEnvelope({
      parentRunId: 'run-parent',
      purpose: 'p',
      request: {
        allowedTools: ['custom_tool'],
        fileReadScope: ['/x/'],
        fileWriteScope: ['/y/'],
        networkScope: ['api.example.com'],
        expiry: '2026-05-27T23:00:00Z',
        redactionPatterns: ['secret123']
      },
      nowIso: NOW,
      envelopeIdFor
    })
    expect(child.allowedTools).toEqual(['custom_tool'])
    expect(child.fileReadScope).toEqual(['/x/'])
    expect(child.fileWriteScope).toEqual(['/y/'])
    expect(child.networkScope).toEqual(['api.example.com'])
    expect(child.expiry).toBe('2026-05-27T23:00:00Z')
    expect(child.redactionPatterns).toEqual(['secret123'])
  })

  it('merges redaction patterns from parent + request (deduplicated)', () => {
    const parent = envelope({ redactionPatterns: ['parentSecret'] })
    const child = derivePermissionEnvelope({
      parentRunId: 'run-parent',
      parentEnvelope: parent,
      purpose: 'p',
      request: { redactionPatterns: ['childSecret', 'parentSecret'] },
      nowIso: NOW,
      envelopeIdFor
    })
    expect(child.redactionPatterns).toEqual(['parentSecret', 'childSecret'])
  })

  it('records parentEnvelopeId when a parent envelope is supplied', () => {
    const parent = envelope({ envelopeId: 'env-parent' })
    const child = derivePermissionEnvelope({
      parentRunId: 'run-parent',
      parentEnvelope: parent,
      purpose: 'p',
      request: {},
      nowIso: NOW,
      envelopeIdFor
    })
    expect(child.parentEnvelopeId).toBe('env-parent')
  })

  it('clamps child grants to parent grants (child cannot exceed)', () => {
    const parent = envelope({
      allowedTools: ['read_file', 'grep'],
      fileWriteScope: ['/repo/docs/']
    })
    const child = derivePermissionEnvelope({
      parentRunId: 'run-parent',
      parentEnvelope: parent,
      purpose: 'p',
      request: {
        allowedTools: ['read_file', 'apply_patch'], // apply_patch NOT in parent
        fileWriteScope: ['/repo/docs/', '/etc/passwd'] // /etc not in parent
      },
      nowIso: NOW,
      envelopeIdFor
    })
    expect(child.allowedTools).toEqual(['read_file']) // apply_patch dropped
    expect(child.fileWriteScope).toEqual(['/repo/docs/']) // /etc/passwd dropped
  })

  it('parent wildcard means anything in the child survives', () => {
    const parent = envelope({ allowedTools: ['*'] })
    const child = derivePermissionEnvelope({
      parentRunId: 'run-parent',
      parentEnvelope: parent,
      purpose: 'p',
      request: { allowedTools: ['read_file', 'apply_patch', 'run_shell'] },
      nowIso: NOW,
      envelopeIdFor
    })
    expect(child.allowedTools).toEqual(['read_file', 'apply_patch', 'run_shell'])
  })
})

describe('intersectGrants', () => {
  it('keeps only entries present in both', () => {
    expect(intersectGrants(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['b', 'c'])
  })

  it("treats parent's '*' as unrestricted", () => {
    expect(intersectGrants(['a', 'b'], ['*'])).toEqual(['a', 'b'])
  })

  it('returns empty when parent has none', () => {
    expect(intersectGrants(['a', 'b'], [])).toEqual([])
  })

  it('returns empty when child has none', () => {
    expect(intersectGrants([], ['a', 'b'])).toEqual([])
  })
})

describe('clampExpiry', () => {
  const T_EARLY = '2026-05-27T22:30:00Z'
  const T_LATE = '2026-05-27T23:30:00Z'

  it('returns the earlier of two expirys', () => {
    expect(clampExpiry(T_LATE, T_EARLY)).toBe(T_EARLY)
    expect(clampExpiry(T_EARLY, T_LATE)).toBe(T_EARLY)
  })

  it('returns the defined one when only one is set', () => {
    expect(clampExpiry(undefined, T_EARLY)).toBe(T_EARLY)
    expect(clampExpiry(T_EARLY, undefined)).toBe(T_EARLY)
  })

  it('returns undefined when both unset', () => {
    expect(clampExpiry(undefined, undefined)).toBeUndefined()
  })
})

describe('isEnvelopeExpired', () => {
  it('returns false when no expiry is set', () => {
    expect(isEnvelopeExpired(envelope(), NOW)).toBe(false)
  })

  it('returns false when nowIso is before expiry', () => {
    expect(
      isEnvelopeExpired(envelope({ expiry: '2026-05-27T23:00:00Z' }), '2026-05-27T22:00:00Z')
    ).toBe(false)
  })

  it('returns true when nowIso is after expiry', () => {
    expect(
      isEnvelopeExpired(envelope({ expiry: '2026-05-27T22:00:00Z' }), '2026-05-27T23:00:00Z')
    ).toBe(true)
  })

  it('treats malformed expiry as expired (fail-closed)', () => {
    expect(isEnvelopeExpired(envelope({ expiry: 'not-a-date' }), NOW)).toBe(true)
  })
})

describe('isToolAllowedByEnvelope', () => {
  it('returns true for explicitly allowed tools', () => {
    const env = envelope({ allowedTools: ['read_file', 'grep'] })
    expect(isToolAllowedByEnvelope(env, 'read_file')).toBe(true)
    expect(isToolAllowedByEnvelope(env, 'grep')).toBe(true)
  })

  it('returns false for tools not in the list', () => {
    const env = envelope({ allowedTools: ['read_file'] })
    expect(isToolAllowedByEnvelope(env, 'write_file')).toBe(false)
  })

  it('returns true for any tool when * is in allowedTools', () => {
    const env = envelope({ allowedTools: ['*'] })
    expect(isToolAllowedByEnvelope(env, 'write_file')).toBe(true)
    expect(isToolAllowedByEnvelope(env, 'run_shell')).toBe(true)
  })

  it('returns false when allowedTools is empty', () => {
    expect(isToolAllowedByEnvelope(envelope(), 'read_file')).toBe(false)
  })
})

describe('isPathAllowedByEnvelope', () => {
  it('returns false when scope is empty', () => {
    expect(isPathAllowedByEnvelope(envelope(), '/anywhere', 'read')).toBe(false)
    expect(isPathAllowedByEnvelope(envelope(), '/anywhere', 'write')).toBe(false)
  })

  it('matches exact paths', () => {
    const env = envelope({ fileReadScope: ['/repo/src/foo.ts'] })
    expect(isPathAllowedByEnvelope(env, '/repo/src/foo.ts', 'read')).toBe(true)
    expect(isPathAllowedByEnvelope(env, '/repo/src/bar.ts', 'read')).toBe(false)
  })

  it('matches subtree paths via trailing slash', () => {
    const env = envelope({ fileReadScope: ['/repo/src/'] })
    expect(isPathAllowedByEnvelope(env, '/repo/src/foo.ts', 'read')).toBe(true)
    expect(isPathAllowedByEnvelope(env, '/repo/src/nested/bar.ts', 'read')).toBe(true)
    expect(isPathAllowedByEnvelope(env, '/repo/other/foo.ts', 'read')).toBe(false)
  })

  it('matches anything against wildcard', () => {
    const env = envelope({ fileReadScope: ['*'] })
    expect(isPathAllowedByEnvelope(env, '/literally/anything', 'read')).toBe(true)
  })

  it('uses fileWriteScope for write mode', () => {
    const env = envelope({
      fileReadScope: ['/repo/'],
      fileWriteScope: ['/repo/docs/']
    })
    // /repo/src/foo.ts is in read scope but NOT write scope.
    expect(isPathAllowedByEnvelope(env, '/repo/src/foo.ts', 'read')).toBe(true)
    expect(isPathAllowedByEnvelope(env, '/repo/src/foo.ts', 'write')).toBe(false)
    expect(isPathAllowedByEnvelope(env, '/repo/docs/x.md', 'write')).toBe(true)
  })
})

describe('isHostAllowedByEnvelope', () => {
  it('returns false when network scope is empty', () => {
    expect(isHostAllowedByEnvelope(envelope(), 'api.example.com')).toBe(false)
  })

  it('matches exact host', () => {
    const env = envelope({ networkScope: ['github.com'] })
    expect(isHostAllowedByEnvelope(env, 'github.com')).toBe(true)
    expect(isHostAllowedByEnvelope(env, 'api.github.com')).toBe(false)
  })

  it('matches *.domain glob against subdomains', () => {
    const env = envelope({ networkScope: ['*.openai.com'] })
    expect(isHostAllowedByEnvelope(env, 'api.openai.com')).toBe(true)
    expect(isHostAllowedByEnvelope(env, 'platform.openai.com')).toBe(true)
    expect(isHostAllowedByEnvelope(env, 'openai.com')).toBe(false) // root not matched by *.x
  })

  it('matches anything against bare wildcard', () => {
    const env = envelope({ networkScope: ['*'] })
    expect(isHostAllowedByEnvelope(env, 'literally.anything.com')).toBe(true)
  })
})

describe('walkActorChain', () => {
  it('returns a single entry for an envelope with no parent', () => {
    const env = envelope()
    const chain = walkActorChain(env, () => undefined)
    expect(chain).toHaveLength(1)
    expect(chain[0].envelopeId).toBe(env.envelopeId)
  })

  it('walks parent → grandparent etc.', () => {
    const grand = envelope({ envelopeId: 'env-grand', purpose: 'top' })
    const parent = envelope({
      envelopeId: 'env-parent',
      parentEnvelopeId: 'env-grand',
      purpose: 'mid'
    })
    const child = envelope({
      envelopeId: 'env-child',
      parentEnvelopeId: 'env-parent',
      purpose: 'leaf'
    })
    const registry = new Map([
      ['env-grand', grand],
      ['env-parent', parent],
      ['env-child', child]
    ])
    const chain = walkActorChain(child, (id) => registry.get(id))
    expect(chain.map((c) => c.envelopeId)).toEqual(['env-child', 'env-parent', 'env-grand'])
    expect(chain.map((c) => c.purpose)).toEqual(['leaf', 'mid', 'top'])
  })

  it('stops gracefully when parent envelope can not be resolved', () => {
    const child = envelope({ envelopeId: 'env-child', parentEnvelopeId: 'env-missing' })
    const chain = walkActorChain(child, () => undefined)
    expect(chain).toHaveLength(1)
  })

  it('guards against cycles', () => {
    const a = envelope({ envelopeId: 'env-a', parentEnvelopeId: 'env-b' })
    const b = envelope({ envelopeId: 'env-b', parentEnvelopeId: 'env-a' })
    const registry = new Map([
      ['env-a', a],
      ['env-b', b]
    ])
    const chain = walkActorChain(a, (id) => registry.get(id))
    expect(chain.length).toBeLessThanOrEqual(2)
  })
})

describe('clampEnvelopeToParent', () => {
  it('returns draft unchanged when no parent', () => {
    const draft = envelope({ allowedTools: ['read_file', 'write_file'] })
    const out = clampEnvelopeToParent(draft, undefined)
    expect(out).toBe(draft)
  })

  it('intersects tool grants', () => {
    const draft = envelope({ allowedTools: ['read_file', 'write_file', 'run_shell'] })
    const parent = envelope({ allowedTools: ['read_file', 'write_file'] })
    const out = clampEnvelopeToParent(draft, parent)
    expect(out.allowedTools).toEqual(['read_file', 'write_file'])
  })

  it('intersects file scopes', () => {
    const draft = envelope({
      fileReadScope: ['/repo/', '/etc/'],
      fileWriteScope: ['/repo/docs/', '/var/']
    })
    const parent = envelope({
      fileReadScope: ['/repo/'],
      fileWriteScope: ['/repo/docs/']
    })
    const out = clampEnvelopeToParent(draft, parent)
    expect(out.fileReadScope).toEqual(['/repo/'])
    expect(out.fileWriteScope).toEqual(['/repo/docs/'])
  })

  it('chooses the earlier expiry', () => {
    const draft = envelope({ expiry: '2026-05-27T23:30:00Z' })
    const parent = envelope({ expiry: '2026-05-27T22:30:00Z' })
    const out = clampEnvelopeToParent(draft, parent)
    expect(out.expiry).toBe('2026-05-27T22:30:00Z')
  })
})
