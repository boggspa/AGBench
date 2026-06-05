import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { loadExternalProviderUsageRecords } from './ExternalProviderActivity'

describe('loadExternalProviderUsageRecords', () => {
  it('normalizes external provider logs into UsageRecord rows', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'taskwraith-external-activity-'))
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

  it('keeps Codex history beyond the old narrow session cap', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'taskwraith-external-codex-history-'))
    try {
      const sessionDir = join(homeDir, '.codex', 'sessions', '2026', '05', '31')
      await mkdir(sessionDir, { recursive: true })

      for (let index = 0; index < 270; index += 1) {
        await writeFile(
          join(sessionDir, `rollout-${String(index).padStart(3, '0')}.jsonl`),
          JSON.stringify({
            timestamp: `2026-05-31T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
            payload: {
              type: 'token_count',
              info: {
                last_token_usage: {
                  input_tokens: 1,
                  output_tokens: 1,
                  total_tokens: index === 269 ? 269 : 2
                }
              }
            }
          })
        )
      }

      const records = await loadExternalProviderUsageRecords({
        homeDir,
        now: new Date('2026-05-31T23:00:00.000Z')
      })

      expect(records.filter((record) => record.provider === 'codex')).toHaveLength(270)
      expect(
        records.some((record) => record.provider === 'codex' && record.totalTokens === 269)
      ).toBe(true)
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  })

  it('reads Codex archived sessions and session-index activity markers', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'taskwraith-external-codex-archive-'))
    try {
      await mkdir(join(homeDir, '.codex', 'archived_sessions'), { recursive: true })

      await writeFile(
        join(homeDir, '.codex', 'archived_sessions', 'archived.jsonl'),
        JSON.stringify({
          timestamp: '2026-05-30T09:00:00.000Z',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 10,
                output_tokens: 5,
                total_tokens: 15
              }
            }
          }
        })
      )
      await writeFile(
        join(homeDir, '.codex', 'session_index.jsonl'),
        JSON.stringify({
          id: 'thread-1',
          thread_name: 'hidden from output',
          updated_at: '2026-05-29T13:00:00.000Z'
        })
      )

      const records = await loadExternalProviderUsageRecords({
        homeDir,
        now: new Date('2026-05-31T13:00:00.000Z')
      })
      const codexRecords = records.filter((record) => record.provider === 'codex')

      expect(codexRecords.some((record) => record.totalTokens === 15)).toBe(true)
      expect(codexRecords.some((record) => record.totalTokens === 0)).toBe(true)
      expect(codexRecords.every((record) => record.model === 'Codex')).toBe(true)
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  })

  it('reads Gemini legacy JSON and nested session JSONL activity', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'taskwraith-external-gemini-sessions-'))
    try {
      const chatsDir = join(homeDir, '.gemini', 'tmp', 'sample', 'chats')
      const nestedDir = join(chatsDir, 'subagent-session')
      await mkdir(nestedDir, { recursive: true })

      await writeFile(
        join(chatsDir, 'session-2026-05-31.json'),
        JSON.stringify({
          sessionId: 'legacy',
          messages: [
            {
              id: 'legacy-1',
              timestamp: '2026-05-31T09:00:00.000Z',
              type: 'gemini',
              model: 'gemini-3.1-pro-preview',
              tokens: { input: 100, output: 20, total: 150 }
            }
          ]
        })
      )
      await writeFile(
        join(nestedDir, 'worker.jsonl'),
        [
          JSON.stringify({
            sessionId: 'worker',
            startTime: '2026-05-31T10:00:00.000Z',
            kind: 'subagent'
          }),
          JSON.stringify({
            id: 'nested-1',
            timestamp: '2026-05-31T10:05:00.000Z',
            type: 'gemini',
            model: 'gemini-3.1-flash-lite-preview',
            tokens: { input: 40, output: 10, total: 50 }
          })
        ].join('\n')
      )

      const records = await loadExternalProviderUsageRecords({
        homeDir,
        now: new Date('2026-05-31T13:00:00.000Z')
      })
      const geminiRecords = records.filter((record) => record.provider === 'gemini')

      expect(geminiRecords.map((record) => record.totalTokens).sort((a, b) => a - b)).toEqual([
        50, 120
      ])
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  })
})
