import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { loadExternalProviderUsageRecords } from './ExternalProviderActivity'

describe('loadExternalProviderUsageRecords', () => {
  it('normalizes external provider logs into UsageRecord rows', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'agbench-external-activity-'))
    try {
      await mkdir(join(homeDir, '.codex', 'sessions', '2026', '05', '31'), { recursive: true })
      await mkdir(join(homeDir, '.claude', 'projects', 'sample'), { recursive: true })
      await mkdir(join(homeDir, '.gemini', 'tmp', 'sample', 'chats'), { recursive: true })
      await mkdir(join(homeDir, '.kimi', 'sessions', 'sample', 'turn'), { recursive: true })

      await writeFile(
        join(homeDir, '.codex', 'sessions', '2026', '05', '31', 'rollout.jsonl'),
        [
          JSON.stringify({
            timestamp: '2026-05-31T09:00:00.000Z',
            payload: {
              type: 'token_count',
              info: {
                last_token_usage: {
                  input_tokens: 10,
                  cached_input_tokens: 5,
                  output_tokens: 7,
                  reasoning_output_tokens: 3,
                  total_tokens: 25
                }
              }
            }
          })
        ].join('\n')
      )

      await writeFile(
        join(homeDir, '.claude', 'projects', 'sample', 'thread.jsonl'),
        [
          JSON.stringify({
            timestamp: '2026-05-31T10:00:00.000Z',
            requestId: 'req-1',
            message: {
              id: 'msg-1',
              model: 'claude-sonnet',
              usage: {
                input_tokens: 11,
                cache_read_input_tokens: 3,
                output_tokens: 5
              }
            }
          })
        ].join('\n')
      )

      await writeFile(
        join(homeDir, '.gemini', 'tmp', 'sample', 'chats', 'session-2026-05-31.jsonl'),
        [
          JSON.stringify({
            id: 'gemini-1',
            timestamp: '2026-05-31T11:00:00.000Z',
            type: 'gemini',
            model: 'gemini-3.1-pro-preview',
            tokens: { input: 20, output: 4, total: 24 }
          })
        ].join('\n')
      )

      await writeFile(
        join(homeDir, '.kimi', 'sessions', 'sample', 'turn', 'wire.jsonl'),
        [
          JSON.stringify({
            timestamp: Date.parse('2026-05-31T12:00:00.000Z') / 1000,
            message: {
              type: 'StatusUpdate',
              payload: {
                token_usage: {
                  input_other: 13,
                  input_cache_read: 2,
                  input_cache_creation: 1,
                  output: 9
                }
              }
            }
          })
        ].join('\n')
      )

      const records = await loadExternalProviderUsageRecords({
        homeDir,
        now: new Date('2026-05-31T13:00:00.000Z')
      })
      const byProvider = new Map(records.map((record) => [record.provider, record]))

      expect(byProvider.get('codex')?.totalTokens).toBe(25)
      expect(byProvider.get('claude')?.totalTokens).toBe(19)
      expect(byProvider.get('gemini')?.totalTokens).toBe(24)
      expect(byProvider.get('kimi')?.totalTokens).toBe(25)
      expect(records.every((record) => record.workspaceId === 'external')).toBe(true)
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  })
})
