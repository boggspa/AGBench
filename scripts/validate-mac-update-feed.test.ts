import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  classifyMacArtifact,
  validateMacUpdateFeedText
}: {
  classifyMacArtifact: (name: string | undefined) => 'universal' | 'arm64' | 'x64' | 'unknown'
  validateMacUpdateFeedText: (
    feedText: string,
    options?: { fileName?: string }
  ) => {
    ok: boolean
    errors: string[]
    artifacts: Array<{ source: string; name: string; arch: string }>
  }
} = require('./validate-mac-update-feed.cjs')

describe('validate-mac-update-feed script', () => {
  it('accepts a shared mac feed with universal zip and dmg artifacts', () => {
    const result = validateMacUpdateFeedText(
      `
version: 1.0.73
files:
  - url: TaskWraith-1.0.73-universal-mac.zip
  - url: TaskWraith-1.0.73-universal-mac.dmg
path: TaskWraith-1.0.73-universal-mac.zip
sha512: example
`,
      { fileName: 'latest-mac.yml' }
    )

    expect(result.ok).toBe(true)
    expect(result.artifacts.map((artifact) => artifact.arch)).toEqual([
      'universal',
      'universal',
      'universal'
    ])
  })

  it('fails an arm64-only shared mac feed', () => {
    const result = validateMacUpdateFeedText(
      `
version: 1.0.73
files:
  - url: TaskWraith-1.0.73-arm64-mac.zip
  - url: TaskWraith-1.0.73.dmg
path: TaskWraith-1.0.73-arm64-mac.zip
sha512: example
`,
      { fileName: 'latest-mac.yml' }
    )

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'latest-mac.yml: TaskWraith-1.0.73-arm64-mac.zip is arm64; shared mac feeds must publish universal artifacts.'
    )
    expect(result.errors).toContain(
      'latest-mac.yml: TaskWraith-1.0.73.dmg is unknown; shared mac feeds must publish universal artifacts.'
    )
  })

  it('classifies conventional shared mac zip names as universal', () => {
    expect(classifyMacArtifact('TaskWraith-1.0.73-mac.zip')).toBe('universal')
  })
})
