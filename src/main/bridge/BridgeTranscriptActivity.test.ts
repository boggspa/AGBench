import { describe, expect, it } from 'vitest'
import {
  bridgeAssistantMessageMetadata,
  bridgeModelMetadataFromEvent,
  buildBridgeToolActivity
} from './BridgeTranscriptActivity'

describe('BridgeTranscriptActivity', () => {
  it('extracts Ollama model metadata and maps it to assistant message metadata', () => {
    const metadata = bridgeModelMetadataFromEvent({
      type: 'content',
      model: 'qwen3.5:9b',
      modelLabel: 'Qwen 3.5 (9B Param)'
    })

    expect(metadata).toEqual({
      model: 'qwen3.5:9b',
      modelLabel: 'Qwen 3.5 (9B Param)'
    })
    expect(
      bridgeAssistantMessageMetadata({
        provider: 'ollama',
        actualModel: metadata.model,
        modelLabel: metadata.modelLabel
      })
    ).toEqual({
      providerModel: 'qwen3.5:9b',
      providerModelLabel: 'Qwen 3.5 (9B Param)'
    })
  })

  it('does not add provider model metadata to non-Ollama bridge assistant messages', () => {
    expect(
      bridgeAssistantMessageMetadata({
        provider: 'codex',
        actualModel: 'gpt-5.5',
        modelLabel: 'GPT-5.5'
      })
    ).toBeUndefined()
  })

  it('builds bridge tool activities with provider attribution and tool_kind category parity', () => {
    const activity = buildBridgeToolActivity({
      provider: 'grok',
      activityIndex: 0,
      nowIso: () => '2026-06-13T00:00:00.000Z',
      payload: {
        tool_id: 'tool-1',
        tool_name: 'Write package.json',
        tool_kind: 'edit',
        parameters: { path: 'package.json' }
      }
    })

    expect(activity).toMatchObject({
      id: 'tool-1',
      toolName: 'Write package.json',
      displayName: 'Write package.json',
      category: 'write',
      status: 'running',
      startedAt: '2026-06-13T00:00:00.000Z',
      filePath: 'package.json',
      metadata: { provider: 'grok' }
    })
  })

  it('uses inner MCP tool names for bridge wrapper tools', () => {
    const activity = buildBridgeToolActivity({
      provider: 'ollama',
      activityIndex: 0,
      nowIso: () => '2026-06-13T00:00:00.000Z',
      payload: {
        tool_id: 'tool-2',
        tool_name: 'use_tool',
        parameters: {
          tool_name: 'git_status'
        }
      }
    })

    expect(activity.displayName).toBe('Git status')
    expect(activity.category).toBe('unknown')
    expect(activity.metadata).toEqual({ provider: 'ollama' })
  })

  it('parses stringified bridge tool arguments', () => {
    const activity = buildBridgeToolActivity({
      provider: 'codex',
      activityIndex: 0,
      nowIso: () => '2026-06-13T00:00:00.000Z',
      payload: {
        tool_id: 'tool-3',
        tool_name: 'write_file',
        arguments: '{"path":"notes.md","content":"one\\ntwo"}'
      }
    })

    expect(activity.filePath).toBe('notes.md')
    expect(activity.parameters).toMatchObject({ path: 'notes.md', content: 'one\ntwo' })
    expect(activity.diffSummary).toMatchObject({
      additions: 2,
      deletions: 0,
      source: 'content'
    })
  })
})
