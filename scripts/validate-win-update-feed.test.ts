import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  classifyWindowsArtifact,
  validateWindowsUpdateFeedText
}: {
  classifyWindowsArtifact: (name: string | undefined) => 'arm64' | 'x64' | 'unknown'
  validateWindowsUpdateFeedText: (
    feedText: string,
    options?: { fileName?: string; expectedArch?: string }
  ) => {
    ok: boolean
    errors: string[]
    artifacts: Array<{ source: string; name: string; arch: string }>
  }
} = require('./validate-win-update-feed.cjs')

describe('validate-win-update-feed script', () => {
  it('accepts an x64 Windows feed with an arch-specific setup artifact', () => {
    const result = validateWindowsUpdateFeedText(
      `
version: 1.0.73
files:
  - url: TaskWraith-1.0.73-win-x64-setup.exe
    sha512: example
    size: 123
path: TaskWraith-1.0.73-win-x64-setup.exe
sha512: example
`,
      { fileName: 'latest-win-x64.yml' }
    )

    expect(result.ok).toBe(true)
    expect(result.artifacts.map((artifact) => artifact.arch)).toEqual(['x64', 'x64'])
  })

  it('fails an ambiguous Windows setup feed', () => {
    const result = validateWindowsUpdateFeedText(
      `
version: 1.0.73
files:
  - url: TaskWraith-1.0.73-setup.exe
path: TaskWraith-1.0.73-setup.exe
sha512: example
`,
      { fileName: 'latest-win-arm64.yml' }
    )

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'latest-win-arm64.yml: TaskWraith-1.0.73-setup.exe has unknown Windows artifact architecture.'
    )
  })

  it('fails a feed that points at the wrong Windows architecture', () => {
    const result = validateWindowsUpdateFeedText(
      `
version: 1.0.73
files:
  - url: TaskWraith-1.0.73-win-x64-setup.exe
path: TaskWraith-1.0.73-win-x64-setup.exe
sha512: example
`,
      { fileName: 'latest-win-arm64.yml' }
    )

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'latest-win-arm64.yml: TaskWraith-1.0.73-win-x64-setup.exe is x64; expected arm64 for this feed.'
    )
  })

  it('classifies Windows artifact names', () => {
    expect(classifyWindowsArtifact('TaskWraith-1.0.73-win-arm64-setup.exe')).toBe('arm64')
    expect(classifyWindowsArtifact('TaskWraith-1.0.73-win-x64-setup.exe')).toBe('x64')
    expect(classifyWindowsArtifact('TaskWraith-1.0.73-setup.exe')).toBe('unknown')
  })
})
