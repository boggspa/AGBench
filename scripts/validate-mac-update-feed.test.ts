import { createRequire } from 'module'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  classifyMacArtifact,
  validateMacUpdateFeedFile,
  validateMacUpdateFeedText
}: {
  classifyMacArtifact: (name: string | undefined) => 'universal' | 'arm64' | 'x64' | 'unknown'
  validateMacUpdateFeedFile: (filePath: string) => {
    ok: boolean
    errors: string[]
  }
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
    sha512: example
    size: 123
  - url: TaskWraith-1.0.73-universal-mac.dmg
    sha512: example
    size: 456
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
    sha512: example
    size: 123
  - url: TaskWraith-1.0.73.dmg
    sha512: example
    size: 456
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

  it('requires sha512 and size metadata for file entries', () => {
    const result = validateMacUpdateFeedText(
      `
version: 1.0.73
files:
  - url: TaskWraith-1.0.73-universal-mac.zip
path: TaskWraith-1.0.73-universal-mac.zip
`,
      { fileName: 'latest-mac.yml' }
    )

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'latest-mac.yml: TaskWraith-1.0.73-universal-mac.zip is missing sha512 metadata.'
    )
    expect(result.errors).toContain(
      'latest-mac.yml: TaskWraith-1.0.73-universal-mac.zip is missing positive size metadata.'
    )
  })

  it('verifies sha512 and size against referenced artifact files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskwraith-mac-feed-'))
    const zipName = 'TaskWraith-1.0.73-universal-mac.zip'
    const zipPath = path.join(tempDir, zipName)
    fs.writeFileSync(zipPath, Buffer.from('updater-zip-bytes'))
    const sha512 = crypto.createHash('sha512').update(fs.readFileSync(zipPath)).digest('base64')
    const feedPath = path.join(tempDir, 'latest-mac.yml')
    fs.writeFileSync(
      feedPath,
      `
version: 1.0.73
files:
  - url: ${zipName}
    sha512: ${sha512}
    size: ${fs.statSync(zipPath).size}
path: ${zipName}
sha512: ${sha512}
`
    )

    expect(validateMacUpdateFeedFile(feedPath)).toMatchObject({ ok: true })

    fs.writeFileSync(zipPath, Buffer.from('tampered'))
    const changedResult = validateMacUpdateFeedFile(feedPath)
    expect(changedResult.ok).toBe(false)
    expect(changedResult.errors.some((error) => error.includes('sha512 mismatch'))).toBe(true)
    expect(changedResult.errors.some((error) => error.includes('size mismatch'))).toBe(true)
  })

  it('fails when a referenced artifact is missing from disk', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskwraith-mac-feed-'))
    const zipName = 'TaskWraith-1.0.73-universal-mac.zip'
    const feedPath = path.join(tempDir, 'latest-mac.yml')
    fs.writeFileSync(
      feedPath,
      `
version: 1.0.73
files:
  - url: ${zipName}
    sha512: example
    size: 123
path: ${zipName}
sha512: example
`
    )

    const result = validateMacUpdateFeedFile(feedPath)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes(`missing referenced artifact ${zipName}`))).toBe(
      true
    )
  })

  it('classifies conventional shared mac zip names as universal', () => {
    expect(classifyMacArtifact('TaskWraith-1.0.73-mac.zip')).toBe('universal')
  })
})
