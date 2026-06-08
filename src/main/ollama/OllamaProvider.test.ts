import { describe, expect, it } from 'vitest'
import {
  humanizeOllamaModelId,
  normalizeOllamaBaseUrl,
  normalizeOllamaModels,
  normalizeOllamaNativeToolCall,
  ollamaEmptyResponseRetryPrompt,
  ollamaEmptyToolResponseRetryPrompt,
  ollamaLocalToolSystemPrompt,
  ollamaNativeToolDefinitions,
  ollamaReasoningOnlyNudgePrompt,
  ollamaToolResultFollowUpPrompt,
  parseOllamaToolRequest,
  parseOllamaMemoryPsOutput,
  resolveOllamaVisibleText
} from './OllamaProvider'
import {
  effectiveOllamaToolControlTier,
  normalizeOllamaToolControlTier,
  ollamaProviderParityWorkspaceGranted,
  ollamaToolAllowedInTier,
  ollamaToolNamesForTier,
  ollamaToolRequiresIntent
} from './OllamaToolTiers'

describe('normalizeOllamaBaseUrl', () => {
  it('defaults to the local Ollama service when unset or invalid', () => {
    expect(normalizeOllamaBaseUrl('')).toBe('http://127.0.0.1:11434')
    expect(normalizeOllamaBaseUrl('ftp://127.0.0.1:11434')).toBe('http://127.0.0.1:11434')
  })

  it('keeps http/https origins and strips path/query/hash noise', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434/api/tags?x=1#models')).toBe(
      'http://localhost:11434'
    )
    expect(normalizeOllamaBaseUrl('https://ollama.local:11434///')).toBe(
      'https://ollama.local:11434'
    )
  })
})

describe('normalizeOllamaModels', () => {
  it('maps common local model ids to human-readable labels', () => {
    expect(humanizeOllamaModelId('qwen3:4b-instruct')).toBe('Qwen 3 (4B Param)')
    expect(humanizeOllamaModelId('qwen3.5:9b')).toBe('Qwen 3.5 (9B Param)')
    expect(humanizeOllamaModelId('qwen3.5:9b-q4_K_M')).toBe('Qwen 3.5 (9B Param)')
    expect(humanizeOllamaModelId('gemma4:12b')).toBe('Gemma 4 (12B Param)')
    expect(humanizeOllamaModelId('gemma4:12b-it-q4_K_M')).toBe('Gemma 4 (12B Param)')
    expect(humanizeOllamaModelId('gpt-oss')).toBe('GPT OSS (20B Param)')
    expect(humanizeOllamaModelId('gpt-oss:20b')).toBe('GPT OSS (20B Param)')
    expect(humanizeOllamaModelId('gpt-oss:latest')).toBe('GPT OSS (20B Param)')
    expect(humanizeOllamaModelId('llama3.2:3b')).toBe('llama3.2:3b')
  })

  it('deduplicates models and marks the configured default', () => {
    const models = normalizeOllamaModels(
      {
        models: [
          {
            name: 'qwen3:4b-instruct',
            details: {
              parameter_size: '4B',
              quantization_level: 'Q4_K_M',
              context_length: 262144
            },
            capabilities: ['completion', 'tools']
          },
          { model: 'qwen3:4b-instruct' },
          { model: 'qwen3.5:9b' },
          { model: 'gemma4:12b' },
          { model: 'gpt-oss:20b' },
          { model: 'llama3.2:3b' }
        ]
      },
      'llama3.2:3b'
    )

    expect(models).toHaveLength(5)
    expect(models[0]).toMatchObject({
      id: 'qwen3:4b-instruct',
      label: 'Qwen 3 (4B Param)',
      description: '4B · Q4_K_M · 262,144 ctx',
      contextLength: 262144,
      parameterSize: '4B',
      quantizationLevel: 'Q4_K_M',
      capabilities: ['completion', 'tools'],
      isDefault: false
    })
    expect(models[1]).toMatchObject({
      id: 'qwen3.5:9b',
      label: 'Qwen 3.5 (9B Param)',
      isDefault: false
    })
    expect(models[2]).toMatchObject({
      id: 'gemma4:12b',
      label: 'Gemma 4 (12B Param)',
      isDefault: false
    })
    expect(models[3]).toMatchObject({
      id: 'gpt-oss:20b',
      label: 'GPT OSS (20B Param)',
      isDefault: false
    })
    expect(models[4]).toMatchObject({
      id: 'llama3.2:3b',
      isDefault: true
    })
  })

  it('falls back to the first model when no default is configured', () => {
    const models = normalizeOllamaModels({
      models: [{ model: 'qwen3:4b-instruct' }, { model: 'llama3.2:3b' }]
    })

    expect(models[0]?.isDefault).toBe(true)
    expect(models[1]?.isDefault).toBe(false)
  })
})

