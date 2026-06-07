import { describe, expect, it } from 'vitest'
import { normalizeBrokerParentProvider } from './McpBridgeRuntime'

describe('normalizeBrokerParentProvider', () => {
  it('preserves Cursor and Grok provider stamps for broker-routed MCP calls', () => {
    expect(normalizeBrokerParentProvider('cursor')).toBe('cursor')
    expect(normalizeBrokerParentProvider('grok')).toBe('grok')
  })

  it('falls back to Gemini for unknown provider stamps', () => {
    expect(normalizeBrokerParentProvider('unknown')).toBe('gemini')
  })
})
