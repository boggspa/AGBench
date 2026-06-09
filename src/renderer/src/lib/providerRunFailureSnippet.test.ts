import { describe, expect, it } from 'vitest'
import { buildProviderRunFailureSnippet } from './providerRunFailureSnippet'

describe('buildProviderRunFailureSnippet', () => {
  const failureAt = '2026-06-09T10:42:00.000Z'

  it('builds a timestamped stderr bundle for non-zero exits', () => {
    const snippet = buildProviderRunFailureSnippet({
      provider: 'codex',
      exitCode: 1,
      failureAt,
      payloadError: 'connection refused',
      warnings: [
        { timestamp: '2026-06-09T10:41:58.000Z', message: 'app-server socket unreachable' }
      ],
      stderrLogs: [
        { type: 'stderr', content: 'Error: ECONNREFUSED 127.0.0.1:2468', timestamp: failureAt }
      ]
    })

    expect(snippet.headline).toBe('Codex failed · exit 1')
    expect(snippet.lines.map((line) => line.text)).toEqual([
      'app-server socket unreachable',
      'Error: ECONNREFUSED 127.0.0.1:2468',
      'connection refused'
    ])
    expect(snippet.copyText).toContain('Codex run failed (exit 1)')
    expect(snippet.copyText).toContain('ECONNREFUSED')
  })

  it('deduplicates repeated stderr lines', () => {
    const snippet = buildProviderRunFailureSnippet({
      provider: 'ollama',
      exitCode: 2,
      failureAt,
      stderrLogs: [
        { type: 'stderr', content: 'model not found', timestamp: failureAt },
        { type: 'stderr', content: 'model not found', timestamp: failureAt }
      ]
    })

    expect(snippet.lines).toEqual([{ timestamp: failureAt, text: 'model not found' }])
  })

  it('uses a compact cancelled headline for exit 130', () => {
    const snippet = buildProviderRunFailureSnippet({
      provider: 'gemini',
      exitCode: 130,
      failureAt
    })

    expect(snippet.headline).toBe('Gemini cancelled')
    expect(snippet.copyText).toContain('exit 130')
    expect(snippet.lines[0]?.text).toContain('cancelled')
  })
})