describe('parseOllamaMemoryPsOutput', () => {
  it('sums llama-server / Ollama runner RSS samples', () => {
    const sample = parseOllamaMemoryPsOutput(
      [
        '123 250000 /Applications/Ollama.app/Contents/Resources/ollama_llama_server --model qwen',
        '124 100000 /Applications/Ollama.app/Contents/Resources/ollama runner --model other',
        '125 50000 /usr/bin/other-process'
      ].join('\n'),
      '2026-06-08T10:00:00.000Z'
    )

    expect(sample).toMatchObject({
      sampledAt: '2026-06-08T10:00:00.000Z',
      processCount: 2,
      rssBytes: 358_400_000
    })
    expect(sample?.rssGb).toBeCloseTo(0.3584)
  })

  it('returns null when no Ollama model runtime is present', () => {
    expect(parseOllamaMemoryPsOutput('125 50000 /usr/bin/other-process')).toBeNull()
  })
})

describe('parseOllamaToolRequest', () => {
  it('accepts TaskWraith read-only tool requests', () => {
    expect(
      parseOllamaToolRequest(
        '{"taskwraith_tool":{"name":"web_search","arguments":{"query":"Cambridge UK weather"}}}'
      )
    ).toEqual({
      toolName: 'web_search',
      arguments: { query: 'Cambridge UK weather' }
    })
  })

  it('extracts fenced JSON for known tools so policy can deny them explicitly', () => {
    expect(
      parseOllamaToolRequest(
        '```json\n{"taskwraith_tool":{"name":"write_file","arguments":{"path":"x","content":"y"}}}\n```'
      )
    ).toEqual({
      toolName: 'write_file',
      arguments: { path: 'x', content: 'y' }
    })
    expect(ollamaLocalToolSystemPrompt()).toContain(
      'Current Ollama tool-control tier: read-only workspace.'
    )
    expect(ollamaLocalToolSystemPrompt()).toContain(
      '- web_search: {"query":"current information to search for"}'
    )
    expect(ollamaLocalToolSystemPrompt()).toContain(
      '- web_fetch: {"url":"https://example.com/page"}'
    )
  })

  it('nudges local models to summarize after tool results instead of looping', () => {
    expect(
      ollamaToolResultFollowUpPrompt({
        toolName: 'read_file',
        output: 'README content',
        ok: true
      })
    ).toContain('If the tool result is enough to answer the user, summarize')
    expect(ollamaEmptyToolResponseRetryPrompt()).toContain('Answer the original user now')
    expect(ollamaEmptyResponseRetryPrompt()).toContain('Answer the original user request now')
  })

  it('nudges reasoning-only turns to act instead of leaking chain-of-thought', () => {
    const prompt = ollamaReasoningOnlyNudgePrompt()
    expect(prompt).toContain('internal reasoning but no final answer and no tool call')
    expect(prompt).toContain('call one of the available tools now')
    expect(prompt).toContain('Do not leave your response only in hidden reasoning')
  })

  it('tells local models they can reach the live internet via web tools', () => {
    const prompt = ollamaLocalToolSystemPrompt('read_only')
    expect(prompt).toContain('You CAN access the live internet')
    expect(prompt).toContain('web_fetch returns the readable text')
  })

  it('falls back to the thinking channel when content is empty (gpt-oss)', () => {
    expect(resolveOllamaVisibleText({ content: 'final answer', thinking: 'reasoning' })).toBe(
      'final answer'
    )
    expect(resolveOllamaVisibleText({ content: '   ', thinking: 'the weather is sunny' })).toBe(
      'the weather is sunny'
    )
    expect(resolveOllamaVisibleText({ content: '', thinking: '' })).toBe('')
  })
})

