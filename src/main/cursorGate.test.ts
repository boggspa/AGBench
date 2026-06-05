import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cursorDebugEnabled,
  cursorWebBridgeEnabled,
  experimentalCursorProviderEnabled
} from './cursorGate'

const CURSOR_ENV_KEYS = [
  'TASKWRAITH_DISABLE_CURSOR',
  'TASKWRAITH_EXPERIMENTAL_CURSOR',
  'TASKWRAITH_CURSOR_DEBUG',
  'TASKWRAITH_CURSOR_WEB'
] as const

type CursorEnvKey = (typeof CURSOR_ENV_KEYS)[number]

const originalEnv = new Map<CursorEnvKey, string | undefined>()

function resetCursorEnv(values: Partial<Record<CursorEnvKey, string>> = {}): void {
  for (const key of CURSOR_ENV_KEYS) {
    delete process.env[key]
  }
  for (const key of CURSOR_ENV_KEYS) {
    const value = values[key]
    if (value !== undefined) {
      process.env[key] = value
    }
  }
}

describe('experimentalCursorProviderEnabled', () => {
  beforeEach(() => {
    originalEnv.clear()
    for (const key of CURSOR_ENV_KEYS) {
      originalEnv.set(key, process.env[key])
    }
    resetCursorEnv()
  })

  afterEach(() => {
    for (const key of CURSOR_ENV_KEYS) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('defaults on when no Cursor env vars are set', () => {
    expect(experimentalCursorProviderEnabled()).toBe(true)
  })

  it('turns off for documented emergency kill-switch values', () => {
    for (const value of ['1', 'true', 'yes']) {
      resetCursorEnv({ TASKWRAITH_DISABLE_CURSOR: value })
      expect(experimentalCursorProviderEnabled()).toBe(false)
    }
  })

  it('does not treat other kill-switch spellings as opt-out', () => {
    for (const value of ['', '0', 'false', 'no', 'TRUE', 'YES', ' yes ', 'random']) {
      resetCursorEnv({ TASKWRAITH_DISABLE_CURSOR: value })
      expect(experimentalCursorProviderEnabled()).toBe(true)
    }
  })

  it('turns off for legacy explicit opt-out values', () => {
    for (const value of ['0', 'false', 'no']) {
      resetCursorEnv({ TASKWRAITH_EXPERIMENTAL_CURSOR: value })
      expect(experimentalCursorProviderEnabled()).toBe(false)
    }
  })

  it('does not require the legacy experimental var to opt in', () => {
    for (const value of ['', '1', 'true', 'yes', 'FALSE', 'NO', ' no ', 'random']) {
      resetCursorEnv({ TASKWRAITH_EXPERIMENTAL_CURSOR: value })
      expect(experimentalCursorProviderEnabled()).toBe(true)
    }
  })

  it('lets the emergency kill-switch override a legacy enabled-looking value', () => {
    resetCursorEnv({ TASKWRAITH_DISABLE_CURSOR: '1', TASKWRAITH_EXPERIMENTAL_CURSOR: 'true' })
    expect(experimentalCursorProviderEnabled()).toBe(false)
  })
})

describe('cursorDebugEnabled', () => {
  beforeEach(() => {
    originalEnv.clear()
    for (const key of CURSOR_ENV_KEYS) {
      originalEnv.set(key, process.env[key])
    }
    resetCursorEnv()
  })

  afterEach(() => {
    for (const key of CURSOR_ENV_KEYS) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('defaults off', () => {
    expect(cursorDebugEnabled()).toBe(false)
  })

  it('turns on for documented opt-in values', () => {
    for (const value of ['1', 'true', 'yes']) {
      resetCursorEnv({ TASKWRAITH_CURSOR_DEBUG: value })
      expect(cursorDebugEnabled()).toBe(true)
    }
  })

  it('stays off for false-ish, malformed, uppercase, or padded values', () => {
    for (const value of ['', '0', 'false', 'no', 'TRUE', 'YES', ' yes ', 'random']) {
      resetCursorEnv({ TASKWRAITH_CURSOR_DEBUG: value })
      expect(cursorDebugEnabled()).toBe(false)
    }
  })
})

describe('cursorWebBridgeEnabled', () => {
  beforeEach(() => {
    originalEnv.clear()
    for (const key of CURSOR_ENV_KEYS) {
      originalEnv.set(key, process.env[key])
    }
    resetCursorEnv()
  })

  afterEach(() => {
    for (const key of CURSOR_ENV_KEYS) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('defaults on', () => {
    expect(cursorWebBridgeEnabled()).toBe(true)
  })

  it('turns off for documented opt-out values', () => {
    for (const value of ['0', 'false', 'no']) {
      resetCursorEnv({ TASKWRAITH_CURSOR_WEB: value })
      expect(cursorWebBridgeEnabled()).toBe(false)
    }
  })

  it('stays on for opt-in-looking, malformed, uppercase, or padded values', () => {
    for (const value of ['', '1', 'true', 'yes', 'FALSE', 'NO', ' no ', 'random']) {
      resetCursorEnv({ TASKWRAITH_CURSOR_WEB: value })
      expect(cursorWebBridgeEnabled()).toBe(true)
    }
  })
})
