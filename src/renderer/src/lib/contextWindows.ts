import type { ProviderId } from '../../../main/store/types'

const CONTEXT_WINDOWS_BY_MODEL: Record<string, number> = {
  // Gemini
  pro: 1_048_576,
  flash: 1_048_576,
  'flash-lite': 200_000,
  auto: 1_048_576,
  'cli-default': 1_048_576,
  // Codex
  'gpt-5.5': 400_000,
  'gpt-5.4': 400_000,
  'gpt-5.4-mini': 400_000,
  'gpt-5.3-codex': 400_000,
  'gpt-5.3-codex-spark': 200_000,
  'gpt-5.2': 400_000,
  // Claude
  'claude-opus-4-8': 200_000,
  'claude-opus-4-8-1m': 1_000_000,
  'claude-opus-4-7': 200_000,
  'claude-opus-4-7-1m': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-opus-4-6': 200_000,
  default: 200_000,
  sonnet: 200_000,
  opus: 200_000,
  haiku: 200_000,
  // Kimi
  'kimi-k2.6': 256_000,
  // Grok — grok-build (the CLI default) is the 256K build model; grok-4.3 is 1M.
  'grok-build': 256_000,
  'grok-4.3': 1_000_000,
  // Ollama local defaults. qwen3:4b advertises a large context in Ollama
  // metadata, but use a conservative UI fallback when no live limit is known.
  'qwen3:4b-instruct': 262_144,
  'gemma4:12b': 262_144,
  'gemma4:12b-it-qat': 262_144,
  'gemma4:12b-it-q4_k_m': 262_144,
  'gemma4:12b-it-q8_0': 262_144,
  'gemma4:12b-it-bf16': 262_144,
  'gpt-oss': 131_072,
  'gpt-oss:20b': 131_072,
  'gpt-oss:latest': 131_072,
  'openai/gpt-oss-20b': 131_072
}

const PROVIDER_FALLBACK_WINDOW: Record<ProviderId, number> = {
  gemini: 1_048_576,
  codex: 400_000,
  claude: 200_000,
  kimi: 256_000,
  // Grok (gated) — placeholder until G10 wires real model metadata.
  grok: 256_000,
  // Cursor (gated) — Composer 2.5 placeholder until real metadata.
  cursor: 200_000,
  // Ollama — local models vary by tag, so keep the fallback conservative.
  ollama: 262_144
}

export function resolveContextWindow(
  provider: ProviderId | undefined,
  modelId: string | undefined,
  statsTotalTokenLimit?: number
): number {
  if (
    typeof statsTotalTokenLimit === 'number' &&
    Number.isFinite(statsTotalTokenLimit) &&
    statsTotalTokenLimit > 0
  ) {
    return statsTotalTokenLimit
  }
  if (modelId && CONTEXT_WINDOWS_BY_MODEL[modelId]) {
    return CONTEXT_WINDOWS_BY_MODEL[modelId]
  }
  if (provider) {
    return PROVIDER_FALLBACK_WINDOW[provider]
  }
  return 200_000
}

export function formatContextTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}