describe('ollamaNativeToolDefinitions', () => {
  it('exposes read-only tools as OpenAI-style function schemas', () => {
    const defs = ollamaNativeToolDefinitions('read_only')
    const names = defs.map((def) => def.function.name)
    expect(names).toEqual([
      'read_file',
      'list_directory',
      'workspace_search',
      'web_search',
      'web_fetch'
    ])
    const webSearch = defs.find((def) => def.function.name === 'web_search')
    expect(webSearch?.type).toBe('function')
    expect(webSearch?.function.parameters.required).toEqual(['query'])
    expect(webSearch?.function.parameters.properties).toHaveProperty('query')
  })

  it('expands with the tier and marks mutating tool intents as required', () => {
    const defs = ollamaNativeToolDefinitions('approved_shell')
    const names = defs.map((def) => def.function.name)
    expect(names).toContain('write_file')
    expect(names).toContain('run_shell_command')
    const shell = defs.find((def) => def.function.name === 'run_shell_command')
    expect(shell?.function.parameters.required).toEqual(['command', 'intent'])
  })
})

describe('normalizeOllamaNativeToolCall', () => {
  it('accepts object arguments for known tools', () => {
    expect(
      normalizeOllamaNativeToolCall({
        function: { name: 'web_search', arguments: { query: 'Cambridge weather' } }
      })
    ).toEqual({ toolName: 'web_search', arguments: { query: 'Cambridge weather' } })
  })

  it('parses stringified JSON arguments', () => {
    expect(
      normalizeOllamaNativeToolCall({
        function: { name: 'web_fetch', arguments: '{"url":"https://example.com"}' }
      })
    ).toEqual({ toolName: 'web_fetch', arguments: { url: 'https://example.com' } })
  })

  it('rejects unknown tool names', () => {
    expect(
      normalizeOllamaNativeToolCall({ function: { name: 'rm_rf', arguments: {} } })
    ).toBeNull()
  })
})

describe('Ollama tool tiers', () => {
  it('defaults to read-only tools', () => {
    expect(normalizeOllamaToolControlTier('bad-value')).toBe('read_only')
    expect(ollamaToolNamesForTier('read_only')).toEqual([
      'read_file',
      'list_directory',
      'workspace_search',
      'web_search',
      'web_fetch'
    ])
    expect(ollamaToolAllowedInTier('write_file', 'read_only')).toBe(false)
  })

  it('adds file edits and shell incrementally', () => {
    expect(ollamaToolAllowedInTier('write_file', 'approved_edits')).toBe(true)
    expect(ollamaToolAllowedInTier('run_shell_command', 'approved_edits')).toBe(false)
    expect(ollamaToolAllowedInTier('run_shell_command', 'approved_shell')).toBe(true)
    expect(ollamaToolRequiresIntent('write_file')).toBe(true)
    expect(ollamaToolRequiresIntent('run_shell_command')).toBe(true)
  })

  it('advertises the full TaskWraith tool surface for acknowledged parity mode', () => {
    const tools = ollamaToolNamesForTier('provider_parity')
    expect(tools).toContain('write_file')
    expect(tools).toContain('run_shell_command')
    expect(tools).toContain('delegate_to_subthread')
  })

  it('requires a workspace grant before provider parity becomes effective', () => {
    const settings = {
      ollamaToolControlTier: 'provider_parity' as const,
      ollamaProviderParityWorkspaceGrants: {
        '/tmp/granted': '2026-06-08T12:00:00.000Z'
      }
    }

    expect(ollamaProviderParityWorkspaceGranted(settings, '/tmp/granted')).toBe(true)
    expect(ollamaProviderParityWorkspaceGranted(settings, '/tmp/other')).toBe(false)
    expect(effectiveOllamaToolControlTier(settings, '/tmp/granted')).toBe('provider_parity')
    expect(effectiveOllamaToolControlTier(settings, '/tmp/other')).toBe('read_only')
  })
})
