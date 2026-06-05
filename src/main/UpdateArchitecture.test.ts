import { describe, expect, it } from 'vitest'
import {
  classifyMacUpdateArtifact,
  evaluateUpdateArchitectureCompatibility,
  selectedMacUpdateArtifact
} from './UpdateArchitecture'

describe('UpdateArchitecture', () => {
  it('classifies explicit mac update artifact architecture tokens', () => {
    expect(classifyMacUpdateArtifact('AGBench-1.0.73-universal-mac.zip')).toBe('universal')
    expect(classifyMacUpdateArtifact('AGBench-1.0.73-arm64-mac.zip')).toBe('arm64')
    expect(classifyMacUpdateArtifact('AGBench-1.0.73-x64-mac.zip')).toBe('x64')
    expect(classifyMacUpdateArtifact('AGBench-1.0.73-x86_64-mac.zip')).toBe('x64')
    expect(classifyMacUpdateArtifact('AGBench-1.0.73.dmg')).toBe('unknown')
  })

  it('treats conventional shared mac zip names as universal at runtime', () => {
    expect(classifyMacUpdateArtifact('AGBench-1.0.73-mac.zip')).toBe('universal')
  })

  it('prefers the top-level updater path over secondary files', () => {
    expect(
      selectedMacUpdateArtifact({
        path: 'AGBench-1.0.73-universal-mac.zip',
        files: [{ url: 'AGBench-1.0.73.dmg' }]
      })
    ).toBe('AGBench-1.0.73-universal-mac.zip')
  })

  it('accepts universal mac artifacts on Intel and Apple Silicon hosts', () => {
    const info = { path: 'AGBench-1.0.73-universal-mac.zip' }
    expect(
      evaluateUpdateArchitectureCompatibility(info, { platform: 'darwin', arch: 'x64' })
        .compatible
    ).toBe(true)
    expect(
      evaluateUpdateArchitectureCompatibility(info, { platform: 'darwin', arch: 'arm64' })
        .compatible
    ).toBe(true)
  })

  it('rejects arm64 mac artifacts on Intel hosts', () => {
    expect(
      evaluateUpdateArchitectureCompatibility(
        { path: 'AGBench-1.0.73-arm64-mac.zip' },
        { platform: 'darwin', arch: 'x64' }
      )
    ).toMatchObject({
      artifactArch: 'arm64',
      compatible: false,
      reason: 'Incompatible update artifact: host=darwin-x64 artifact=arm64'
    })
  })

  it('rejects x64 mac artifacts on Apple Silicon hosts', () => {
    expect(
      evaluateUpdateArchitectureCompatibility(
        { path: 'AGBench-1.0.73-x64-mac.zip' },
        { platform: 'darwin', arch: 'arm64' }
      )
    ).toMatchObject({
      artifactArch: 'x64',
      compatible: false,
      reason: 'Incompatible update artifact: host=darwin-arm64 artifact=x64'
    })
  })
})
