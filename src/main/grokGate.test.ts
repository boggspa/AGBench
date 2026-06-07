import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { experimentalGrokProviderEnabled, grokAcpEnabled } from './grokGate'

const GROK_ENV_KEYS = [
  'TASKWRAITH_DISABLE_GROK',
  'TASKWRAITH_EXPERIMENTAL_GROK',
  'TASKWRAITH_GROK_ACP'
] as const

type GrokEnvKey = (typeof GROK_ENV_KEYS)[number]

const originalEnv = new Map<GrokEnvKey, string | undefined>()

function resetGrokEnv(values: Partial<Record<GrokEnvKey, string>> = {}): void {
  for (const key of GROK_ENV_KEYS) {
    delete process.env[key]
  }
  for (const key of GROK_ENV_KEYS) {
    const value = values[key]
    if (value !== undefined) {
      process.env[key] = value
    }
  }
}

describe('experimentalGrokProviderEnabled', () => {
  beforeEach(() => {
    originalEnv.clear()
    for (const key of GROK_ENV_KEYS) {
      originalEnv.set(key, process.env[key])
    }
    resetGrokEnv()
  })

  afterEach(() => {
    for (const key of GROK_ENV_KEYS) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('defaults on when no Grok env vars are set', () => {
    expect(experimentalGrokProviderEnabled()).toBe(true)
  })

  it('turns off for documented emergency kill-switch values', () => {
    for (const value of ['1', 'true', 'yes']) {
      resetGrokEnv({ TASKWRAITH_DISABLE_GROK: value })
      expect(experimentalGrokProviderEnabled()).toBe(false)
    }
  })

  it('does not treat other kill-switch spellings as opt-out', () => {
    for (const value of ['', '0', 'false', 'no', 'TRUE', 'YES', ' yes ', 'random']) {
      resetGrokEnv({ TASKWRAITH_DISABLE_GROK: value })
      expect(experimentalGrokProviderEnabled()).toBe(true)
    }
  })

  it('turns off for legacy explicit opt-out values', () => {
    for (const value of ['0', 'false', 'no']) {
      resetGrokEnv({ TASKWRAITH_EXPERIMENTAL_GROK: value })
      expect(experimentalGrokProviderEnabled()).toBe(false)
    }
  })

  it('does not require the legacy experimental var to opt in', () => {
    for (const value of ['', '1', 'true', 'yes', 'FALSE', 'NO', ' no ', 'random']) {
      resetGrokEnv({ TASKWRAITH_EXPERIMENTAL_GROK: value })
      expect(experimentalGrokProviderEnabled()).toBe(true)
    }
  })

  it('lets the emergency kill-switch override a legacy enabled-looking value', () => {
    resetGrokEnv({ TASKWRAITH_DISABLE_GROK: '1', TASKWRAITH_EXPERIMENTAL_GROK: 'true' })
    expect(experimentalGrokProviderEnabled()).toBe(false)
  })
})

describe('grokAcpEnabled', () => {
  beforeEach(() => {
    originalEnv.clear()
    for (const key of GROK_ENV_KEYS) {
      originalEnv.set(key, process.env[key])
    }
    resetGrokEnv()
  })

  afterEach(() => {
    for (const key of GROK_ENV_KEYS) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('defaults on', () => {
    expect(grokAcpEnabled()).toBe(true)
  })

  it('stays on for documented enabled or malformed values', () => {
    for (const value of ['', '1', 'true', 'yes', 'TRUE', 'YES', ' yes ', 'random']) {
      resetGrokEnv({ TASKWRAITH_GROK_ACP: value })
      expect(grokAcpEnabled()).toBe(true)
    }
  })

  it('turns off for exact documented opt-out values', () => {
    for (const value of ['0', 'false', 'no']) {
      resetGrokEnv({ TASKWRAITH_GROK_ACP: value })
      expect(grokAcpEnabled()).toBe(false)
    }
  })
})
