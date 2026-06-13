import { describe, expect, it } from 'vitest'
import {
  estimateTokensFromText,
  inferCursorModelFromText,
  isCursorSandboxProjectDir,
  normalizeCursorExternalModelId,
  parseCursorAgentTranscript,
  parseCursorBubbleValue,
  parseCursorDailyStatsValue
} from './CursorExternalActivity'

describe('normalizeCursorExternalModelId', () => {
  it('maps display labels and ids to canonical Composer ids', () => {
    expect(normalizeCursorExternalModelId('Composer 2.5 Fast')).toBe('composer-2.5-fast')
    expect(normalizeCursorExternalModelId('composer-2.5')).toBe('composer-2.5')
    expect(normalizeCursorExternalModelId('cursor')).toBe('composer-2.5-fast')
  })
})

describe('parseCursorAgentTranscript', () => {
  it('estimates tokens from user and assistant transcript text', () => {
    const text = [
      JSON.stringify({
        role: 'user',
        message: { content: [{ type: 'text', text: 'a'.repeat(400) }] }
      }),
      JSON.stringify({
        role: 'assistant',
        message: { content: [{ type: 'text', text: 'b'.repeat(200) }] }
      })
    ].join('\n')

    const parsed = parseCursorAgentTranscript(
      '/Users/me/.cursor/projects/Users-me/agent-transcripts/abc/abc.jsonl',
      text,
      Date.parse('2026-06-13T12:00:00.000Z')
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.inputTokens).toBe(100)
    expect(parsed!.outputTokens).toBe(50)
    expect(parsed!.inputTokens + parsed!.outputTokens).toBe(150)
    expect(parsed!.composerId).toBe('abc')
  })

  it('skips TaskWraith sandbox project transcripts', () => {
    const text = JSON.stringify({
      role: 'user',
      message: { content: [{ type: 'text', text: 'hello world' }] }
    })
    expect(
      parseCursorAgentTranscript(
        '/Users/me/.cursor/projects/tmp-agbench-mcp-test/agent-transcripts/abc/abc.jsonl',
        text,
        Date.now()
      )
    ).toBeNull()
  })

  it('infers Composer 2.5 (non-fast) from transcript text', () => {
    const text = JSON.stringify({
      role: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Running on composer-2.5 for this workspace.' }]
      }
    })
    const parsed = parseCursorAgentTranscript(
      '/Users/me/.cursor/projects/Users-me/agent-transcripts/abc/abc.jsonl',
      text,
      Date.now()
    )
    expect(parsed?.model).toBe('composer-2.5')
  })
})

describe('parseCursorDailyStatsValue', () => {
  it('converts composer line counts into estimated tokens', () => {
    const event = parseCursorDailyStatsValue(
      {
        date: '2026-06-13',
        composerSuggestedLines: 100,
        composerAcceptedLines: 50
      },
      'cursor-ide-daily:2026-06-13'
    )
    expect(event?.totalTokens).toBe(6000)
    expect(event?.model).toBe('composer-2.5-fast')
  })
})

describe('parseCursorBubbleValue', () => {
  it('reads real per-bubble token counts when Cursor populates them', () => {
    const event = parseCursorBubbleValue(
      {
        createdAt: '2026-06-13T10:00:00.000Z',
        tokenCount: { inputTokens: 1200, outputTokens: 300 },
        modelInfo: { modelName: 'Composer 2.5 Fast' }
      },
      'cursor-ide-bubble:test'
    )
    expect(event?.totalTokens).toBe(1500)
    expect(event?.model).toBe('composer-2.5-fast')
  })
})

describe('helpers', () => {
  it('flags sandbox project dirs', () => {
    expect(isCursorSandboxProjectDir('tmp-agbench-mcp-test')).toBe(true)
    expect(isCursorSandboxProjectDir('Users-chrisizatt-Documents-AGBench')).toBe(false)
  })

  it('estimates tokens from char length', () => {
    expect(estimateTokensFromText('abcd')).toBe(1)
    expect(estimateTokensFromText('a'.repeat(40))).toBe(10)
  })

  it('infers model names from free text', () => {
    expect(inferCursorModelFromText('use composer-2.5-fast here')).toBe('composer-2.5-fast')
    expect(inferCursorModelFromText('switch to Composer 2.5 mode')).toBe('composer-2.5')
  })
})
