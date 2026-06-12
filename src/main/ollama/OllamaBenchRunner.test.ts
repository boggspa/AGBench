import { describe, expect, it } from 'vitest'
import { OLLAMA_BENCH_FIXTURES, runOllamaBenchIfEnabled } from './OllamaBenchRunner'

describe('OllamaBenchRunner', () => {
  it('defines the local coding benchmark fixture set', () => {
    expect(OLLAMA_BENCH_FIXTURES.map((fixture) => fixture.id)).toEqual([
      'ollama-repo-orientation',
      'ollama-single-file-bugfix',
      'ollama-json-escaping',
      'ollama-protected-path-denial',
      'ollama-web-tool-use',
      'ollama-shell-verification',
      'ollama-over-scope-handoff'
    ])
  })

  it('does nothing unless RUN_OLLAMA_BENCH=1 is set', async () => {
    const previous = process.env.RUN_OLLAMA_BENCH
    delete process.env.RUN_OLLAMA_BENCH
    await expect(runOllamaBenchIfEnabled()).resolves.toBeNull()
    if (previous === undefined) {
      delete process.env.RUN_OLLAMA_BENCH
    } else {
      process.env.RUN_OLLAMA_BENCH = previous
    }
  })
})
