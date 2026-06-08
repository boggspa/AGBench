import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OllamaHealthChip } from './OllamaHealthChip'

describe('OllamaHealthChip', () => {
  it('shows offline state when runtime is unreachable', () => {
    const html = renderToStaticMarkup(
      <OllamaHealthChip status={{ available: false, setupRequired: true, baseUrl: 'http://127.0.0.1:11434', modelCount: 0, error: 'connection refused' }} />
    )
    expect(html).toContain('Ollama offline')
  })

  it('shows ready chip with model, tier, and live context length', () => {
    const html = renderToStaticMarkup(
      <OllamaHealthChip
        status={{
          available: true,
          setupRequired: false,
          baseUrl: 'http://127.0.0.1:11434',
          modelCount: 1,
          models: [
            {
              id: 'qwen3.5:9b',
              label: 'Qwen 3.5 (9B Param)',
              contextLength: 131072
            }
          ]
        }}
        selectedModelId="qwen3.5:9b"
        toolControlTier="read_only"
      />
    )
    expect(html).toContain('Ollama ready')
    expect(html).toContain('Qwen 3.5 (9B Param)')
    expect(html).toContain('read-only')
    expect(html).toContain('131k ctx')
  })
})
