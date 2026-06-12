import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  parseNpmPackOutput,
  resolveDarwinClaudeSdkPackages
}: {
  parseNpmPackOutput: (output: string) => string
  resolveDarwinClaudeSdkPackages: (lock: unknown) => Array<{
    name: string
    version: string
    spec: string
  }>
} = require('./install-mac-universal-optional-deps.cjs')

describe('install-mac-universal-optional-deps script', () => {
  it('resolves both Darwin Claude SDK helper packages from package-lock entries', () => {
    const packages = resolveDarwinClaudeSdkPackages({
      packages: {
        'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64': {
          version: '0.2.141'
        },
        'node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64': {
          version: '0.2.141'
        }
      }
    })

    expect(packages.map((item) => item.spec)).toEqual([
      '@anthropic-ai/claude-agent-sdk-darwin-arm64@0.2.141',
      '@anthropic-ai/claude-agent-sdk-darwin-x64@0.2.141'
    ])
  })

  it('fails clearly if a required helper package is missing from the lockfile', () => {
    expect(() =>
      resolveDarwinClaudeSdkPackages({
        packages: {
          'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64': {
            version: '0.2.141'
          }
        }
      })
    ).toThrow('Missing @anthropic-ai/claude-agent-sdk-darwin-x64 version in package-lock.json.')
  })

  it('extracts the packed tarball name from npm pack JSON output', () => {
    expect(
      parseNpmPackOutput(
        JSON.stringify([
          {
            filename: 'anthropic-ai-claude-agent-sdk-darwin-x64-0.2.141.tgz'
          }
        ])
      )
    ).toBe('anthropic-ai-claude-agent-sdk-darwin-x64-0.2.141.tgz')
  })
})
