import { describe, expect, it } from 'vitest'
import {
  humanizeOllamaModelId,
  normalizeOllamaBaseUrl,
  normalizeOllamaModels,
  ollamaLocalToolSystemPrompt,
  parseOllamaToolRequest,
  parseOllamaMemoryPsOutput
} from './OllamaProvider'
import {
  normalizeOllamaToolControlTier,
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
          { model: 'gemma4:12b' },
          { model: 'gpt-oss:20b' },
          { model: 'llama3.2:3b' }
        ]
      },
      'llama3.2:3b'
    )

    expect(models).toHaveLength(4)
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
      id: 'gemma4:12b',
      label: 'Gemma 4 (12B Param)',
      isDefault: false
    })
    expect(models[2]).toMatchObject({
      id: 'gpt-oss:20b',
      label: 'GPT OSS (20B Param)',
      isDefault: false
    })
    expect(models[3]).toMatchObject({
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
  it('accepts TaskWraith local read-only tool requests', () => {
    expect(
      parseOllamaToolRequest(
        '{"taskwraith_tool":{"name":"workspace_search","arguments":{"query":"Ollama","path":"src"}}}'
      )
    ).toEqual({
      toolName: 'workspace_search',
      arguments: { query: 'Ollama', path: 'src' }
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
  })
})

describe('Ollama tool tiers', () => {
  it('defaults to read-only tools', () => {
    expect(normalizeOllamaToolControlTier('bad-value')).toBe('read_only')
    expect(ollamaToolNamesForTier('read_only')).toEqual([
      'read_file',
      'list_directory',
      'workspace_search'
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
})
