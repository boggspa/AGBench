import { describe, expect, it } from 'vitest'
import {
  canonicalizeExternalPathGrantMetadata,
  collectExternalPathGrantsFromMetadata
} from './ExternalPathGrants'
import type { ExternalPathGrant, ProviderId } from './types'

function grant(
  provider: ProviderId,
  path: string,
  access: 'read' | 'write' = 'read',
  id = `${provider}-${access}`
): ExternalPathGrant {
  return {
    id,
    provider,
    path,
    kind: 'file',
    access,
    duration: 'thisThread',
    issuedBy: 'main',
    signature: 'signed',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('ExternalPathGrants metadata helpers', () => {
  it('reads canonical and legacy grant keys into one coalesced list', () => {
    const metadata = {
      externalPathGrants: [grant('gemini', '/tmp/a.txt')],
      codexExternalPathGrants: [grant('codex', '/tmp/b.txt')],
      claudeExternalPathGrants: [grant('claude', '/tmp/c.txt')],
      kimiExternalPathGrants: [grant('kimi', '/tmp/d.txt')]
    }

    expect(collectExternalPathGrantsFromMetadata(metadata).map((item) => item.provider)).toEqual([
      'gemini',
      'codex',
      'claude',
      'kimi'
    ])
  })

  it('dedupes by provider/path with write access winning over read', () => {
    const metadata = {
      geminiExternalPathGrants: [grant('gemini', '/tmp/a.txt', 'read', 'read-1')],
      kimiExternalPathGrants: [grant('gemini', '/tmp/a.txt', 'write', 'write-1')]
    }

    expect(collectExternalPathGrantsFromMetadata(metadata)).toMatchObject([
      { id: 'write-1', provider: 'gemini', path: '/tmp/a.txt', access: 'write' }
    ])
  })

  it('keeps canonical entries ahead of legacy duplicates on re-migration', () => {
    const metadata = {
      externalPathGrants: [grant('gemini', '/tmp/a.txt', 'read', 'canonical-read')],
      geminiExternalPathGrants: [grant('gemini', '/tmp/a.txt', 'write', 'legacy-write')]
    }

    expect(canonicalizeExternalPathGrantMetadata(metadata).externalPathGrants).toMatchObject([
      { id: 'canonical-read', provider: 'gemini', path: '/tmp/a.txt', access: 'read' }
    ])
  })

  it('writes canonical metadata only while preserving unrelated keys', () => {
    const metadata = canonicalizeExternalPathGrantMetadata(
      {
        geminiAuthProfileId: 'profile-1',
        codexExternalPathGrants: [grant('codex', '/tmp/old.txt')]
      },
      [grant('claude', '/tmp/new.txt', 'write')]
    )

    expect(metadata).toEqual({
      geminiAuthProfileId: 'profile-1',
      externalPathGrants: [expect.objectContaining({ provider: 'claude', path: '/tmp/new.txt' })]
    })
    expect(metadata).not.toHaveProperty('codexExternalPathGrants')
    expect(metadata).not.toHaveProperty('claudeExternalPathGrants')
    expect(metadata).not.toHaveProperty('geminiExternalPathGrants')
    expect(metadata).not.toHaveProperty('kimiExternalPathGrants')
  })
})
